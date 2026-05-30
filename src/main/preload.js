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
    show: () => ipcRenderer.invoke('window:show'),
    forceOpen: () => ipcRenderer.invoke('window:forceOpen'),
  },
  notify: (opts) => ipcRenderer.invoke('notify', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('tray:setMinimizeToTray', enabled),
})
