import type {
  CloneableValue,
  HaExtApi,
  JsonRecord,
  JsonRecordValue,
  PluginFrameApiMethod,
  PluginFrameClientCallMessage,
  PluginFrameHostMessage,
  PluginFileEntry,
  PluginGlobalExport,
  PluginGlobalRegistry,
  PluginManifest,
  PluginRuntimeWorkerPrepareInput,
  PluginRuntimeWorkerRuntime,
  PluginRuntimeContext,
  PluginStorageApi,
  PluginWorkerHostCallMethod,
  PluginWorkerToHostMessage,
  PluginWorkerToHostPayload,
  PluginHostToWorkerMessage,
  PluginToolCallDefinition,
  PluginToolCallRequest,
  ProcessingChat
} from '../../../shared/types'
import { PLUGIN_FRAME_API_METHODS } from '../../../shared/types'
import { asRecord, asString, toStructuredCloneable } from '../../../shared/value-utils'

const HOST_SOURCE = 'ha-ext-worker-host'
const WORKER_SOURCE = 'ha-ext-worker'
const CLIENT_SOURCE = 'ha-ext-api-client'
const API_HOST_SOURCE = 'ha-ext-api-host'

interface PendingHostCall {
  reject: (error: Error) => void
  resolve: (value: JsonRecordValue) => void
}

interface FrameRuntimeContext {
  capabilities: {
    chat?: boolean
    toolSettings?: boolean
  }
  pluginId: string
  port: MessagePort
}

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor
const pluginGlobals: Record<string, PluginGlobalExport> = {}
const pendingHostCalls = new Map<number, PendingHostCall>()
const frames = new Map<string, FrameRuntimeContext>()
let loadedProjectSignature = ''
let nextHostCallId = 0

function safeResponseValue(value: JsonRecordValue): CloneableValue {
  try {
    return toStructuredCloneable(value) as CloneableValue
  } catch {
    return null
  }
}

function postToHost(message: PluginWorkerToHostPayload, transfer?: Transferable[]): void {
  const payload = {
    source: WORKER_SOURCE,
    ...message
  } as PluginWorkerToHostMessage
  globalThis.postMessage(payload, transfer ? { transfer } : undefined)
}

function callHost<T = JsonRecordValue>(method: PluginWorkerHostCallMethod, args: JsonRecord): Promise<T> {
  const id = ++nextHostCallId
  postToHost({
    type: 'host-call',
    id,
    method,
    args
  })
  return new Promise<T>((resolve, reject) => (
    pendingHostCalls.set(id, { resolve: resolve as (value: JsonRecordValue) => void, reject })
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
  return `ha-ext://${encodeURIComponent(pluginId)}/${cleanAssetPath(path)}`
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
    writeBase64: (path, content) => callHost<void>('storage.writeBase64', {
      pluginId,
      path: String(path ?? ''),
      content: String(content ?? '')
    }),
    writeBase64For: (targetPluginId, path, content) => callHost<void>('storage.writeBase64', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? ''),
      content: String(content ?? '')
    }),
    delete: (path: string) => callHost<void>('storage.delete', { pluginId, path: String(path ?? '') }),
    deleteFor: (targetPluginId: string, path: string) => callHost<void>('storage.delete', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readJson: async (path: string, fallback = {}) => {
      try {
        return JSON.parse(await callHost<string>('storage.readText', { pluginId, path: String(path ?? '') }))
      } catch {
        return toStructuredCloneable(fallback)
      }
    },
    readJsonFor: async (targetPluginId: string, path: string, fallback = {}) => {
      try {
        return JSON.parse(await callHost<string>('storage.readText', {
          pluginId: String(targetPluginId ?? ''),
          path: String(path ?? '')
        }))
      } catch {
        return toStructuredCloneable(fallback)
      }
    },
    writeJson: (path: string, value: JsonRecordValue) => writeText(path, `${JSON.stringify(value, null, 2)}\n`),
    writeJsonFor: (targetPluginId: string, path: string, value: JsonRecordValue) => (
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

function normalizeToolSchemas(value: JsonRecordValue): PluginToolCallDefinition['tools'] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      const schema = asRecord(item)
      return {
        name: asString(schema.name),
        description: asString(schema.description),
        inputSchema: asRecord(schema.inputSchema)
      }
    })
    .filter(schema => schema.name)
}

