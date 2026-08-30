import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as http from 'http';
import { autoUpdater } from 'electron-updater';
import { startServer, serverEvents } from '../server/index';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pairingInfo: { ip: string; port: number; code: string; qr: string } | null = null;
const SERVER_PORT = 8787;

function getIconPath(): string {
  return path.join(__dirname, '../../assets/icon.png');
}

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function httpPost(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST' }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPostJson(url: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function createWindow(): void {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    title: 'XDECK',
    icon: nativeImage.createFromPath(getIconPath()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    resizable: false,
    frame: false,
    transparent: true,
    skipTaskbar: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromPath(getIconPath());
    tray = new Tray(icon);
    tray.setToolTip('XDECK - LAN Stream Deck');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show XDECK', click: () => createWindow() },
      { label: 'Open Pairing Page', click: () => shell.openExternal(`http://localhost:${SERVER_PORT}/pairing`) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', () => createWindow());
  } catch (e) {
    console.error('[XDECK] Tray creation failed:', e);
  }
}

ipcMain.handle('get-pairing-info', () => pairingInfo);
ipcMain.handle('get-devices', async () => {
  try { return await httpGet(`http://localhost:${SERVER_PORT}/devices`); } catch { return []; }
});
ipcMain.handle('regenerate-pairing', async () => {
  await httpPost(`http://localhost:${SERVER_PORT}/pairing/regenerate`);
  pairingInfo = await httpGet(`http://localhost:${SERVER_PORT}/pairing`);
  return pairingInfo;
});
ipcMain.handle('minimize-window', () => mainWindow?.minimize());
ipcMain.handle('close-window', () => mainWindow?.hide());
ipcMain.handle('browse-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['desktop', 'sh', 'exe', 'app', 'AppImage'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-relay-status', async () => {
  try { return await httpGet(`http://localhost:${SERVER_PORT}/relay/status`); } catch { return { connected: false }; }
});
ipcMain.handle('connect-relay', async (_event, licenseKey: string) => {
  try { return await httpPostJson(`http://localhost:${SERVER_PORT}/relay/connect`, { key: licenseKey }); } catch { return { ok: false }; }
});
ipcMain.handle('disconnect-relay', async () => {
  try { return await httpPost(`http://localhost:${SERVER_PORT}/relay/disconnect`); } catch { return { ok: false }; }
});

app.whenReady().then(async () => {
  // Auto-update: check for updates on startup (non-blocking)
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m: string) => console.log('[UPDATE]', m), warn: (m: string) => console.warn('[UPDATE]', m), error: (m: string) => console.error('[UPDATE]', m) } as any;
  autoUpdater.on('update-available', () => console.log('[UPDATE] Update available, downloading...'));
  autoUpdater.on('update-downloaded', () => {
    console.log('[UPDATE] Update downloaded, will install on quit');
    dialog.showMessageBox({ type: 'info', title: 'Update Ready', message: 'A new version of XDECK will be installed when you restart the app.', buttons: ['OK'] });
  });
  autoUpdater.on('error', (e) => console.error('[UPDATE] Error:', e.message));
  autoUpdater.checkForUpdates().catch(() => {});

  startServer();

  // Wait for server to be ready (retry up to 10 times, 500ms apart)
  for (let i = 0; i < 10; i++) {
    try {
      pairingInfo = await httpGet(`http://localhost:${SERVER_PORT}/pairing`);
      if (pairingInfo) break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!pairingInfo) {
    pairingInfo = { ip: '127.0.0.1', port: SERVER_PORT, code: '------', qr: '' };
  }

  createTray();
  createWindow();

  // Hotkey events — just log, no window manipulation needed
  serverEvents.on('before-hotkey', () => {});
  serverEvents.on('after-hotkey', () => {});
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
