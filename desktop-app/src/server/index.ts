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
import crypto from 'crypto';
import type { DeckConfig, WSMessage, Button, Page, LayoutPreference } from '../../../shared/protocol';

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
const DEVICE_ID_FILE = path.join(CONFIG_DIR, 'device.id');
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

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

// Icons/backgrounds used to be stored as http URLs pointing at this machine's LAN
// address. Those are unreachable over the relay (and after any IP change), so any
// upload we can still find on disk is inlined as a data URL — which works on LAN,
// over the relay, and offline alike.
function inlineUploadUrl(value: string): string {
  if (!value || value.startsWith('data:')) return value;
  const match = value.match(/^https?:\/\/[^/]+\/uploads\/(.+)$/);
  if (!match) return value;
  try {
    const rel = decodeURIComponent(match[1]).split('?')[0];
    const file = path.resolve(UPLOADS_DIR, rel);
    if (!file.startsWith(UPLOADS_DIR) || !fs.existsSync(file)) return '';
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return '';
  }
}

function migrateAssetUrls(config: DeckConfig): boolean {
  let changed = false;
  for (const page of config.pages) {
    if (page.background?.type === 'image' && page.background.value) {
      const next = inlineUploadUrl(page.background.value);
      if (next !== page.background.value) {
        page.background = next
          ? { ...page.background, value: next }
          : { type: 'color', value: '#1a1a2e' };
        changed = true;
      }
    }
    for (const button of page.buttons) {
      if (!button.icon) continue;
      const next = inlineUploadUrl(button.icon);
      if (next !== button.icon) { button.icon = next; changed = true; }
    }
  }
  return changed;
}

/**
 * Rebuilds the layout preference from only the two fields that exist. Older builds
 * spread a string into this object, leaving keys like {"0":"a","1":"u",...} that
 * then got synced to the phone; copying it wholesale would keep that forever.
 */
function normalizeLayout(raw: any, fallback: LayoutPreference): LayoutPreference {
  const orientation = raw?.orientation;
  const area = raw?.area;
  return {
    orientation: orientation === 'portrait' || orientation === 'landscape' || orientation === 'auto'
      ? orientation : fallback.orientation,
    area: area === 'full' || area === 'safe' ? area : fallback.area,
  };
}

function normalizeConfig(raw: any): DeckConfig {
  const fallback = structuredClone(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages) || raw.pages.length === 0) {
    return fallback;
  }
  const pages = raw.pages.filter((p: any) => p && typeof p.id === 'string').map((p: any) => ({
    ...p,
    grid: {
      cols: Math.max(1, Math.min(8, Number(p.grid?.cols) || 4)),
      rows: Math.max(1, Math.min(10, Number(p.grid?.rows) || 5)),
    },
    background: p.background?.type ? p.background : fallback.pages[0].background,
    buttons: Array.isArray(p.buttons) ? p.buttons.filter((b: any) => b && typeof b.id === 'string') : [],
  }));
  if (pages.length === 0) return fallback;
  return {
    pages,
    layoutPreference: normalizeLayout(raw.layoutPreference, fallback.layoutPreference!),
  };
}

function loadConfig(): DeckConfig {
  let raw: any = null;
  try {
    if (fs.existsSync(CONFIG_FILE)) raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  const config = normalizeConfig(raw);
  let dirty = migrateAssetUrls(config);
  if (raw && JSON.stringify(raw.layoutPreference) !== JSON.stringify(config.layoutPreference)) {
    console.log('[XDECK] Cleaned up a malformed layout preference');
    dirty = true;
  }
  if (dirty) {
    console.log('[XDECK] Rewriting config after migration');
    saveConfig(config);
  }
  return config;
}

// Writes only the deck keys, preserving anything else already in the file
// (the pairing code lives here too and must survive a config save).
function saveConfig(config: DeckConfig): void {
  let data: any = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) || {};
  } catch {}
  data.pages = config.pages;
  data.layoutPreference = config.layoutPreference;
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

function generatePairingCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const CONFIG_MUTATIONS = new Set([
  'button_update', 'button_delete', 'page_update', 'page_delete',
  'background_update', 'grid_update', 'layout_update',
]);

/** First cell not already taken by another button, scanning row-major. */
function findFreeCell(page: Page, exceptId: string): { row: number; col: number } | null {
  for (let row = 0; row < page.grid.rows; row++) {
    for (let col = 0; col < page.grid.cols; col++) {
      const taken = page.buttons.some(
        (b) => b.id !== exceptId && b.position.row === row && b.position.col === col
      );
      if (!taken) return { row, col };
    }
  }
  return null;
}