function toolCallDefinitionFromHandler(key: string, value: JsonRecordValue): PluginToolCallDefinition | null {
  const handler = value as { handle?: JsonRecordValue }
  if (typeof handler?.handle !== 'function') return null
  const record = asRecord(value)
  const name = asString(record.name) || key
  if (!name) return null
  return {
    name,
    label: asString(record.label) || undefined,
    prompt: asString(record.prompt) || undefined,
    settingsHtml: asString(record.settingsHtml) || undefined,
    tools: normalizeToolSchemas(record.tools)
  }
}

function toolHandlerByName(pluginId: string, toolCallName: string): NonNullable<PluginGlobalExport['toolCalls']>[string] | null {
  const toolCalls = asRecord(pluginGlobals[pluginId]?.toolCalls)
  for (const [key, value] of Object.entries(toolCalls)) {
    const definition = toolCallDefinitionFromHandler(key, value)
    if (definition?.name === toolCallName) return value as NonNullable<PluginGlobalExport['toolCalls']>[string]
  }
  return null
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

async function ensurePluginRuntime(input: PluginRuntimeWorkerRuntime): Promise<void> {
  const signature = asString(input.signature)
  if (signature && loadedProjectSignature === signature) return

  for (const key of Object.keys(pluginGlobals)) delete pluginGlobals[key]
  const activePlugins = input.activePlugins
  const pluginRegistry = registry()

  for (const descriptor of activePlugins) {
    const plugin = descriptor.manifest
    const initGlobal = plugin.entry?.initGlobal
    const context: PluginRuntimeContext = { haExtApi: haExtApiForPlugin(plugin.id), plugin }
    const globalExport: PluginGlobalExport = initGlobal
      ? await executePluginScript(plugin, initGlobal, context, pluginRegistry)
      : { exports: {} }
    pluginGlobals[plugin.id] = globalExport
  }
  loadedProjectSignature = signature
}

function sanitizeProcessingChatFactory(processingChat: ProcessingChat) {
  const canonicalOriginals = new Map((Array.isArray(processingChat.chatBlocks) ? processingChat.chatBlocks : [])
    .map(block => asRecord(block).original)
    .filter(original => typeof asRecord(original).id === 'number')
    .map(original => [asRecord(original).id, toStructuredCloneable(original)]))

  return (value: JsonRecordValue): ProcessingChat => {
    const chatValue = asRecord(value)
    if (!Array.isArray(chatValue.chatBlocks)) return processingChat
    return {
      ...processingChat,
      ...chatValue,
      chatBlocks: chatValue.chatBlocks.map(blockValue => {
        const block = asRecord(blockValue)
        const original = asRecord(block.original)
        const originalId = typeof original.id === 'number' ? original.id : null
        return originalId === null || !canonicalOriginals.has(originalId)
          ? blockValue
          : { ...block, original: toStructuredCloneable(canonicalOriginals.get(originalId)) }
      }) as ProcessingChat['chatBlocks']
    }
  }
}

async function preparePluginChatProcessing(input: PluginRuntimeWorkerPrepareInput): Promise<ProcessingChat> {
  await ensurePluginRuntime(input.runtime)
  const activePlugins = input.runtime.activePlugins
  let processingChat = input.processingChat
  const sanitizeProcessingChat = sanitizeProcessingChatFactory(processingChat)

  for (const descriptor of activePlugins) {
    const processor = pluginGlobals[descriptor.manifest.id]?.chatBlockProcessor
    if (typeof processor?.process !== 'function') continue
    const result = asRecord(await processor.process(processingChat))
    if (Array.isArray(result.chatBlocks)) processingChat = sanitizeProcessingChat(result)
  }

  return processingChat
}

async function listPluginToolCalls(
  input: { runtime: PluginRuntimeWorkerRuntime }
): Promise<Record<string, PluginToolCallDefinition[]>> {
  await ensurePluginRuntime(input.runtime)
  const activePlugins = input.runtime.activePlugins
  const result: Record<string, PluginToolCallDefinition[]> = {}
  for (const descriptor of activePlugins) {
    const toolCalls = asRecord(pluginGlobals[descriptor.manifest.id]?.toolCalls)
    const definitions = Object.entries(toolCalls)
      .map(([key, value]) => toolCallDefinitionFromHandler(key, value))
      .filter((definition): definition is PluginToolCallDefinition => definition !== null)
    if (definitions.length) result[descriptor.manifest.id] = definitions
  }
  return result
}

async function listPluginGlobalEntries(
  input: { runtime: PluginRuntimeWorkerRuntime }
): Promise<Record<string, Pick<PluginGlobalExport, 'settingsHtml' | 'chatHtml'>>> {
  await ensurePluginRuntime(input.runtime)
  const activePlugins = input.runtime.activePlugins
  const result: Record<string, Pick<PluginGlobalExport, 'settingsHtml' | 'chatHtml'>> = {}
  for (const descriptor of activePlugins) {
    const globalExport = pluginGlobals[descriptor.manifest.id]
    if (!globalExport?.settingsHtml && !globalExport?.chatHtml) continue
    result[descriptor.manifest.id] = {
      settingsHtml: globalExport.settingsHtml,
      chatHtml: globalExport.chatHtml
    }
  }
  return result
}

async function handlePluginToolCallRequest(
  input: { runtime: PluginRuntimeWorkerRuntime; request: PluginToolCallRequest }
): Promise<CloneableValue> {
  await ensurePluginRuntime(input.runtime)
  const plugins = input.runtime.allPlugins
  const request = input.request
  const descriptor = plugins.find(plugin => plugin.manifest.id === request.pluginId)
  if (!descriptor) throw new Error('插件工具不存在。')

  const handler = toolHandlerByName(descriptor.manifest.id, asString(request.toolCallName))
  if (typeof handler?.handle !== 'function') throw new Error('插件工具没有导出 handle。')
  return safeResponseValue(await handler.handle(request) as JsonRecordValue)
}

async function callFrameMethod(frameId: string, method: PluginFrameApiMethod, args: JsonRecordValue[]): Promise<JsonRecordValue> {
  const frame = frames.get(frameId)
  if (!frame) throw new Error('插件页面上下文不存在。')
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_LIST) return callHost('storage.list', { pluginId: frame.pluginId, path: String(args[0] ?? '') })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_LIST_FOR) return callHost('storage.list', { pluginId: String(args[0]), path: String(args[1] ?? '') })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_READ_TEXT) return callHost('storage.readText', { pluginId: frame.pluginId, path: String(args[0]) })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_READ_TEXT_FOR) return callHost('storage.readText', { pluginId: String(args[0]), path: String(args[1]) })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_READ_BASE64) return callHost('storage.readBase64', { pluginId: frame.pluginId, path: String(args[0]) })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_READ_BASE64_FOR) return callHost('storage.readBase64', { pluginId: String(args[0]), path: String(args[1]) })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_WRITE_TEXT) {
    return callHost('storage.writeText', { pluginId: frame.pluginId, path: String(args[0]), content: String(args[1] ?? '') })
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_WRITE_TEXT_FOR) {
    return callHost('storage.writeText', { pluginId: String(args[0]), path: String(args[1]), content: String(args[2] ?? '') })
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_WRITE_BASE64) {
    return callHost('storage.writeBase64', { pluginId: frame.pluginId, path: String(args[0]), content: String(args[1] ?? '') })
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_WRITE_BASE64_FOR) {
    return callHost('storage.writeBase64', { pluginId: String(args[0]), path: String(args[1]), content: String(args[2] ?? '') })
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_DELETE) return callHost('storage.delete', { pluginId: frame.pluginId, path: String(args[0]) })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_DELETE_FOR) return callHost('storage.delete', { pluginId: String(args[0]), path: String(args[1]) })
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_READ_JSON) {
    try {
      return JSON.parse(String(await callHost('storage.readText', { pluginId: frame.pluginId, path: String(args[0]) })))
    } catch {
      return args[1] ?? {}
    }
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_READ_JSON_FOR) {
    try {
      return JSON.parse(String(await callHost('storage.readText', { pluginId: String(args[0]), path: String(args[1]) })))
    } catch {
      return args[2] ?? {}
    }
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_WRITE_JSON) {
    return callHost('storage.writeText', {
      pluginId: frame.pluginId,
      path: String(args[0]),
      content: `${JSON.stringify(args[1] ?? {}, null, 2)}\n`
    })
  }
  if (method === PLUGIN_FRAME_API_METHODS.STORAGE_WRITE_JSON_FOR) {
    return callHost('storage.writeText', {
      pluginId: String(args[0]),
      path: String(args[1]),
      content: `${JSON.stringify(args[2] ?? {}, null, 2)}\n`
    })
  }

  if (method.startsWith('chat.')) {
    if (!frame.capabilities.chat) throw new Error('当前插件页面没有聊天 API。')
    if (method === PLUGIN_FRAME_API_METHODS.CHAT_GET_SESSION) return callHost('frame.chat.getSession', { frameId })
    if (method === PLUGIN_FRAME_API_METHODS.CHAT_GET_PLUGIN_DATA) return callHost('frame.chat.getPluginData', { frameId })
    if (method === PLUGIN_FRAME_API_METHODS.CHAT_SET_PLUGIN_DATA) return callHost('frame.chat.setPluginData', { frameId, value: asRecord(args[0]) })
  }

  if (method.startsWith('toolSettings.')) {
    if (!frame.capabilities.toolSettings) throw new Error('当前插件页面没有工具设置 API。')
    if (method === PLUGIN_FRAME_API_METHODS.TOOL_SETTINGS_GET_COMMON_ARGS) return callHost('frame.toolSettings.getCommonArgs', { frameId })
    if (method === PLUGIN_FRAME_API_METHODS.TOOL_SETTINGS_SET_COMMON_ARGS) {
      return callHost('frame.toolSettings.setCommonArgs', { frameId, value: asRecord(args[0]) })
    }
  }

  throw new Error(`Unknown haExtApi method: ${method}`)
}

