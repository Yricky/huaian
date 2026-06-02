import { BrowserWindow } from 'electron'
import { join } from 'path'
import { isDev } from './project/constants'

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      sandbox: false,
      nodeIntegrationInSubFrames: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js')
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach', title: 'ST Forge Devtool' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
}
