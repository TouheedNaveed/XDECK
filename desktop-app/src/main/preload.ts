import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('xdeck', {
  getPairingInfo: () => ipcRenderer.invoke('get-pairing-info'),
  regeneratePairing: () => ipcRenderer.invoke('regenerate-pairing'),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  browseFile: () => ipcRenderer.invoke('browse-file'),
  getRelayStatus: () => ipcRenderer.invoke('get-relay-status'),
  connectRelay: (licenseKey: string) => ipcRenderer.invoke('connect-relay', licenseKey),
  disconnectRelay: () => ipcRenderer.invoke('disconnect-relay'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
});
