const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('astroRenderWorker', {
  send(command) { ipcRenderer.send('render-worker:command', command); },
  subscribe(listener) {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('render-worker:message', handler);
    return () => ipcRenderer.removeListener('render-worker:message', handler);
  },
  saveOutput(sourcePath, suggestedName) { return ipcRenderer.invoke('render-worker:save-output', sourcePath, suggestedName); },
});
