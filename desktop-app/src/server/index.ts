import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import multer from 'multer';
import http from 'http';
import os from 'os';
import { EventEmitter } from 'events';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import { Bonjour } from 'bonjour-service';
import type { DeckConfig, WSMessage, Button } from '../../../shared/protocol';

export const serverEvents = new EventEmitter();

function openUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd = '';
    if (platform === 'linux') {
      cmd = `xdg-open "${url}"`;
    } else if (platform === 'darwin') {
      cmd = `open "${url}"`;
    } else if (platform === 'win32') {
      cmd = `start "" "${url}"`;
    }
      if (cmd) {
        console.log(`[XDECK] Executing: ${cmd}`);
        exec(cmd, (err, stdout, stderr) => {
          if (err) console.error(`[XDECK] Exec error:`, err.message);
          resolve(!err);
        });
    } else {
      resolve(false);
    }
  });
}

const PORT = parseInt(process.env.XDECK_PORT || '8787');
const CONFIG_DIR = path.join(os.homedir(), '.xdeck');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LICENSE_FILE = path.join(CONFIG_DIR, 'license.key');
const UPLOADS_DIR = path.join(CONFIG_DIR, 'uploads');
const RELAY_URL = process.env.XDECK_RELAY || 'wss://xdeck-relay.onrender.com/relay';

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_CONFIG: DeckConfig = {
  pages: [
    {
      id: 'p1',
      name: 'Main',
      grid: { cols: 4, rows: 5 },
      background: { type: 'gradient', value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
      buttons: [
        { id: 'btn_001', position: { row: 0, col: 0 }, label: 'Browser', icon: '', iconSize: 'normal', action: { kind: 'open_url', target: 'https://google.com' } },
        { id: 'btn_002', position: { row: 0, col: 1 }, label: 'Terminal', icon: '', iconSize: 'normal', action: { kind: 'open_app', target: 'gnome-terminal' } },
      ],
    },
  ],
  layoutPreference: { orientation: 'auto', area: 'safe' },
};

function loadConfig(): DeckConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return structuredClone(DEFAULT_CONFIG);
}

function saveConfig(config: DeckConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function generatePairingCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function loadPairingCode(): string {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (data.pairingCode) return data.pairingCode;
  } catch {}
  const code = generatePairingCode();
  return code;
}

function savePairingCode(code: string): void {
  let data: any = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  data.pairingCode = code;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function loadLicenseKey(): string {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      return fs.readFileSync(LICENSE_FILE, 'utf-8').trim();
    }
  } catch {}
  return '';
}

function saveLicenseKey(key: string): void {
  fs.writeFileSync(LICENSE_FILE, key);
}

let relayWs: WebSocket | null = null;
let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relayReconnectDelay = 5000;

