import { useState, useEffect, useCallback, useRef } from 'react';
import type { WSMessage, DeckConfig } from '@shared/protocol';
import { store, type ConnectionInfo } from './store';

const RELAY_URL: string = (import.meta as any).env?.VITE_RELAY_URL
  || 'wss://xdeck-relay.onrender.com/relay';

/** Used only when localStorage is unavailable (private mode with storage blocked). */
const SESSION_DEVICE_ID = `d${Math.random().toString(36).slice(2, 12)}`;
const DEVICE_ID_KEY = 'xdeck_device_id';

/**
 * Stable identity for this install. The relay compares it against the device
 * holding the license key, so that "my phone reconnecting" is allowed while
 * "a second person using my key" is refused. It must survive reloads.
 */
function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (globalThis.crypto as any)?.randomUUID?.()
        || `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id!);
    }
    return id!;
  } catch {
    return SESSION_DEVICE_ID;
  }
}

/**
 * Where to open the LAN socket. When the page is served from the desktop itself
 * (or through its dev proxy) same-origin is correct; otherwise we must dial the
 * desktop's LAN address directly — which a browser only allows from an insecure
 * page, since ws:// from https:// is blocked as mixed content.
 */
function lanTarget(info: ConnectionInfo): { url: string } | { error: string } {
  const sameHost = !!info.ip && info.ip === location.hostname;
  if (sameHost) {
    return { url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/deck` };
  }
  if (location.protocol === 'https:') {
    return {
      error:
        'LAN mode blocked by browser security on HTTPS. Use Cloud mode instead.',
    };
  }
  if (!info.ip) return { error: 'No desktop address saved. Scan the QR code again.' };
  return { url: `ws://${info.ip}:${info.port}/deck` };
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

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  /** Relay reached, but the desktop isn't in the session — nothing can be applied yet. */
  | 'waiting'
  | 'connected'
  | 'reconnecting'
  /** Unrecoverable: bad license key, or LAN mode from an https origin. */
  | 'error';

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  /** True only when the desktop can actually receive messages right now. */
  isLive: boolean;
  lastError: string | null;
  isInitialized: boolean;
  config: DeckConfig;
  connect: (info: ConnectionInfo) => void;
  disconnect: () => void;
  /** Returns false when the message could not be delivered. */
  sendMessage: (msg: WSMessage) => boolean;
  updateConfig: (updater: (config: DeckConfig) => DeckConfig) => void;
  uploadFileViaRelay: (dir: string, filename: string, data: string) => Promise<string | null>;
  triggerButton: (buttonId: string) => Promise<boolean>;
}

