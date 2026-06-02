import type {
  HaExtApi,
  JsonRecord,
  PluginDescriptor,
  PluginFileEntry,
  PluginGlobalExport,
  PluginGlobalRegistry,
  PluginManifest,
  PluginRuntimeContext,
  PluginStorageApi,
  PluginToolCallRequest,
  ProcessingChat
} from '../../../shared/types'
import { asRecord, asString } from '../../../shared/value-utils'

const HOST_SOURCE = 'ha-ext-worker-host'
const WORKER_SOURCE = 'ha-ext-worker'
const CLIENT_SOURCE = 'ha-ext-api-client'
const API_HOST_SOURCE = 'ha-ext-api-host'

interface PendingHostCall {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
}

interface FrameRuntimeContext {
  capabilities: {
    chat?: boolean
    toolSettings?: boolean
  }
  pluginId: string
  port: MessagePort
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const pluginGlobals: Record<string, PluginGlobalExport> = {}
const pendingHostCalls = new Map<number, PendingHostCall>()
const frames = new Map<string, FrameRuntimeContext>()
let loadedProjectSignature = ''
let nextHostCallId = 0

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function safeResponseValue(value: unknown): unknown {
  try {
    return cloneJson(value)
  } catch {
    return null
  }
}

function postToHost(message: JsonRecord, transfer?: Transferable[]): void {
  globalThis.postMessage({
    source: WORKER_SOURCE,
    ...message
  }, transfer ? { transfer } : undefined)
}

function callHost<T = unknown>(method: string, args: JsonRecord): Promise<T> {
  const id = ++nextHostCallId
  postToHost({
    type: 'host-call',
    id,
    method,
    args
  })
  return new Promise<T>((resolve, reject) => (
    pendingHostCalls.set(id, { resolve: resolve as (value: unknown) => void, reject })
  ))
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

function pluginAssetUrl(pluginId: string, path: string): string {
  return `huaianext://${encodeURIComponent(pluginId)}/${cleanAssetPath(path)}`
}

function storageApi(pluginId: string): PluginStorageApi {
  const writeText: PluginStorageApi['writeText'] = (path, content) => callHost<void>('storage.writeText', {
    pluginId,
    path: String(path ?? ''),
    content: String(content ?? '')
  })
  const writeTextFor: PluginStorageApi['writeTextFor'] = (targetPluginId, path, content) => callHost<void>('storage.writeText', {
    pluginId: String(targetPluginId ?? ''),
    path: String(path ?? ''),
    content: String(content ?? '')
  })
  const writeBase64: PluginStorageApi['writeBase64'] = (path, content) => callHost<void>('storage.writeBase64', {
    pluginId,
    path: String(path ?? ''),
    content: String(content ?? '')
  })
  const writeBase64For: PluginStorageApi['writeBase64For'] = (targetPluginId, path, content) => callHost<void>('storage.writeBase64', {
    pluginId: String(targetPluginId ?? ''),
    path: String(path ?? ''),
    content: String(content ?? '')
  })
  return {
    list: (path = '') => callHost<PluginFileEntry[]>('storage.list', { pluginId, path: String(path ?? '') }),
    listFor: (targetPluginId: string, path = '') => callHost<PluginFileEntry[]>('storage.list', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readText: (path: string) => callHost<string>('storage.readText', { pluginId, path: String(path ?? '') }),
    readTextFor: (targetPluginId: string, path: string) => callHost<string>('storage.readText', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readBase64: (path: string) => callHost<string>('storage.readBase64', { pluginId, path: String(path ?? '') }),
    readBase64For: (targetPluginId: string, path: string) => callHost<string>('storage.readBase64', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    writeText,
    writeTextFor,
    writeBase64,
    writeBase64For,
    delete: (path: string) => callHost<void>('storage.delete', { pluginId, path: String(path ?? '') }),
    deleteFor: (targetPluginId: string, path: string) => callHost<void>('storage.delete', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readJson: async (path: string, fallback = {}) => {
      try {
        return JSON.parse(await callHost<string>('storage.readText', { pluginId, path: String(path ?? '') }))
      } catch {
        return cloneJson(fallback)
      }
    },
    readJsonFor: async (targetPluginId: string, path: string, fallback = {}) => {
      try {
        return JSON.parse(await callHost<string>('storage.readText', {
          pluginId: String(targetPluginId ?? ''),
          path: String(path ?? '')
        }))
      } catch {
        return cloneJson(fallback)
      }
    },
    writeJson: (path: string, value: unknown) => writeText(path, `${JSON.stringify(value, null, 2)}\n`),
    writeJsonFor: (targetPluginId: string, path: string, value: unknown) => (
      writeTextFor(targetPluginId, path, `${JSON.stringify(value, null, 2)}\n`)
    )
  }
}

function haExtApiForPlugin(pluginId: string): HaExtApi {
  return {
    assetUrl: (path: string) => pluginAssetUrl(pluginId, path),
    storage: storageApi(pluginId)
  }
}

function registry(): PluginGlobalRegistry {
  return {
    get: (pluginId: string) => pluginGlobals[pluginId],
    all: () => ({ ...pluginGlobals })
  }
}

function normalizePluginGlobalExport(value: unknown, pluginId: string): PluginGlobalExport {
  const record = asRecord(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`插件 ${pluginId} 的 initGlobal 必须返回对象。`)
  }
  return {
    chatBlockProcessor: record.chatBlockProcessor as PluginGlobalExport['chatBlockProcessor'],
    toolCalls: asRecord(record.toolCalls) as PluginGlobalExport['toolCalls'],
    exports: asRecord(record.exports)
  }
}

function isModuleScript(code: string): boolean {
  return /^\s*import\s/m.test(code) || /\bexport\s+(default|\{|\*)/.test(code)
}

async function executeModuleScript(code: string, context: PluginRuntimeContext, plugins: PluginGlobalRegistry) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const module = await import(/* @vite-ignore */ url)
    const entry = module.default ?? module
    return typeof entry === 'function' ? entry(context, plugins, context.haExtApi) : entry
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function executePluginScript(
  plugin: PluginManifest,
  path: string,
  context: PluginRuntimeContext,
  plugins: PluginGlobalRegistry
) {
  const code = await callHost<string>('plugin.readFile', { pluginId: plugin.id, path })
  if (isModuleScript(code)) return executeModuleScript(code, context, plugins)
  const fn = new AsyncFunction('context', 'plugins', 'haExtApi', code)
  return fn(context, plugins, context.haExtApi)
}

async function ensurePluginRuntime(input: unknown): Promise<void> {
  const record = asRecord(input)
  const signature = asString(record.signature)
  if (signature && loadedProjectSignature === signature) return

  for (const key of Object.keys(pluginGlobals)) delete pluginGlobals[key]
  const activePlugins = Array.isArray(record.activePlugins) ? record.activePlugins as PluginDescriptor[] : []
  const pluginRegistry = registry()

  for (const descriptor of activePlugins) {
    const plugin = descriptor.manifest
    const initGlobal = plugin.entry?.initGlobal
    const context: PluginRuntimeContext = { haExtApi: haExtApiForPlugin(plugin.id), plugin }
    const globalExport = initGlobal
      ? await executePluginScript(plugin, initGlobal, context, pluginRegistry)
      : { exports: {} }
    pluginGlobals[plugin.id] = normalizePluginGlobalExport(globalExport, plugin.id)
  }
  loadedProjectSignature = signature
}

function sanitizeProcessingChatFactory(processingChat: ProcessingChat) {
  const canonicalOriginals = new Map((Array.isArray(processingChat.chatBlocks) ? processingChat.chatBlocks : [])
    .map(block => asRecord(block).original)
    .filter(original => typeof asRecord(original).id === 'number')
    .map(original => [asRecord(original).id, cloneJson(original)]))

  return (value: unknown): ProcessingChat => {
    const chatValue = asRecord(value) as unknown as ProcessingChat
    if (!Array.isArray(chatValue.chatBlocks)) return processingChat
    return {
      ...chatValue,
      chatBlocks: chatValue.chatBlocks.map(blockValue => {
        const block = asRecord(blockValue)
        const original = asRecord(block.original)
        const originalId = typeof original.id === 'number' ? original.id : null
        return originalId === null || !canonicalOriginals.has(originalId)
          ? blockValue
          : { ...block, original: cloneJson(canonicalOriginals.get(originalId)) }
      }) as ProcessingChat['chatBlocks']
    } as ProcessingChat
  }
}

async function preparePluginChatProcessing(input: unknown): Promise<ProcessingChat> {
  const record = asRecord(input)
  await ensurePluginRuntime(record.runtime)
  const runtime = asRecord(record.runtime)
  const activePlugins = Array.isArray(runtime.activePlugins) ? runtime.activePlugins as PluginDescriptor[] : []
  let processingChat = cloneJson(record.processingChat) as ProcessingChat
  const sanitizeProcessingChat = sanitizeProcessingChatFactory(processingChat)

  for (const descriptor of activePlugins) {
    const processor = pluginGlobals[descriptor.manifest.id]?.chatBlockProcessor
    if (typeof processor?.process !== 'function') continue
    const result = asRecord(await processor.process(processingChat))
    if (Array.isArray(result.chatBlocks)) processingChat = sanitizeProcessingChat(result)
  }

  return processingChat
}

async function handlePluginToolCallRequest(input: unknown): Promise<unknown> {
  const record = asRecord(input)
  await ensurePluginRuntime(record.runtime)
  const runtime = asRecord(record.runtime)
  const plugins = Array.isArray(runtime.allPlugins) ? runtime.allPlugins as PluginDescriptor[] : []
  const request = asRecord(record.request) as unknown as PluginToolCallRequest
  const descriptor = plugins.find(plugin => plugin.manifest.id === request.pluginId)
  const toolCalls = descriptor?.manifest.entry?.toolCalls
  const toolCall = Array.isArray(toolCalls) ? toolCalls.find(item => item.name === request.toolCallName) : null
  if (!descriptor || !toolCall) throw new Error('插件工具不存在。')

  const handler = pluginGlobals[descriptor.manifest.id]?.toolCalls?.[asString(request.toolCallName)]
  if (typeof handler?.handle !== 'function') throw new Error('插件工具没有导出 handle。')
  return handler.handle({
    chatId: Number(request.chatId),
    toolCallName: asString(request.toolCallName),
    toolName: asString(request.toolName),
    input: asRecord(request.input),
    commonArgs: asRecord(request.commonArgs)
  })
}

async function callFrameMethod(frameId: string, method: string, args: unknown[]): Promise<unknown> {
  const frame = frames.get(frameId)
  if (!frame) throw new Error('插件页面上下文不存在。')
  if (method === 'storage.list') return callHost('storage.list', { pluginId: frame.pluginId, path: String(args[0] ?? '') })
  if (method === 'storage.listFor') return callHost('storage.list', { pluginId: String(args[0]), path: String(args[1] ?? '') })
  if (method === 'storage.readText') return callHost('storage.readText', { pluginId: frame.pluginId, path: String(args[0]) })
  if (method === 'storage.readTextFor') return callHost('storage.readText', { pluginId: String(args[0]), path: String(args[1]) })
  if (method === 'storage.readBase64') return callHost('storage.readBase64', { pluginId: frame.pluginId, path: String(args[0]) })
  if (method === 'storage.readBase64For') return callHost('storage.readBase64', { pluginId: String(args[0]), path: String(args[1]) })
  if (method === 'storage.writeText') {
    return callHost('storage.writeText', { pluginId: frame.pluginId, path: String(args[0]), content: String(args[1] ?? '') })
  }
  if (method === 'storage.writeTextFor') {
    return callHost('storage.writeText', { pluginId: String(args[0]), path: String(args[1]), content: String(args[2] ?? '') })
  }
  if (method === 'storage.writeBase64') {
    return callHost('storage.writeBase64', { pluginId: frame.pluginId, path: String(args[0]), content: String(args[1] ?? '') })
  }
  if (method === 'storage.writeBase64For') {
    return callHost('storage.writeBase64', { pluginId: String(args[0]), path: String(args[1]), content: String(args[2] ?? '') })
  }
  if (method === 'storage.delete') return callHost('storage.delete', { pluginId: frame.pluginId, path: String(args[0]) })
  if (method === 'storage.deleteFor') return callHost('storage.delete', { pluginId: String(args[0]), path: String(args[1]) })
  if (method === 'storage.readJson') {
    try {
      return JSON.parse(String(await callHost('storage.readText', { pluginId: frame.pluginId, path: String(args[0]) })))
    } catch {
      return args[1] ?? {}
    }
  }
  if (method === 'storage.readJsonFor') {
    try {
      return JSON.parse(String(await callHost('storage.readText', { pluginId: String(args[0]), path: String(args[1]) })))
    } catch {
      return args[2] ?? {}
    }
  }
  if (method === 'storage.writeJson') {
    return callHost('storage.writeText', {
      pluginId: frame.pluginId,
      path: String(args[0]),
      content: `${JSON.stringify(args[1] ?? {}, null, 2)}\n`
    })
  }
  if (method === 'storage.writeJsonFor') {
    return callHost('storage.writeText', {
      pluginId: String(args[0]),
      path: String(args[1]),
      content: `${JSON.stringify(args[2] ?? {}, null, 2)}\n`
    })
  }

  if (method.startsWith('chat.')) {
    if (!frame.capabilities.chat) throw new Error('当前插件页面没有聊天 API。')
    if (method === 'chat.getSession') return callHost('frame.chat.getSession', { frameId })
    if (method === 'chat.getPluginData') return callHost('frame.chat.getPluginData', { frameId })
    if (method === 'chat.setPluginData') return callHost('frame.chat.setPluginData', { frameId, value: asRecord(args[0]) })
  }

  if (method.startsWith('toolSettings.')) {
    if (!frame.capabilities.toolSettings) throw new Error('当前插件页面没有工具设置 API。')
    if (method === 'toolSettings.getCommonArgs') return callHost('frame.toolSettings.getCommonArgs', { frameId })
    if (method === 'toolSettings.setCommonArgs') {
      return callHost('frame.toolSettings.setCommonArgs', { frameId, value: asRecord(args[0]) })
    }
  }

  throw new Error(`Unknown haExtApi method: ${method}`)
}

function replyToFrame(port: MessagePort, id: number, ok: boolean, value: unknown = null, error = ''): void {
  port.postMessage({
    source: API_HOST_SOURCE,
    type: 'response',
    id,
    ok,
    value: value === undefined ? null : value,
    error
  })
}

function connectFrame(data: JsonRecord, port: MessagePort): void {
  const frameId = asString(data.frameId)
  const pluginId = asString(data.pluginId)
  if (!frameId || !pluginId) return
  const frame: FrameRuntimeContext = {
    capabilities: asRecord(data.capabilities),
    pluginId,
    port
  }
  frames.get(frameId)?.port.close()
  frames.set(frameId, frame)
  port.onmessage = event => {
    const message = asRecord(event.data)
    if (message.source !== CLIENT_SOURCE || message.type !== 'call') return
    const id = Number(message.id)
    const args = Array.isArray(message.args) ? message.args : []
    void callFrameMethod(frameId, asString(message.method), args)
      .then(value => replyToFrame(port, id, true, value))
      .catch(error => replyToFrame(port, id, false, null, error instanceof Error ? error.message : String(error)))
  }
  port.start()
}

function disconnectFrame(data: JsonRecord): void {
  const frameId = asString(data.frameId)
  frames.get(frameId)?.port.close()
  frames.delete(frameId)
}

const methods: Record<string, (input: unknown) => Promise<unknown> | unknown> = {
  ensurePluginRuntime,
  preparePluginChatProcessing,
  handlePluginToolCallRequest
}

function handleHostResponse(data: JsonRecord): void {
  const id = Number(data.id)
  const pending = pendingHostCalls.get(id)
  if (!pending) return
  pendingHostCalls.delete(id)
  if (data.ok) pending.resolve(data.value)
  else pending.reject(new Error(asString(data.error, 'Plugin host call failed')))
}

globalThis.addEventListener('message', event => {
  const data = asRecord(event.data)
  if (data.source !== HOST_SOURCE) return

  if (data.type === 'host-response') {
    handleHostResponse(data)
    return
  }

  if (data.type === 'connect-frame') {
    const port = event.ports?.[0]
    if (port) connectFrame(data, port)
    return
  }

  if (data.type === 'disconnect-frame') {
    disconnectFrame(data)
    return
  }

  if (data.type !== 'invoke') return
  const id = Number(data.id)
  const method = methods[asString(data.method)]
  if (!method) {
    postToHost({
      type: 'response',
      id,
      ok: false,
      value: null,
      error: `Unknown plugin worker method: ${String(data.method ?? '')}`
    })
    return
  }

  Promise.resolve()
    .then(() => method(data.args))
    .then(value => postToHost({
      type: 'response',
      id,
      ok: true,
      value: safeResponseValue(value),
      error: ''
    }))
    .catch(error => postToHost({
      type: 'response',
      id,
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error)
    }))
})

postToHost({ type: 'ready' })