function connectToRelay(licenseKey: string, config: DeckConfig, broadcast: (msg: WSMessage) => void, wss: WebSocketServer) {
  if (relayWs) { relayWs.close(); relayWs = null; }
  if (relayReconnectTimer) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }

  console.log(`[RELAY] Connecting to ${RELAY_URL}...`);
  const ws = new WebSocket(RELAY_URL);
  relayWs = ws;

  ws.on('open', () => {
    console.log('[RELAY] Connected, authenticating...');
    relayReconnectDelay = 5000;
    ws.send(JSON.stringify({
      type: 'relay_auth',
      licenseKey,
      role: 'desktop',
      deviceName: `XDECK Desktop (${os.hostname()})`,
    }));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'relay_auth_ok') {
        console.log('[RELAY] Authenticated as desktop');
        ws.send(JSON.stringify({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference }));
        return;
      }

      if (msg.type === 'relay_status') {
        console.log(`[RELAY] Phone ${msg.connected ? 'connected' : 'disconnected'}${msg.peer ? ': ' + msg.peer : ''}`);
        serverEvents.emit('relay_status', msg.connected);
        return;
      }

      if (msg.type === 'relay_error') {
        console.error('[RELAY] Error:', msg.error);
        return;
      }

      // Forward to local processing
      if (msg.type === 'file_upload') {
        try {
          const buffer = Buffer.from(msg.data, 'base64');
          const dir = path.join(UPLOADS_DIR, msg.dir || 'icons');
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, msg.filename);
          fs.writeFileSync(filePath, buffer);
          console.log(`[RELAY] File uploaded: ${filePath}`);
          ws.send(JSON.stringify({ type: 'file_upload_result', uploadId: msg.uploadId, ok: true, path: `/uploads/${msg.dir || 'icons'}/${msg.filename}` }));
        } catch (e: any) {
          console.error('[RELAY] File upload error:', e.message);
          ws.send(JSON.stringify({ type: 'file_upload_result', uploadId: msg.uploadId, ok: false, error: e.message }));
        }
        return;
      }

      if (msg.type === 'trigger') {
        const btn = findButton(config, msg.buttonId);
        if (btn) {
          const ok = await launchTarget(btn.action);
          console.log(`[RELAY] Trigger: ${msg.buttonId}, ok=${ok}`);
          ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok }));
        } else {
          ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok: false, error: 'Not found' }));
        }
        return;
      }

      // Config changes from phone via relay
      switch (msg.type) {
        case 'button_update':
        case 'button_delete':
        case 'page_update':
        case 'page_delete':
        case 'background_update':
        case 'grid_update':
        case 'layout_update': {
          if (msg.type === 'button_update') {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) {
              const idx = page.buttons.findIndex((b) => b.id === msg.button.id);
              if (idx >= 0) page.buttons[idx] = msg.button;
              else page.buttons.push(msg.button);
            }
          } else if (msg.type === 'button_delete') {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) page.buttons = page.buttons.filter((b) => b.id !== msg.buttonId);
          } else if (msg.type === 'page_update') {
            const idx = config.pages.findIndex((p) => p.id === msg.page.id);
            if (idx >= 0) config.pages[idx] = msg.page;
            else config.pages.push(msg.page);
          } else if (msg.type === 'page_delete') {
            config.pages = config.pages.filter((p) => p.id !== msg.pageId);
          } else if (msg.type === 'background_update') {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) page.background = msg.background;
          } else if (msg.type === 'grid_update') {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) page.grid = msg.grid;
          } else if (msg.type === 'layout_update') {
            config.layoutPreference = msg.layoutPreference;
          }
          saveConfig(config);
          const syncMsg: WSMessage = { type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference };
          ws.send(JSON.stringify(syncMsg));
          broadcast(syncMsg);
          break;
        }
      }
    } catch (e) {
      console.error('[RELAY] Message error:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[RELAY] Disconnected, reconnecting in ${relayReconnectDelay / 1000}s...`);
    relayWs = null;
    relayReconnectTimer = setTimeout(() => connectToRelay(licenseKey, config, broadcast, wss), relayReconnectDelay);
    relayReconnectDelay = Math.min(relayReconnectDelay * 2, 60000);
  });

  ws.on('error', (err) => {
    console.error('[RELAY] Connection error:', err.message);
  });
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function findButton(config: DeckConfig, buttonId: string): Button | null {
  for (const page of config.pages) {
    const btn = page.buttons.find((b) => b.id === buttonId);
    if (btn) return btn;
  }
  return null;
}

