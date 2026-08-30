import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { autoUpdater } from 'electron-updater';
import { startServer, serverEvents } from '../server/index';

function integrateLinuxDesktop() {
  if (process.platform !== 'linux') return;
  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath) return;

  try {
    const homeDir = os.homedir();
    const destDir = path.join(homeDir, '.local/share/xdeck');
    fs.mkdirSync(destDir, { recursive: true });

    const iconDest = path.join(destDir, 'icon.png');
    const sourceIcon = getIconPath();
    if (fs.existsSync(sourceIcon)) {
      fs.copyFileSync(sourceIcon, iconDest);
    }

    const desktopFileDir = path.join(homeDir, '.local/share/applications');
    fs.mkdirSync(desktopFileDir, { recursive: true });
    const desktopFilePath = path.join(desktopFileDir, 'xdeck.desktop');

    const desktopContent = `[Desktop Entry]
Name=XDECK
Exec="${appImagePath}" %U
Terminal=false
Type=Application
Icon=${iconDest}
StartupWMClass=XDECK
Comment=XDECK Stream Deck App
Categories=Utility;
`;

    fs.writeFileSync(desktopFilePath, desktopContent, 'utf-8');
    fs.chmodSync(desktopFilePath, 0o755);

    try {
      execSync('update-desktop-database ~/.local/share/applications || true');
    } catch {}
    console.log('[LINUX] Integrated desktop launcher and icon successfully.');
  } catch (e: any) {
    console.error('[LINUX] Desktop integration failed:', e.message);
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pairingInfo: { ip: string; port: number; code: string; qr: string } | null = null;
const SERVER_PORT = 8787;

function getIconPath(): string {
  const resourcesPath = (process as any).resourcesPath || path.join(__dirname, '..');
  const iconPath = path.join(resourcesPath, 'icon.png');
  if (fs.existsSync(iconPath)) return iconPath;
  return path.join(__dirname, '../../assets/icon.png');
}

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
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
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
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

  const iconPath = getIconPath();
  if (fs.existsSync(iconPath)) {
    mainWindow.setIcon(nativeImage.createFromPath(iconPath));
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates().catch(() => {});
    // Check for updates every 5 minutes (300,000 ms)
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 300000);
  });
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
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
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
  if (process.platform === 'linux') {
    app.setName('XDECK');
    integrateLinuxDesktop();
  }
  // Prevent ugly crash dialog on uncaught errors
  process.on('uncaughtException', (err) => {
    console.error('[MAIN] Uncaught exception:', err.message);
    if (err.message.includes('EADDRINUSE')) {
      dialog.showMessageBox({ type: 'error', title: 'XDECK is already running', message: `Port ${SERVER_PORT} is in use.\n\nClose the other XDECK instance and try again.`, buttons: ['OK'] }).then(() => app.quit());
    }
  });
  // Auto-update: check for updates on startup (non-blocking)
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m: string) => console.log('[UPDATE]', m), warn: (m: string) => console.warn('[UPDATE]', m), error: (m: string) => console.error('[UPDATE]', m) } as any;

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', 'checking');
  });
  autoUpdater.on('update-available', () => {
    console.log('[UPDATE] Update available, downloading...');
    mainWindow?.webContents.send('update-status', 'available');
  });
  autoUpdater.on('download-progress', () => {
    mainWindow?.webContents.send('update-status', 'downloading');
  });
  autoUpdater.on('update-downloaded', () => {
    console.log('[UPDATE] Update downloaded, ready to install');
    mainWindow?.webContents.send('update-status', 'downloaded');
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[UPDATE] Update not available');
    mainWindow?.webContents.send('update-status', 'not-available');
  });
  autoUpdater.on('error', (e) => {
    console.error('[UPDATE] Error:', e.message);
    mainWindow?.webContents.send('update-status', 'error');
  });

  startServer();

  // Poll until the server responds with valid pairing info
  for (let i = 0; i < 60; i++) {
    try {
      const info = await httpGet(`http://127.0.0.1:${SERVER_PORT}/pairing`);
      if (info && info.ip) {
        pairingInfo = info;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
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