/**
 * Keeps every button inside the grid. Without this a button saved against a stale
 * grid size (or dropped on an occupied cell) lands outside the rendered slots and
 * looks like "the button was never added".
 */
function placeButton(page: Page, button: Button): void {
  const row = Math.max(0, Math.min(page.grid.rows - 1, button.position?.row ?? 0));
  const col = Math.max(0, Math.min(page.grid.cols - 1, button.position?.col ?? 0));
  const occupied = page.buttons.some(
    (b) => b.id !== button.id && b.position.row === row && b.position.col === col
  );
  button.position = occupied ? (findFreeCell(page, button.id) ?? { row, col }) : { row, col };
}

function reflowPage(page: Page): void {
  for (const button of page.buttons) {
    if (button.position.row >= page.grid.rows || button.position.col >= page.grid.cols) {
      placeButton(page, button);
    }
  }
}

/**
 * Applies a phone-originated config change. Returns true when the config actually
 * changed — callers must not persist or broadcast otherwise, or an edit aimed at an
 * unknown page would echo a config_sync that silently reverts the phone's view.
 */
function applyConfigMutation(config: DeckConfig, msg: any): boolean {
  switch (msg.type) {
    case 'button_update': {
      const page = config.pages.find((p) => p.id === msg.pageId);
      if (!page || !msg.button?.id) return false;
      const button: Button = { ...msg.button };
      placeButton(page, button);
      const idx = page.buttons.findIndex((b) => b.id === button.id);
      if (idx >= 0) page.buttons[idx] = button;
      else page.buttons.push(button);
      return true;
    }
    case 'button_delete': {
      const page = config.pages.find((p) => p.id === msg.pageId);
      if (!page) return false;
      const before = page.buttons.length;
      page.buttons = page.buttons.filter((b) => b.id !== msg.buttonId);
      return page.buttons.length !== before;
    }
    case 'page_update': {
      if (!msg.page?.id) return false;
      const idx = config.pages.findIndex((p) => p.id === msg.page.id);
      if (idx >= 0) config.pages[idx] = msg.page;
      else config.pages.push(msg.page);
      reflowPage(config.pages[idx >= 0 ? idx : config.pages.length - 1]);
      return true;
    }
    case 'page_delete': {
      if (config.pages.length <= 1) return false; // never leave the deck pageless
      const before = config.pages.length;
      config.pages = config.pages.filter((p) => p.id !== msg.pageId);
      return config.pages.length !== before;
    }
    case 'background_update': {
      const page = config.pages.find((p) => p.id === msg.pageId);
      if (!page || !msg.background?.type) return false;
      page.background = msg.background;
      return true;
    }
    case 'grid_update': {
      const page = config.pages.find((p) => p.id === msg.pageId);
      if (!page || !msg.grid) return false;
      page.grid = {
        cols: Math.max(1, Math.min(8, Number(msg.grid.cols) || page.grid.cols)),
        rows: Math.max(1, Math.min(10, Number(msg.grid.rows) || page.grid.rows)),
      };
      reflowPage(page);
      return true;
    }
    case 'layout_update': {
      if (!msg.layoutPreference?.orientation) return false;
      config.layoutPreference = normalizeLayout(
        msg.layoutPreference,
        config.layoutPreference || DEFAULT_CONFIG.layoutPreference!,
      );
      return true;
    }
    default:
      return false;
  }
}

function loadPairingCode(): string {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (data.pairingCode) return data.pairingCode;
  } catch {}
  const code = generatePairingCode();
  savePairingCode(code);
  return code;
}

function savePairingCode(code: string): void {
  let data: any = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) || {};
    }
  } catch {}
  data.pairingCode = code;
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

/**
 * Returns the key the user pasted in, or '' if they haven't bought one yet.
 * The desktop never mints keys — a self-generated key would let anyone use Cloud
 * mode for free, and keys are only ever issued by the store.
 */
function loadLicenseKey(): string {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const key = fs.readFileSync(LICENSE_FILE, 'utf-8').trim();
      if (key) return key;
    }
  } catch {}
  return '';
}

/** Shape check only — the relay is the sole authority on whether a key is real. */
function looksLikeLicenseKey(key: string): boolean {
  return /^XDECK-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/i.test(key.trim());
}

