import type { HaExtApi, HaExtApiInstallOptions, JsonRecord, PluginFileEntry } from './types'

const CLIENT_SOURCE = 'ha-ext-api-client'
const HOST_SOURCE = 'ha-ext-api-host'
const PLUGIN_PROTOCOL = 'huaianext:'

interface PendingCall {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
}

interface WaitingPort {
  reject: (error: Error) => void
  resolve: (port: MessagePort) => void
}

interface InstallOptions extends HaExtApiInstallOptions {
  target?: Window
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function cleanAssetPath(path: string): string {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .split('/')
    .filter(part => part && part !== '.')
    .map(part => encodeURIComponent(part))
    .join('/')
}

function pluginIdFromLocation(target: Window): string {
  if (target.location.protocol !== PLUGIN_PROTOCOL) return ''
  return decodeURIComponent(target.location.hostname)
}

export function createHaExtApiClient(options: InstallOptions = {}): HaExtApi {
  const target = options.target ?? window
  let apiPort: MessagePort | null = null
  let pluginId = pluginIdFromLocation(target)
  let nextId = 0
  const pending = new Map<number, PendingCall>()
  const waitingPorts: WaitingPort[] = []

  function resolvePortWaiters(port: MessagePort): void {
    while (waitingPorts.length) waitingPorts.shift()?.resolve(port)
  }

  function waitForPort(): Promise<MessagePort> {
    if (apiPort) return Promise.resolve(apiPort)
    return new Promise((resolve, reject) => waitingPorts.push({ resolve, reject }))
  }

  function handlePortMessage(event: MessageEvent): void {
    const data = asRecord(event.data)
    if (data.source !== HOST_SOURCE || data.type !== 'response') return
    const id = Number(data.id)
    const item = pending.get(id)
    if (!item) return
    pending.delete(id)
    if (data.ok) item.resolve(data.value)
    else item.reject(new Error(typeof data.error === 'string' ? data.error : 'Plugin API call failed'))
  }

  function connect(port: MessagePort, nextPluginId: unknown): void {
    pluginId = typeof nextPluginId === 'string' && nextPluginId ? nextPluginId : pluginId
    apiPort?.close()
    apiPort = port
    apiPort.onmessage = handlePortMessage
    apiPort.start()
    resolvePortWaiters(apiPort)
  }

  function call(method: string, args: unknown[]): Promise<unknown> {
    const id = ++nextId
    return waitForPort().then(port => {
      port.postMessage({
        source: CLIENT_SOURCE,
        type: 'call',
        id,
        method,
        args
      })
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    })
  }

  target.addEventListener('message', event => {
    const data = asRecord(event.data)
    if (data.source !== HOST_SOURCE || data.type !== 'connect') return
    const port = event.ports?.[0]
    if (!port) return
    connect(port, data.pluginId)
  })

  const api: HaExtApi = {
    assetUrl(path: string): string {
      return `huaianext://${encodeURIComponent(pluginId)}/${cleanAssetPath(path)}`
    },
    storage: {
      list: (path?: string) => call('storage.list', [path || '']) as Promise<PluginFileEntry[]>,
      listFor: (targetPluginId: string, path?: string) => (
        call('storage.listFor', [targetPluginId, path || '']) as Promise<PluginFileEntry[]>
      ),
      readText: (path: string) => call('storage.readText', [path]) as Promise<string>,
      readTextFor: (targetPluginId: string, path: string) => (
        call('storage.readTextFor', [targetPluginId, path]) as Promise<string>
      ),
      readBase64: (path: string) => call('storage.readBase64', [path]) as Promise<string>,
      readBase64For: (targetPluginId: string, path: string) => (
        call('storage.readBase64For', [targetPluginId, path]) as Promise<string>
      ),
      writeText: (path: string, content: string) => call('storage.writeText', [path, content]) as Promise<void>,
      writeTextFor: (targetPluginId: string, path: string, content: string) => (
        call('storage.writeTextFor', [targetPluginId, path, content]) as Promise<void>
      ),
      writeBase64: (path: string, content: string) => call('storage.writeBase64', [path, content]) as Promise<void>,
      writeBase64For: (targetPluginId: string, path: string, content: string) => (
        call('storage.writeBase64For', [targetPluginId, path, content]) as Promise<void>
      ),
      delete: (path: string) => call('storage.delete', [path]) as Promise<void>,
      deleteFor: (targetPluginId: string, path: string) => (
        call('storage.deleteFor', [targetPluginId, path]) as Promise<void>
      ),
      readJson: (path: string, fallback?: unknown) => call('storage.readJson', [path, fallback]),
      readJsonFor: (targetPluginId: string, path: string, fallback?: unknown) => (
        call('storage.readJsonFor', [targetPluginId, path, fallback])
      ),
      writeJson: (path: string, value: unknown) => call('storage.writeJson', [path, value]) as Promise<void>,
      writeJsonFor: (targetPluginId: string, path: string, value: unknown) => (
        call('storage.writeJsonFor', [targetPluginId, path, value]) as Promise<void>
      )
    }
  }

  if (options.chat) {
    api.chat = {
      getSession: () => call('chat.getSession', []) as ReturnType<NonNullable<HaExtApi['chat']>['getSession']>,
      getPluginData: () => call('chat.getPluginData', []) as Promise<JsonRecord>,
      setPluginData: (value: JsonRecord) => call('chat.setPluginData', [value]) as Promise<JsonRecord>
    }
  }

  if (options.toolSettings) {
    api.toolSettings = {
      getCommonArgs: () => call('toolSettings.getCommonArgs', []) as Promise<JsonRecord>,
      setCommonArgs: (value: JsonRecord) => call('toolSettings.setCommonArgs', [value]) as Promise<JsonRecord>
    }
  }

  return api
}

export function installHaExtApi(options: InstallOptions = {}): HaExtApi {
  const target = options.target ?? window
  if (target.haExtApi) return target.haExtApi
  const api = createHaExtApiClient({ ...options, target })
  Object.defineProperty(target, 'haExtApi', {
    configurable: true,
    enumerable: true,
    value: api,
    writable: false
  })
  return api
}

declare global {
  interface Window {
    haExtApi: HaExtApi
  }
}
