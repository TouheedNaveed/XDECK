import { useState, useEffect, useCallback, useRef } from 'react';
import type { WSMessage, DeckConfig, Page } from '@shared/protocol';
import { store, type ConnectionInfo } from './store';

const RELAY_URL = (import.meta as any).env?.VITE_RELAY_URL
  || (location.protocol === 'https:'
    ? `${location.protocol}//${location.host}/relay`
    : `ws://${location.hostname}:9000/relay`);

function rewriteHttpUrls(value: string): string {
  if (!value || location.protocol !== 'https:') return value;
  return value.replace(/https?:\/\/[^/]+(\/[^\s'"]*)/g, (match, path) => {
    if (path.startsWith('/uploads')) {
      return `${location.protocol}//${location.host}${path}`;
    }
    return match;
  });
}

function rewriteConfigUrls(pages: Page[]): Page[] {
  return pages.map((page) => ({
    ...page,
    background: {
      ...page.background,
      value: rewriteHttpUrls(page.background.value),
    },
    buttons: page.buttons.map((btn) => ({
      ...btn,
      icon: btn.icon ? rewriteHttpUrls(btn.icon) : btn.icon,
    })),
  }));
}

const DEFAULT_CONFIG: DeckConfig = {
  pages: [
    {
      id: 'p1',
      name: 'Main',
      grid: { cols: 4, rows: 5 },
      background: { type: 'gradient', value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
      buttons: [],
    },
  ],
  layoutPreference: { orientation: 'auto', area: 'safe' },
};

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  isInitialized: boolean;
  config: DeckConfig;
  connect: (info: ConnectionInfo) => void;
  disconnect: () => void;
  sendMessage: (msg: WSMessage) => void;
  triggerButton: (buttonId: string) => Promise<boolean>;
}

export function useWebSocket(): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isInitialized, setIsInitialized] = useState(false);
  const [config, setConfig] = useState<DeckConfig>(DEFAULT_CONFIG);

  // All mutable state lives in refs to avoid stale closure issues
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempts = useRef(0);
  const generation = useRef(0);
  const pendingTriggers = useRef<Map<string, { resolve: (ok: boolean) => void }>>(new Map());
  const savedInfo = useRef<ConnectionInfo | null>(null);

  // Use a ref-based connect function so every callback always has the latest logic
  const connectRef = useRef<(info: ConnectionInfo) => void>(() => {});
  const disconnectRef = useRef<() => void>(() => {});

  connectRef.current = (info: ConnectionInfo) => {
    // Clear everything
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    generation.current++;
    reconnectAttempts.current = 0;
    savedInfo.current = info;
    store.saveConnection(info);
    startConnect(info, generation.current);
  };

  disconnectRef.current = () => {
    generation.current++;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttempts.current = 0;
    savedInfo.current = null;
    setConnectionState('disconnected');
    store.clearConnection();
  };

  function startConnect(info: ConnectionInfo, gen: number) {
    if (gen !== generation.current) return;
    console.log(`[XDECK] Connecting (mode=${info.mode}) (gen=${gen})`);
    setConnectionState('connecting');

    let ws: WebSocket;
    try {
      if (info.mode === 'relay' && info.licenseKey) {
        ws = new WebSocket(RELAY_URL);
      } else {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = location.protocol === 'https:' ? location.host : `${info.ip}:${info.port}`;
        ws = new WebSocket(`${proto}//${wsHost}/deck`);
      }
    } catch (e) {
      console.log('[XDECK] WebSocket constructor failed:', e);
      if (gen === generation.current) {
        setConnectionState('reconnecting');
        scheduleReconnect(gen);
      }
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (gen !== generation.current) { ws.close(); return; }
      console.log('[XDECK] Connected');

      if (info.mode === 'relay' && info.licenseKey) {
        ws.send(JSON.stringify({
          type: 'relay_auth',
          licenseKey: info.licenseKey,
          role: 'phone',
          deviceName: navigator.userAgent.slice(0, 50),
        }));
      }

      setConnectionState('connected');
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (gen !== generation.current) return;
      try {
        const raw = JSON.parse(event.data);
        const msgType: string = raw.type;

        if (msgType === 'relay_auth_ok' || msgType === 'relay_status') {
          if (raw.connected === false && info.mode === 'relay') {
            console.log('[XDECK] Relay: desktop disconnected');
            setConnectionState('reconnecting');
          } else if (raw.connected === true && info.mode === 'relay') {
            console.log('[XDECK] Relay: desktop connected');
            setConnectionState('connected');
          }
          return;
        }
        if (msgType === 'relay_error') {
          console.error('[XDECK] Relay error:', raw.error);
          return;
        }

        const msg = raw as WSMessage;
        switch (msg.type) {
          case 'config_sync': {
            let pages = msg.pages;
            if (location.protocol === 'https:') {
              pages = rewriteConfigUrls(pages);
            }
            setConfig({ pages, layoutPreference: msg.layoutPreference });
            store.saveConfig({ pages, layoutPreference: msg.layoutPreference });
            break;
          }
          case 'trigger_result': {
            const pending = pendingTriggers.current.get(msg.buttonId);
            if (pending) {
              pending.resolve(msg.ok);
              pendingTriggers.current.delete(msg.buttonId);
            }
            break;
          }
        }
      } catch (e) {
        console.error('[XDECK] Parse error:', e);
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (gen !== generation.current) return;
      console.log('[XDECK] Disconnected, will reconnect...');
      wsRef.current = null;
      setConnectionState('reconnecting');
      scheduleReconnect(gen);
    };
  }

  function scheduleReconnect(gen: number) {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const info = savedInfo.current;
    if (!info) { console.log('[XDECK] No saved info, cannot reconnect'); return; }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 15000);
    reconnectAttempts.current++;
    console.log(`[XDECK] Will reconnect in ${delay}ms (attempt ${reconnectAttempts.current})`);
    reconnectTimerRef.current = setTimeout(() => {
      if (gen === generation.current) {
        startConnect(info, gen);
      }
    }, delay);
  }

  // Stable callbacks that delegate to refs
  const connect = useCallback((info: ConnectionInfo) => {
    connectRef.current(info);
  }, []);

  const disconnect = useCallback(() => {
    disconnectRef.current();
  }, []);

  const sendMessage = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const triggerButton = useCallback(async (buttonId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingTriggers.current.set(buttonId, { resolve });
      sendMessage({ type: 'trigger', buttonId });
      setTimeout(() => {
        if (pendingTriggers.current.has(buttonId)) {
          pendingTriggers.current.delete(buttonId);
          resolve(false);
        }
      }, 5000);
    });
  }, [sendMessage]);

  // Load cached connection on mount
  useEffect(() => {
    store.getConfig().then((cfg) => {
      if (location.protocol === 'https:') {
        setConfig({ ...cfg, pages: rewriteConfigUrls(cfg.pages) });
      } else {
        setConfig(cfg);
      }
    });
    store.getConnection().then((info) => {
      if (info) {
        savedInfo.current = info;
        generation.current++;
        reconnectAttempts.current = 0;
        startConnect(info, generation.current);
      }
      setIsInitialized(true);
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (wsRef.current === null && savedInfo.current) {
          console.log('[XDECK] App resumed, attempting reconnect');
          generation.current++;
          reconnectAttempts.current = 0;
          startConnect(savedInfo.current, generation.current);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      generation.current++;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const interval = setInterval(() => sendMessage({ type: 'ping' }), 25000);
    return () => clearInterval(interval);
  }, [connectionState, sendMessage]);

  return {
    connectionState,
    isInitialized,
    config,
    connect,
    disconnect,
    sendMessage,
    triggerButton,
  };
}
