const { app, BrowserWindow, ipcMain, shell, Notification, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8')
}

let mainWindow
let tray = null
let forceQuit = false

function createTray() {
  const iconPath = path.join(__dirname, '../../src/renderer/assets/icon.ico')
  let trayIcon
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
  } catch {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('Omni Messenger')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть Omni',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => {
        forceQuit = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#080810',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../src/renderer/assets/icon.ico'),
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (forceQuit) return
    const cfg = loadConfig()
    if (cfg.minimizeToTray !== false) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

app.whenReady().then(() => {
  createTray()
  createWindow()

  const cfg = loadConfig()
  if (cfg.autoStart !== undefined) {
    app.setLoginItemSettings({ openAtLogin: !!cfg.autoStart })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit — stay in tray
  }
})

app.on('before-quit', () => {
  forceQuit = true
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else if (mainWindow) mainWindow.show()
})

ipcMain.handle('config:load', () => loadConfig())
ipcMain.handle('config:save', (_, data) => { saveConfig(data); return true })

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => {
  const cfg = loadConfig()
  if (cfg.minimizeToTray !== false) {
    mainWindow?.hide()
  } else {
    forceQuit = true
    mainWindow?.close()
  }
})
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('window:show', () => { mainWindow?.show(); mainWindow?.focus() })

ipcMain.handle('notify', (_, { title, body }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body })
    n.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
    n.show()
  }
})

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))

ipcMain.handle('autostart:get', () => {
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('autostart:set', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  const cfg = loadConfig()
  saveConfig({ ...cfg, autoStart: !!enabled })
  return true
})

ipcMain.handle('tray:setMinimizeToTray', (_, enabled) => {
  const cfg = loadConfig()
  saveConfig({ ...cfg, minimizeToTray: !!enabled })
  return true
})

ipcMain.handle('window:forceOpen', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.setAlwaysOnTop(true)
    setTimeout(() => mainWindow?.setAlwaysOnTop(false), 10000)
  }
})
