import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'

const isDev = process.env.NODE_ENV === 'development'

// 配置文件路径
const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

// 配置接口
interface AppConfig {
}

// 读取配置
async function readConfig(): Promise<AppConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    // 如果文件不存在或读取失败，返回空配置
    return {}
  }
}

// 保存配置
async function saveConfig(config: AppConfig): Promise<void> {
  try {
    // 确保目录存在
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('保存配置失败:', error)
  }
}

function createWindow(config: AppConfig): void {
  let mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js')
    }
  })
  // 加载页面
  if (isDev) {
    // 开发环境：加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach', title: 'ITM Devtool' })
  } else {
    // 生产环境：加载打包后的文件
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.show()

}

// 系统信息API处理器
ipcMain.handle('system:platform', () => process.platform)
ipcMain.handle('system:arch', () => process.arch)
ipcMain.handle('system:versions', () => process.versions)
ipcMain.handle('system:nodeVersion', () => process.version)
ipcMain.handle('system:getCwd', () => process.cwd())
ipcMain.handle('system:getEnv', (_, key: string) => process.env[key])
// 应用控制API处理器
ipcMain.handle('app:getVersion', () => app.getVersion())
ipcMain.handle('app:getName', () => app.getName())
ipcMain.handle('app:getPath', (_, name: string) => app.getPath(name as any))
ipcMain.handle('app:quit', () => app.quit())

// 窗口控制API处理器
ipcMain.handle('window:minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.minimize()
  }
})

ipcMain.handle('window:maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  }
})

ipcMain.handle('window:show', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.show()
  }
})

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    authors: ['Yricky'],
  })
  // 读取配置，获取上次打开的工作区路径
  const config = await readConfig()
  createWindow(config)
})

app.on('window-all-closed', () => {
  app.quit()
})