function replyToFrame(port: MessagePort, id: number, ok: boolean, value: JsonRecordValue = null, error = ''): void {
  const message: PluginFrameHostMessage = {
    source: API_HOST_SOURCE,
    type: 'response',
    id,
    ok,
    value: value === undefined ? null : value,
    error
  }
  port.postMessage(message)
}

function connectFrame(data: Extract<PluginHostToWorkerMessage, { type: 'connect-frame' }>, port: MessagePort): void {
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
  port.onmessage = (event: MessageEvent<PluginFrameClientCallMessage>) => {
    const message = event.data
    if (message.source !== CLIENT_SOURCE || message.type !== 'call') return
    const id = Number(message.id)
    const args = Array.isArray(message.args) ? message.args : []
    void callFrameMethod(frameId, message.method, args)
      .then(value => replyToFrame(port, id, true, value))
      .catch(error => replyToFrame(port, id, false, null, error instanceof Error ? error.message : String(error)))
  }
  port.start()
}

function disconnectFrame(data: Extract<PluginHostToWorkerMessage, { type: 'disconnect-frame' }>): void {
  const frameId = asString(data.frameId)
  frames.get(frameId)?.port.close()
  frames.delete(frameId)
}

async function invokeRuntimeWorkerMethod(
  data: Extract<PluginHostToWorkerMessage, { type: 'invoke' }>
): Promise<JsonRecordValue> {
  if (data.method === 'ensurePluginRuntime') {
    await ensurePluginRuntime(data.args)
    return null
  }
  if (data.method === 'listPluginGlobalEntries') {
    return listPluginGlobalEntries(data.args)
  }
  if (data.method === 'listPluginToolCalls') {
    return listPluginToolCalls(data.args)
  }
  if (data.method === 'preparePluginChatProcessing') {
    return preparePluginChatProcessing(data.args)
  }
  return handlePluginToolCallRequest(data.args)
}

function handleHostResponse(data: Extract<PluginHostToWorkerMessage, { type: 'host-response' }>): void {
  const id = Number(data.id)
  const pending = pendingHostCalls.get(id)
  if (!pending) return
  pendingHostCalls.delete(id)
  if (data.ok) pending.resolve(data.value)
  else pending.reject(new Error(asString(data.error, 'Plugin host call failed')))
}

globalThis.addEventListener('message', (event: MessageEvent<PluginHostToWorkerMessage>) => {
  const data = event.data
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
  Promise.resolve()
    .then(() => invokeRuntimeWorkerMethod(data))
    .then(value => postToHost({
      type: 'response',
      id,
      ok: true,
      value: value,
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
