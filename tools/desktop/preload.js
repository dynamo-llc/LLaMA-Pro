const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startRpcServer: () => ipcRenderer.invoke('start-rpc-server'),
  stopRpcServer: () => ipcRenderer.invoke('stop-rpc-server'),
  restartBackend: (options) => ipcRenderer.invoke('restart-backend', options),
  getPorts: () => ipcRenderer.invoke('get-ports'),
  exportLogs: (logText) => ipcRenderer.invoke('export-logs', logText),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_event, error) => callback(error)),
  onBackendLog: (callback) => ipcRenderer.on('backend-log', (_event, data) => callback(data))
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('LLaMA Pro Desktop preload loaded.');
});