function launchTarget(action: { kind: string; target: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;

    if (action.kind === 'open_url') {
      openUrl(action.target).then((ok) => resolve(ok)).catch((err) => { console.error('[XDECK] open_url error:', err); resolve(false); });
      return;
    }

    if (action.kind === 'open_app') {
      let cmd = '';
      if (platform === 'linux') {
        cmd = `${action.target}`;
      } else if (platform === 'win32') {
        cmd = `start "" "${action.target}"`;
      } else if (platform === 'darwin') {
        cmd = `open -a "${action.target}"`;
      }
      if (cmd) {
        exec(cmd, (err) => resolve(!err));
      } else {
        resolve(false);
      }
      return;
    }

    if (action.kind === 'start_app') {
      const appPath = action.target;
      const argsStr = (action as any).args || '';
      const fullCmd = argsStr ? `${appPath} ${argsStr}` : appPath;
      console.log(`[XDECK] Start app: ${fullCmd}`);

      exec(fullCmd, (err) => {
        if (err) console.error(`[XDECK] Start app error:`, err.message);
      });
      resolve(true);
      return;
    }

    if (action.kind === 'hotkey') {
      let cmd = '';
      if (platform === 'linux') {
        const sessionType = process.env.XDG_SESSION_TYPE || '';
        if (sessionType === 'wayland') {
          // On Wayland, try ydotool (needs ydotoold daemon running), fallback to xdotool (XWayland)
          cmd = `which ydotool >/dev/null 2>&1 && ydotool key ${action.target} || xdotool key ${action.target}`;
        } else {
          cmd = `xdotool key ${action.target}`;
        }
      } else if (platform === 'win32') {
        // Windows: use PowerShell SendKeys
        const keys = action.target.replace(/\b ctrl\b/gi, '^').replace(/\b alt\b/gi, '%').replace(/\b shift\b/gi, '+');
        cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`;
      } else if (platform === 'darwin') {
        // macOS: use osascript with key code
        const parts = action.target.split('+').map(s => s.trim().toLowerCase());
        const modifiers: string[] = [];
        let key = '';
        for (const p of parts) {
          if (p === 'cmd' || p === 'command') modifiers.push('command');
          else if (p === 'ctrl' || p === 'control') modifiers.push('control');
          else if (p === 'alt' || p === 'option') modifiers.push('option');
          else if (p === 'shift') modifiers.push('shift');
          else key = p;
        }
        const modStr = modifiers.length ? ` {${modifiers.join(', ')}}` : '';
        cmd = `osascript -e 'tell application "System Events" to keystroke "${key}"${modStr}'`;
      }
      if (cmd) {
        console.log(`[XDECK] Executing hotkey: ${cmd}`);
        serverEvents.emit('before-hotkey');
        setTimeout(() => {
          exec(cmd, (err) => {
            serverEvents.emit('after-hotkey');
            resolve(!err);
          });
        }, 500);
      } else {
        resolve(false);
      }
      return;
    }

    if (action.kind === 'media_key') {
      let cmd = '';
      if (platform === 'linux') {
        const keyMap: Record<string, string> = {
          'play': 'XF86AudioPlay',
          'pause': 'XF86AudioPlay',
          'stop': 'XF86AudioStop',
          'next': 'XF86AudioNext',
          'prev': 'XF86AudioPrev',
          'volume_up': 'XF86AudioRaiseVolume',
          'volume_down': 'XF86AudioLowerVolume',
          'mute': 'XF86AudioMute',
        };
        const xkey = keyMap[action.target.toLowerCase()] || action.target;
        const sessionType = process.env.XDG_SESSION_TYPE || '';
        if (sessionType === 'wayland') {
          cmd = `which ydotool >/dev/null 2>&1 && ydotool key ${xkey} || xdotool key ${xkey}`;
        } else {
          cmd = `xdotool key ${xkey}`;
        }
      } else if (platform === 'win32') {
        const psMap: Record<string, string> = {
          'play': '{MEDIA_PLAY_PAUSE}',
          'pause': '{MEDIA_PLAY_PAUSE}',
          'stop': '{MEDIA_STOP}',
          'next': '{MEDIA_NEXT_TRACK}',
          'prev': '{MEDIA_PREV_TRACK}',
          'volume_up': '{VOLUME_UP}',
          'volume_down': '{VOLUME_DOWN}',
          'mute': '{VOLUME_MUTE}',
        };
        const psKey = psMap[action.target.toLowerCase()] || action.target;
        cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psKey}')`;
      } else if (platform === 'darwin') {
        const target = action.target.toLowerCase();
        if (target === 'play' || target === 'pause') {
          cmd = `osascript -e 'tell application "System Events" to key code 16'`;
        } else if (target === 'next') {
          cmd = `osascript -e 'tell application "System Events" to key code 17'`;
        } else if (target === 'prev') {
          cmd = `osascript -e 'tell application "System Events" to key code 20'`;
        } else if (target === 'mute') {
          cmd = `osascript -e 'set volume output muted not (output muted of (get volume settings))'`;
        } else if (target === 'volume_up') {
          cmd = `osascript -e 'set volume output volume (output volume of (get volume settings) + 10)'`;
        } else if (target === 'volume_down') {
          cmd = `osascript -e 'set volume output volume (output volume of (get volume settings) - 10)'`;
        }
      }
      if (cmd) {
        console.log(`[XDECK] Executing media key: ${cmd}`);
        serverEvents.emit('before-hotkey');
        setTimeout(() => {
          exec(cmd, (err) => {
            serverEvents.emit('after-hotkey');
            resolve(!err);
          });
        }, 500);
      } else {
        resolve(false);
      }
      return;
    }

    if (action.kind === 'run_command') {
      exec(action.target, { timeout: 30000 }, (err) => resolve(!err));
      return;
    }

    resolve(false);
  });
}

