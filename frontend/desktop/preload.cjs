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

contextBridge.exposeInMainWorld('paralastroDesktop', {
  loadPreferences() { return ipcRenderer.sendSync('desktop:preferences:load'); },
  savePreferences(value) { ipcRenderer.send('desktop:preferences:save', value); },
  showLogs() { return ipcRenderer.invoke('desktop:show-logs'); },
  onServiceFailure(listener) {
    const handler = (_event, failure) => listener(failure);
    ipcRenderer.on('desktop:service-failed', handler);
    return () => ipcRenderer.removeListener('desktop:service-failed', handler);
  },
});
