const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (data) => ipcRenderer.invoke('config:save', data),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  notify: (opts) => ipcRenderer.invoke('notify', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
})
