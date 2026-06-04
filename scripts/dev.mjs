import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { build, createServer } from 'vite'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const rendererConfig = resolve(rootDir, 'vite.renderer.config.ts')
const mainConfig = resolve(rootDir, 'vite.main.config.ts')
const preloadConfig = resolve(rootDir, 'vite.preload.config.ts')

let electronProcess = null
let mainReady = false
let preloadReady = false
let shuttingDown = false
let restartTimer = null
const watchers = []

function spawnElectron() {
  if (!mainReady || !preloadReady || shuttingDown) return

  if (electronProcess) {
    electronProcess.removeAllListeners()
    electronProcess.kill()
  }

  electronProcess = spawn(electronPath, ['.'], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: 'development'
    },
    stdio: 'inherit'
  })

  electronProcess.on('exit', code => {
    if (!shuttingDown && code && code !== 0) {
      process.exit(code)
    }
  })
}

function scheduleElectronRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(spawnElectron, 120)
}

async function watchBuild(configFile, label, markReady) {
  const watcher = await build({
    build: {
      watch: {}
    },
    configFile,
    mode: 'development'
  })

  watcher.on('event', event => {
    if (event.code === 'ERROR') {
      console.error(`[${label}]`, event.error)
      return
    }
    if (event.code === 'END') {
      markReady()
      scheduleElectronRestart()
    }
  })

  watchers.push(watcher)
}

async function closeAll() {
  shuttingDown = true
  clearTimeout(restartTimer)
  if (electronProcess) {
    electronProcess.removeAllListeners()
    electronProcess.kill()
  }
  await Promise.all(watchers.map(watcher => watcher.close()))
  await rendererServer?.close()
}

const rendererServer = await createServer({
  configFile: rendererConfig,
  mode: 'development'
})

await rendererServer.listen()
rendererServer.printUrls()

await watchBuild(mainConfig, 'main', () => {
  mainReady = true
})
await watchBuild(preloadConfig, 'preload', () => {
  preloadReady = true
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await closeAll()
    process.exit(0)
  })
}
