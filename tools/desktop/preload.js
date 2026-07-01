const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startRpcServer: () => ipcRenderer.invoke('start-rpc-server'),
  stopRpcServer: () => ipcRenderer.invoke('stop-rpc-server'),
  restartBackend: (options) => ipcRenderer.invoke('restart-backend', options)
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('LLaMA Pro Desktop preload loaded.');
});