export function useWebSocket(): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [config, setConfig] = useState<DeckConfig>(DEFAULT_CONFIG);

  // All mutable state lives in refs to avoid stale closure issues
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempts = useRef(0);
  const generation = useRef(0);
  const pendingTriggers = useRef<Map<string, { resolve: (ok: boolean) => void }>>(new Map());
  const pendingUploads = useRef<Map<string, { resolve: (path: string | null) => void }>>(new Map());
  const savedInfo = useRef<ConnectionInfo | null>(null);
  /** Peer reachability, separate from socket state: the relay socket stays open
   *  while the desktop is offline, and messages sent then go nowhere. */
  const peerOnline = useRef(false);
  const fatal = useRef(false);
  const awaitingPong = useRef(false);
  const missedPongs = useRef(0);

  // Use a ref-based connect function so every callback always has the latest logic
  const connectRef = useRef<(info: ConnectionInfo) => void>(() => {});
  const disconnectRef = useRef<() => void>(() => {});

  function teardownSocket() {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  connectRef.current = (info: ConnectionInfo) => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    teardownSocket();
    generation.current++;
    reconnectAttempts.current = 0;
    peerOnline.current = false;
    fatal.current = false;
    setLastError(null);
    savedInfo.current = info;
    store.saveConnection(info);
    startConnect(info, generation.current);
  };

  disconnectRef.current = () => {
    generation.current++;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    teardownSocket();
    reconnectAttempts.current = 0;
    savedInfo.current = null;
    peerOnline.current = false;
    fatal.current = false;
    setLastError(null);
    setConnectionState('disconnected');
    store.clearConnection();
  };

  function failFatally(message: string) {
    fatal.current = true;
    peerOnline.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    setLastError(message);
    setConnectionState('error');
  }

  function startConnect(info: ConnectionInfo, gen: number) {
    if (gen !== generation.current) return;
    const isRelay = info.mode === 'relay' && !!info.licenseKey;
    console.log(`[XDECK] Connecting (mode=${info.mode}) (gen=${gen})`);
    peerOnline.current = false;
    setConnectionState('connecting');

    let url: string;
    if (isRelay) {
      url = RELAY_URL;
    } else {
      const target = lanTarget(info);
      if ('error' in target) { failFatally(target.error); return; }
      url = target.url;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
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
      console.log('[XDECK] Socket open');
      reconnectAttempts.current = 0;
      awaitingPong.current = false;
      missedPongs.current = 0;

      if (isRelay) {
        // Still not "connected" — that waits on relay_status telling us the
        // desktop is actually in the session.
        setConnectionState('waiting');
        ws.send(JSON.stringify({
          type: 'relay_auth',
          licenseKey: info.licenseKey,
          role: 'phone',
          deviceName: navigator.userAgent.slice(0, 50),
          deviceId: getDeviceId(),
        }));
      } else {
        peerOnline.current = true;
        setConnectionState('connected');
        // Always pull the desktop's config; never trust our cached copy for edits.
        ws.send(JSON.stringify({ type: 'config_request' } as WSMessage));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (gen !== generation.current) return;
      try {
        const raw = JSON.parse(event.data);
        const msgType: string = raw.type;

        if (msgType === 'relay_auth_ok') {
          console.log('[XDECK] Relay authenticated');
          return;
        }

        if (msgType === 'relay_status') {
          if (raw.connected === true) {
            if (!peerOnline.current) console.log('[XDECK] Desktop online');
            peerOnline.current = true;
            setLastError(null);
            setConnectionState('connected');
            // The desktop pushes its config on join too; asking makes the phone
            // authoritative-config-first regardless of who connected last.
            ws.send(JSON.stringify({ type: 'config_request' } as WSMessage));
          } else {
            if (peerOnline.current) console.log('[XDECK] Desktop went offline');
            peerOnline.current = false;
            // The socket is healthy — only the peer is missing. Reconnecting would
            // accomplish nothing, so sit in 'waiting' until it comes back.
            setConnectionState('waiting');
            if (raw.undelivered) {
              setLastError('Desktop is offline — that change was not saved.');
            }
          }
          return;
        }

        if (msgType === 'relay_error') {
          console.error('[XDECK] Relay error:', raw.error);
          if (raw.error === 'key_in_use') {
            // One key, one device. Retrying would only fight the other device,
            // so stop and tell the user to get their own key.
            failFatally(raw.message
              || 'This license key is already in use on another phone. Each key works on one phone at a time — buy your own key to use XDECK.');
          } else if (/invalid license/i.test(raw.error || '')) {
            failFatally(raw.message || 'This license key was rejected. Check the key and pair again.');
          } else if (raw.error === 'replaced') {
            failFatally('This deck was opened somewhere else, so this window was disconnected.');
          }
          return;
        }

        if (msgType === 'pong') { awaitingPong.current = false; missedPongs.current = 0; return; }

        const msg = raw as WSMessage;
        switch (msg.type) {
          case 'config_sync': {
            if (!Array.isArray(msg.pages) || msg.pages.length === 0) {
              console.warn('[XDECK] Ignoring malformed config_sync');
              break;
            }
            const next: DeckConfig = { pages: msg.pages, layoutPreference: msg.layoutPreference };
            setConfig(next);
            store.saveConfig(next);
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
          case 'file_upload_result': {
            const pending = pendingUploads.current.get(msg.uploadId);
            if (pending) {
              pending.resolve(msg.ok && msg.path ? msg.path : null);
              pendingUploads.current.delete(msg.uploadId);
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
      wsRef.current = null;
      peerOnline.current = false;
      if (fatal.current) return;
      console.log('[XDECK] Disconnected, will reconnect...');
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

  const sendMessage = useCallback((msg: WSMessage): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    // Over the relay an open socket proves nothing about the desktop being there.
    if (!peerOnline.current && msg.type !== 'ping') return false;
    wsRef.current.send(JSON.stringify(msg));
    return true;
  }, []);

  const updateConfig = useCallback((updater: (config: DeckConfig) => DeckConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      store.saveConfig(next);
      return next;
    });
  }, []);

  const triggerButton = useCallback(async (buttonId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingTriggers.current.set(buttonId, { resolve });
      if (!sendMessage({ type: 'trigger', buttonId })) {
        pendingTriggers.current.delete(buttonId);
        resolve(false);
        return;
      }
      setTimeout(() => {
        if (pendingTriggers.current.has(buttonId)) {
          pendingTriggers.current.delete(buttonId);
          resolve(false);
        }
      }, 5000);
    });
  }, [sendMessage]);

  const uploadFileViaRelay = useCallback(async (dir: string, filename: string, data: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingUploads.current.set(uploadId, { resolve });
      if (!sendMessage({ type: 'file_upload', uploadId, dir, filename, data })) {
        pendingUploads.current.delete(uploadId);
        resolve(null);
        return;
      }
      setTimeout(() => {
        if (pendingUploads.current.has(uploadId)) {
          pendingUploads.current.delete(uploadId);
          resolve(null);
        }
      }, 15000);
    });
  }, [sendMessage]);

  // Load cached connection on mount
  useEffect(() => {
    store.getConfig().then((cfg) => {
      if (cfg?.pages?.length) setConfig(cfg);
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
      if (document.visibilityState !== 'visible') return;
      if (fatal.current || !savedInfo.current) return;
      // A backgrounded phone often keeps a half-open socket that will never
      // deliver again, so reconnect whenever we don't have a live peer.
      if (wsRef.current === null || !peerOnline.current) {
        console.log('[XDECK] App resumed, attempting reconnect');
        teardownSocket();
        generation.current++;
        reconnectAttempts.current = 0;
        startConnect(savedInfo.current, generation.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleVisibility);

    return () => {
      generation.current++;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      teardownSocket();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleVisibility);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat — also detects half-open sockets, which mobile networks produce
  // often and which otherwise look "connected" forever.
  useEffect(() => {
    if (connectionState !== 'connected' && connectionState !== 'waiting') return;
    missedPongs.current = 0;
    const interval = setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (awaitingPong.current) {
        missedPongs.current++;
        if (missedPongs.current >= 2) {
          console.log('[XDECK] No pong for 2 cycles — socket is stale, reconnecting');
          missedPongs.current = 0;
          awaitingPong.current = false;
          ws.close();
          return;
        }
        console.log(`[XDECK] Missed pong (${missedPongs.current}/2) — trying once more`);
        // Still send another ping to give it a chance
      }
      awaitingPong.current = true;
      ws.send(JSON.stringify({ type: 'ping' } as WSMessage));
    }, 25000);
    return () => clearInterval(interval);
  }, [connectionState]);

  return {
    connectionState,
    isLive: connectionState === 'connected',
    lastError,
    isInitialized,
    config,
    connect,
    disconnect,
    sendMessage,
    updateConfig,
    uploadFileViaRelay,
    triggerButton,
  };
}