export function startServer() {
  const config = loadConfig();
  let pairingCode = loadPairingCode();
  let licenseKey = loadLicenseKey();

  // Express for file uploads
  const expressApp = express();

  // CORS for PWA uploads
  expressApp.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, (req.query.dir as string) || 'icons');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
    },
  });
  const upload = multer({ storage });

  expressApp.use('/uploads', express.static(UPLOADS_DIR));

  expressApp.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const dir = (req.query.dir as string) || 'icons';
    res.json({ path: `/uploads/${dir}/${req.file.filename}` });
  });

  expressApp.get('/config', (_req, res) => res.json(config));

  expressApp.get('/devices', (_req, res) => {
    const devices = Array.from(connectedDevices.values()).map((d) => ({
      ip: d.ip,
      connectedAt: d.connectedAt.toISOString(),
    }));
    res.json(devices);
  });

  const httpServer = http.createServer(expressApp);

  // WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server: httpServer, path: '/deck' });

  function broadcast(message: WSMessage) {
    const data = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }

  const connectedDevices = new Map<string, { ip: string; connectedAt: Date }>();

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const deviceId = `${clientIp}_${Date.now()}`;
    connectedDevices.set(deviceId, { ip: clientIp, connectedAt: new Date() });
    console.log(`[XDECK] Client connected from ${clientIp} (${connectedDevices.size} total)`);
    ws.send(JSON.stringify({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference } as WSMessage));

    ws.on('message', async (data) => {
      try {
        const msg: WSMessage = JSON.parse(data.toString());
        switch (msg.type) {
          case 'trigger': {
            const btn = findButton(config, msg.buttonId);
            console.log(`[XDECK] Trigger: ${msg.buttonId}, found: ${!!btn}, action: ${btn?.action.kind} → ${btn?.action.target}`);
            if (btn) {
              const ok = await launchTarget(btn.action);
              console.log(`[XDECK] Trigger result: ok=${ok}`);
              ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok } as WSMessage));
            } else {
              console.log(`[XDECK] Trigger: button not found!`);
              ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok: false, error: 'Not found' } as WSMessage));
            }
            break;
          }
          case 'button_update': {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) {
              const idx = page.buttons.findIndex((b) => b.id === msg.button.id);
              if (idx >= 0) page.buttons[idx] = msg.button;
              else page.buttons.push(msg.button);
              saveConfig(config);
              broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference });
            }
            break;
          }
          case 'button_delete': {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) {
              page.buttons = page.buttons.filter((b) => b.id !== msg.buttonId);
              saveConfig(config);
              broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference });
            }
            break;
          }
          case 'page_update': {
            const idx = config.pages.findIndex((p) => p.id === msg.page.id);
            if (idx >= 0) config.pages[idx] = msg.page;
            else config.pages.push(msg.page);
            saveConfig(config);
            broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference });
            break;
          }
          case 'page_delete': {
            config.pages = config.pages.filter((p) => p.id !== msg.pageId);
            saveConfig(config);
            broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference });
            break;
          }
          case 'background_update': {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) { page.background = msg.background; saveConfig(config); broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference }); }
            break;
          }
          case 'grid_update': {
            const page = config.pages.find((p) => p.id === msg.pageId);
            if (page) { page.grid = msg.grid; saveConfig(config); broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference }); }
            break;
          }
          case 'layout_update': {
            config.layoutPreference = (msg as any).layoutPreference;
            saveConfig(config);
            broadcast({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference });
            break;
          }
          case 'ping': { ws.send(JSON.stringify({ type: 'pong' } as WSMessage)); break; }
        }
      } catch (e) { console.error('[XDECK] Message error:', e); }
    });

    ws.on('close', () => {
      connectedDevices.delete(deviceId);
      console.log(`[XDECK] Client disconnected from ${clientIp} (${connectedDevices.size} remaining)`);
    });
  });

  // Pairing info endpoint
  expressApp.get('/pairing', async (_req, res) => {
    const ip = getLocalIP();
    const qr = await QRCode.toDataURL(JSON.stringify({ ip, port: PORT, code: pairingCode }));
    res.json({ ip, port: PORT, code: pairingCode, qr });
  });

  expressApp.post('/pairing/regenerate', (_req, res) => {
    pairingCode = generatePairingCode();
    savePairingCode(pairingCode);
    res.json({ code: pairingCode });
  });

  // Start HTTP server
  httpServer.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║           XDECK Server Running            ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  WebSocket: ws://${ip}:${PORT}/deck`.padEnd(46) + '║');
    console.log(`  ║  HTTP:      http://${ip}:${PORT}`.padEnd(46) + '║');
    console.log(`  ║  Pairing:   ${pairingCode}`.padEnd(46) + '║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');

    // Advertise via mDNS so PWA can auto-discover
    const bonjour = new Bonjour();
    bonjour.publish({
      name: 'XDECK',
      type: 'xdeck',
      port: PORT,
      txt: { pairingCode },
    });
    console.log(`[XDECK] mDNS advertised as "XDECK" on local network`);

    // Connect to relay server if license key is configured
    if (licenseKey) {
      connectToRelay(licenseKey, config, broadcast, wss);
    }
  });

  // Relay API endpoints
  expressApp.get('/relay/status', (_req, res) => {
    res.json({ connected: relayWs?.readyState === WebSocket.OPEN, licenseKey: licenseKey || null });
  });

  expressApp.post('/relay/connect', (req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        if (!key) { res.status(400).json({ error: 'Missing key' }); return; }
        licenseKey = key;
        saveLicenseKey(key);
        connectToRelay(key, config, broadcast, wss);
        res.json({ ok: true });
      } catch { res.status(400).json({ error: 'Invalid request' }); }
    });
  });

  expressApp.post('/relay/disconnect', (_req, res) => {
    if (relayWs) { relayWs.close(); relayWs = null; }
    licenseKey = null;
    saveLicenseKey('');
    res.json({ ok: true });
  });

  return { wss, httpServer, config };
}

// Run directly with tsx
if (require.main === module) {
  startServer();
}