function saveLicenseKey(key: string): void {
  fs.writeFileSync(LICENSE_FILE, key);
}

function clearLicenseKey(): void {
  try { fs.rmSync(LICENSE_FILE, { force: true }); } catch {}
}

/**
 * Stable identity for this install. The relay uses it to allow this machine to
 * reclaim its own session after a sleep/network drop while still refusing a
 * different machine that is using the same key.
 */
function loadDeviceId(): string {
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) {
      const id = fs.readFileSync(DEVICE_ID_FILE, 'utf-8').trim();
      if (id) return id;
    }
  } catch {}
  const id = crypto.randomUUID();
  try { fs.writeFileSync(DEVICE_ID_FILE, id); } catch {}
  return id;
}

const DEVICE_ID = loadDeviceId();

let relayWs: WebSocket | null = null;
let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relayReconnectDelay = 5000;
let relayAuthFailed = false;
/** Set by /relay/disconnect so the close handler doesn't immediately reconnect. */
let relayDisabled = false;
/** Last fatal relay message, surfaced to the desktop UI via /relay/status. */
let relayLastError: string | null = null;

function connectToRelay(licenseKey: string, config: DeckConfig, broadcast: (msg: WSMessage) => void, wss: WebSocketServer) {
  if (relayWs) { relayWs.close(); relayWs = null; }
  if (relayReconnectTimer) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }
  relayAuthFailed = false;
  relayDisabled = false;
  relayLastError = null;

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
      deviceId: DEVICE_ID,
    }));
  });

  const sendConfig = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'config_sync',
      pages: config.pages,
      layoutPreference: config.layoutPreference,
    } as WSMessage));
  };

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'relay_auth_ok') {
        console.log('[RELAY] Authenticated as desktop');
        relayAuthFailed = false;
        relayLastError = null;
        relayReconnectDelay = 5000;
        // Only persist a key the relay has actually accepted, so a typo or a
        // stranger's key never becomes this install's remembered key.
        saveLicenseKey(licenseKey);
        // The relay drops frames with no peer, so this only lands if the phone is
        // already waiting. The relay_status handler below covers the other order.
        sendConfig();
        return;
      }

      if (msg.type === 'relay_status') {
        console.log(`[RELAY] Phone ${msg.connected ? 'connected' : 'disconnected'}${msg.peer ? ': ' + msg.peer : ''}`);
        serverEvents.emit('relay_status', msg.connected);
        // Critical: the phone joined after us, so it has no config yet. Without this
        // the phone renders its built-in default deck and every edit it makes is
        // computed against a config the desktop never had.
        if (msg.connected) sendConfig();
        return;
      }

      if (msg.type === 'relay_error') {
        console.error('[RELAY] Error:', msg.error);
        if (msg.error === 'key_in_use') {
          // One key, one machine. Retrying in a loop would just fight the other
          // machine, so stop and tell the user to buy their own key.
          relayAuthFailed = true;
          relayLastError = msg.message
            || 'This license key is already in use on another computer. Each key works on one computer at a time — buy your own key to use Cloud Relay.';
        } else if (msg.error?.includes('Invalid license key')) {
          relayAuthFailed = true;
          relayLastError = msg.message || 'That license key is not valid. Enter the key from your purchase confirmation.';
          // Don't keep an unusable key around pretending Cloud mode is configured.
          clearLicenseKey();
        } else if (msg.error === 'replaced') {
          relayLastError = 'This computer\'s session was taken over by another XDECK instance.';
        }
        return;
      }

      if (msg.type === 'config_request') {
        sendConfig();
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' } as WSMessage));
        return;
      }

      // Forward to local processing
      if (msg.type === 'file_upload') {
        try {
          const buffer = Buffer.from(msg.data, 'base64');
          const dir = path.join(UPLOADS_DIR, msg.dir || 'icons');
          fs.mkdirSync(dir, { recursive: true });
          const safeName = path.basename(msg.filename || `${uuidv4()}.bin`);
          const filePath = path.join(dir, safeName);
          fs.writeFileSync(filePath, buffer);
          console.log(`[RELAY] File uploaded: ${filePath}`);
          // A bare "/uploads/..." path is meaningless to a phone on the internet, so
          // hand back a data URL that renders from anywhere.
          const mime = MIME_BY_EXT[path.extname(safeName).toLowerCase()] || 'image/png';
          ws.send(JSON.stringify({
            type: 'file_upload_result',
            uploadId: msg.uploadId,
            ok: true,
            path: `data:${mime};base64,${buffer.toString('base64')}`,
          }));
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
          console.log(`[RELAY] Trigger: ${msg.buttonId} not found — phone is out of sync, resending config`);
          ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok: false, error: 'Not found' }));
          sendConfig();
        }
        return;
      }

      // Config changes from the phone, via the relay
      if (CONFIG_MUTATIONS.has(msg.type)) {
        if (applyConfigMutation(config, msg)) {
          saveConfig(config);
          const syncMsg: WSMessage = { type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference };
          ws.send(JSON.stringify(syncMsg));
          broadcast(syncMsg);
        } else {
          console.warn(`[RELAY] Ignored ${msg.type} (nothing matched); resyncing phone`);
          sendConfig();
        }
      }
    } catch (e) {
      console.error('[RELAY] Message error:', e);
    }
  });

  ws.on('close', () => {
    relayWs = null;
    if (relayDisabled) {
      console.log('[RELAY] Disconnected by request.');
      return;
    }
    if (relayAuthFailed) {
      console.log(`[RELAY] Not reconnecting: ${relayLastError || 'auth failed'}`);
      return;
    }
    console.log(`[RELAY] Disconnected, reconnecting in ${relayReconnectDelay / 1000}s...`);
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

        if (msg.type === 'config_request') {
          ws.send(JSON.stringify({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference } as WSMessage));
          return;
        }

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' } as WSMessage));
          return;
        }

        if (msg.type === 'trigger') {
          const btn = findButton(config, msg.buttonId);
          console.log(`[XDECK] Trigger: ${msg.buttonId}, found: ${!!btn}, action: ${btn?.action.kind} → ${btn?.action.target}`);
          if (btn) {
            const ok = await launchTarget(btn.action);
            console.log(`[XDECK] Trigger result: ok=${ok}`);
            ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok } as WSMessage));
          } else {
            console.log(`[XDECK] Trigger: button not found — resyncing client`);
            ws.send(JSON.stringify({ type: 'trigger_result', buttonId: msg.buttonId, ok: false, error: 'Not found' } as WSMessage));
            ws.send(JSON.stringify({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference } as WSMessage));
          }
          return;
        }

        if (CONFIG_MUTATIONS.has(msg.type)) {
          if (applyConfigMutation(config, msg)) {
            saveConfig(config);
            const syncMsg: WSMessage = { type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference };
            broadcast(syncMsg);
            // Keep a relay-attached phone in step with LAN-side edits.
            if (relayWs?.readyState === WebSocket.OPEN) relayWs.send(JSON.stringify(syncMsg));
          } else {
            console.warn(`[XDECK] Ignored ${msg.type} (nothing matched); resyncing client`);
            ws.send(JSON.stringify({ type: 'config_sync', pages: config.pages, layoutPreference: config.layoutPreference } as WSMessage));
          }
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
    res.json({
      connected: relayWs?.readyState === WebSocket.OPEN,
      licenseKey: licenseKey || null,
      error: relayLastError,
      authFailed: relayAuthFailed,
    });
  });

  expressApp.post('/relay/connect', (req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        const trimmed = typeof key === 'string' ? key.trim().toUpperCase() : '';
        if (!trimmed) { res.status(400).json({ error: 'Enter your license key.' }); return; }
        if (!looksLikeLicenseKey(trimmed)) {
          res.status(400).json({ error: 'That does not look like an XDECK key. It should read XDECK-XXXX-XXXX-XXXX-XXXX.' });
          return;
        }
        // Held in memory only; connectToRelay persists it once the relay accepts it.
        licenseKey = trimmed;
        connectToRelay(trimmed, config, broadcast, wss);
        res.json({ ok: true });
      } catch { res.status(400).json({ error: 'Invalid request' }); }
    });
  });

  expressApp.post('/relay/disconnect', (_req, res) => {
    relayDisabled = true;
    relayAuthFailed = false;
    relayLastError = null;
    if (relayReconnectTimer) { clearTimeout(relayReconnectTimer); relayReconnectTimer = null; }
    if (relayWs) { relayWs.close(); relayWs = null; }
    res.json({ ok: true });
  });

  return { wss, httpServer, config };
}

// Run directly with tsx
if (require.main === module) {
  startServer();
}
