import type { ChatBlock, ChatSession, JsonRecord } from '../../shared/types'
import { asRecord, asString } from '../../shared/value-utils'

const HOST_SOURCE = 'st-forge-plugin-sandbox-host'
const SANDBOX_SOURCE = 'st-forge-plugin-sandbox'
const INVOCATION_TIMEOUT_MS = 120_000

interface PendingInvocation {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: number
}

let sandboxFrame: HTMLIFrameElement | null = null
let sandboxPort: MessagePort | null = null
let readyPromise: Promise<void> | null = null
let readyResolve: (() => void) | null = null
let nextMessageId = 0
let messageListenerInstalled = false
const pendingInvocations = new Map<number, PendingInvocation>()

function cloneForMessage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function dispatchPluginDataChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('st-forge-plugin-data-changed', { detail: { pluginId } }))
}

function dispatchProjectSnapshotChanged(): void {
  window.dispatchEvent(new CustomEvent('st-forge-project-snapshot-changed'))
}

function postToSandbox(message: JsonRecord): void {
  sandboxPort?.postMessage(cloneForMessage({
    source: HOST_SOURCE,
    ...message
  }))
}

function pluginDataFor(chat: ChatSession, pluginId: string): JsonRecord {
  return asRecord(asRecord(chat.runtimeConfig.pluginData)[pluginId])
}

function blockPluginDataFor(block: ChatBlock, pluginId: string): JsonRecord {
  return asRecord(asRecord(block.metadata.pluginData)[pluginId])
}

async function setChatPluginData(pluginId: string, chat: ChatSession, value: JsonRecord): Promise<ChatSession> {
  const updated = await window.electronAPI.updateChat(JSON.stringify({
    id: chat.id,
    title: chat.title,
    runtimeConfig: {
      ...chat.runtimeConfig,
      pluginData: {
        ...asRecord(chat.runtimeConfig.pluginData),
        [pluginId]: asRecord(value)
      }
    }
  }))
  dispatchPluginDataChanged(pluginId)
  dispatchProjectSnapshotChanged()
  return updated
}

async function setBlockPluginData(pluginId: string, block: ChatBlock, value: JsonRecord): Promise<ChatBlock> {
  const updated = await window.electronAPI.updateChatBlock(JSON.stringify({
    id: block.id,
    enabled: block.enabled,
    contentParts: block.contentParts,
    metadata: {
      ...block.metadata,
      pluginData: {
        ...asRecord(block.metadata.pluginData),
        [pluginId]: asRecord(value)
      }
    }
  }))
  dispatchPluginDataChanged(pluginId)
  dispatchProjectSnapshotChanged()
  return updated
}

async function handleHostMethod(method: string, argsValue: unknown): Promise<unknown> {
  const args = asRecord(argsValue)
  const pluginId = asString(args.pluginId)

  if (method === 'plugin.readFile') {
    return window.electronAPI.readPluginFile(pluginId, asString(args.path))
  }

  if (method === 'storage.list') {
    return window.electronAPI.listPluginDataFiles(pluginId, asString(args.path))
  }
  if (method === 'storage.readText') {
    return window.electronAPI.readPluginDataFile(pluginId, asString(args.path))
  }
  if (method === 'storage.readBase64') {
    return window.electronAPI.readPluginDataFileBase64(pluginId, asString(args.path))
  }
  if (method === 'storage.writeText') {
    await window.electronAPI.writePluginDataFile(pluginId, asString(args.path), String(args.content ?? ''))
    dispatchPluginDataChanged(pluginId)
    return null
  }
  if (method === 'storage.writeBase64') {
    await window.electronAPI.writePluginDataFileBase64(pluginId, asString(args.path), String(args.content ?? ''))
    dispatchPluginDataChanged(pluginId)
    return null
  }
  if (method === 'storage.delete') {
    await window.electronAPI.deletePluginDataFile(pluginId, asString(args.path))
    dispatchPluginDataChanged(pluginId)
    return null
  }

  if (method === 'chat.getSession') {
    return cloneForMessage(args.chat ?? null)
  }
  if (method === 'chat.getPluginData') {
    return pluginDataFor(args.chat as unknown as ChatSession, pluginId)
  }
  if (method === 'chat.setPluginData') {
    return setChatPluginData(pluginId, args.chat as unknown as ChatSession, asRecord(args.value))
  }
  if (method === 'chat.getBlockPluginData') {
    return blockPluginDataFor(args.block as unknown as ChatBlock, pluginId)
  }
  if (method === 'chat.setBlockPluginData') {
    return setBlockPluginData(pluginId, args.block as unknown as ChatBlock, asRecord(args.value))
  }

  throw new Error(`Unknown plugin sandbox host method: ${method}`)
}

function replyToSandboxHostCall(id: number, ok: boolean, value: unknown = null, error = ''): void {
  postToSandbox({
    type: 'host-response',
    id,
    ok,
    value: value === undefined ? null : value,
    error
  })
}

async function handleSandboxHostCall(data: JsonRecord): Promise<void> {
  const id = Number(data.id)
  if (!Number.isFinite(id)) return
  try {
    const value = await handleHostMethod(asString(data.method), data.args)
    replyToSandboxHostCall(id, true, value)
  } catch (error) {
    replyToSandboxHostCall(id, false, null, error instanceof Error ? error.message : String(error))
  }
}

function onSandboxPortMessage(event: MessageEvent): void {
  const data = asRecord(event.data)
  if (data.source !== SANDBOX_SOURCE) return

  if (data.type === 'ready') {
    readyResolve?.()
    readyResolve = null
    return
  }

  if (data.type === 'host-call') {
    void handleSandboxHostCall(data)
    return
  }

  if (data.type !== 'response') return
  const id = Number(data.id)
  const pending = pendingInvocations.get(id)
  if (!pending) return
  pendingInvocations.delete(id)
  window.clearTimeout(pending.timeout)
  if (data.ok) {
    pending.resolve(data.value)
  } else {
    pending.reject(new Error(asString(data.error, 'Plugin sandbox call failed')))
  }
}

function connectSandboxPort(): void {
  if (!sandboxFrame?.contentWindow || sandboxPort) return
  // Keep the privileged host bridge off window.postMessage; plugins only receive scoped context.api methods.
  const channel = new MessageChannel()
  sandboxPort = channel.port1
  sandboxPort.onmessage = onSandboxPortMessage
  sandboxPort.start()
  sandboxFrame.contentWindow.postMessage({
    source: HOST_SOURCE,
    type: 'connect'
  }, '*', [channel.port2])
}

function onSandboxMessage(event: MessageEvent): void {
  if (!sandboxFrame?.contentWindow || event.source !== sandboxFrame.contentWindow) return
  const data = asRecord(event.data)
  if (data.source !== SANDBOX_SOURCE || data.type !== 'bootstrap-ready') return
  connectSandboxPort()
}

function installMessageListener(): void {
  if (messageListenerInstalled) return
  messageListenerInstalled = true
  window.addEventListener('message', onSandboxMessage)
}

function sandboxScript(): string {
  return `
(() => {
const HOST_SOURCE = ${JSON.stringify(HOST_SOURCE)};
const SANDBOX_SOURCE = ${JSON.stringify(SANDBOX_SOURCE)};
const pluginScopes = { chat: {}, global: {} };
const pendingHostCalls = new Map();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const BlobCtor = Blob;
const createObjectUrl = URL.createObjectURL.bind(URL);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
let bridgePort = null;
let bridgePostMessage = null;
let loadedProjectSignature = '';
let nextHostCallId = 0;

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function cloneJson(value) {
  return jsonParse(jsonStringify(value ?? null));
}

function safeResponseValue(value) {
  try {
    return cloneJson(value);
  } catch {
    return null;
  }
}

function postToHost(message) {
  if (!bridgePostMessage) throw new Error('Plugin sandbox bridge is not connected.');
  bridgePostMessage({ source: SANDBOX_SOURCE, ...message });
}

function callHost(method, args) {
  const id = ++nextHostCallId;
  postToHost({ type: 'host-call', id, method, args });
  return new Promise((resolve, reject) => pendingHostCalls.set(id, { resolve, reject }));
}

function pluginDataFor(config, pluginId) {
  return asRecord(asRecord(config.pluginData)[pluginId]);
}

function toolDefinitionMetadata(block) {
  return asRecord(block.metadata?.toolDefinition);
}

function pluginAssetUrl(pluginId, path) {
  const cleanPath = String(path ?? '').replace(/\\\\/g, '/').replace(/^\\/+/, '');
  const encoded = [pluginId, ...cleanPath.split('/').filter(Boolean)]
    .map(part => encodeURIComponent(part))
    .join('/');
  return 'st-forge-plugin:///' + encoded;
}

function mergeVirtualBlocks(blocks, virtualBlocks) {
  const startBlocks = [];
  const endBlocks = [];
  const before = new Map();
  const after = new Map();
  for (const block of virtualBlocks) {
    const metadata = asRecord(block.metadata);
    const beforeBlockId = typeof metadata.displayBeforeBlockId === 'number' ? metadata.displayBeforeBlockId : null;
    const afterBlockId = typeof metadata.displayAfterBlockId === 'number' ? metadata.displayAfterBlockId : null;
    if (beforeBlockId !== null) {
      const list = before.get(beforeBlockId) ?? [];
      list.push(block);
      before.set(beforeBlockId, list);
      continue;
    }
    if (afterBlockId !== null) {
      const list = after.get(afterBlockId) ?? [];
      list.push(block);
      after.set(afterBlockId, list);
      continue;
    }
    if (metadata.displaySlot === 'end') endBlocks.push(block);
    else startBlocks.push(block);
  }
  const result = [...startBlocks];
  for (const block of blocks) {
    result.push(...(before.get(block.id) ?? []), block, ...(after.get(block.id) ?? []));
  }
  result.push(...endBlocks);
  return result;
}

function storageApi(pluginId) {
  const writeText = async (path, content) => callHost('storage.writeText', {
    pluginId,
    path: String(path ?? ''),
    content: String(content ?? '')
  });
  const writeTextFor = async (targetPluginId, path, content) => callHost('storage.writeText', {
    pluginId: String(targetPluginId ?? ''),
    path: String(path ?? ''),
    content: String(content ?? '')
  });
  const writeBase64 = async (path, content) => callHost('storage.writeBase64', {
    pluginId,
    path: String(path ?? ''),
    content: String(content ?? '')
  });
  const writeBase64For = async (targetPluginId, path, content) => callHost('storage.writeBase64', {
    pluginId: String(targetPluginId ?? ''),
    path: String(path ?? ''),
    content: String(content ?? '')
  });
  return {
    list: (path = '') => callHost('storage.list', { pluginId, path: String(path ?? '') }),
    listFor: (targetPluginId, path = '') => callHost('storage.list', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readText: path => callHost('storage.readText', { pluginId, path: String(path ?? '') }),
    readTextFor: (targetPluginId, path) => callHost('storage.readText', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readBase64: path => callHost('storage.readBase64', { pluginId, path: String(path ?? '') }),
    readBase64For: (targetPluginId, path) => callHost('storage.readBase64', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    writeText,
    writeTextFor,
    writeBase64,
    writeBase64For,
    delete: path => callHost('storage.delete', { pluginId, path: String(path ?? '') }),
    deleteFor: (targetPluginId, path) => callHost('storage.delete', {
      pluginId: String(targetPluginId ?? ''),
      path: String(path ?? '')
    }),
    readJson: async (path, fallback = {}) => {
      try {
        return jsonParse(await callHost('storage.readText', { pluginId, path: String(path ?? '') }));
      } catch {
        return cloneJson(fallback);
      }
    },
    readJsonFor: async (targetPluginId, path, fallback = {}) => {
      try {
        return jsonParse(await callHost('storage.readText', {
          pluginId: String(targetPluginId ?? ''),
          path: String(path ?? '')
        }));
      } catch {
        return cloneJson(fallback);
      }
    },
    writeJson: (path, value) => writeText(path, jsonStringify(value, null, 2) + '\\n'),
    writeJsonFor: (targetPluginId, path, value) => writeTextFor(targetPluginId, path, jsonStringify(value, null, 2) + '\\n')
  };
}

function chatApi(pluginId, chat, blocks = []) {
  return {
    getSession: () => chat ? cloneJson(chat) : null,
    getPluginData: () => chat ? pluginDataFor(chat.runtimeConfig, pluginId) : {},
    setPluginData: async value => {
      if (!chat) return null;
      return callHost('chat.setPluginData', { pluginId, chat, value: asRecord(value) });
    },
    getBlockPluginData: blockId => {
      const block = blocks.find(item => item.id === blockId);
      return block ? asRecord(asRecord(block.metadata?.pluginData)[pluginId]) : {};
    },
    setBlockPluginData: async (blockId, value) => {
      const block = blocks.find(item => item.id === blockId);
      if (!block) return null;
      return callHost('chat.setBlockPluginData', { pluginId, block, value: asRecord(value) });
    }
  };
}

function runtimeApi(pluginId, chat, blocks = []) {
  return {
    assetUrl: path => pluginAssetUrl(pluginId, path),
    chat: chatApi(pluginId, chat, blocks),
    storage: storageApi(pluginId)
  };
}

function isModuleScript(code) {
  return /^\\s*import\\s/m.test(code) || /\\bexport\\s+(default|\\{|\\*)/.test(code);
}

async function executeModuleScript(code, context) {
  const url = createObjectUrl(new BlobCtor([code], { type: 'text/javascript' }));
  try {
    const module = await import(url);
    const entry = module.default ?? module;
    return typeof entry === 'function' ? entry(context, pluginScopes) : entry;
  } finally {
    revokeObjectUrl(url);
  }
}

async function executePluginScript(plugin, path, context) {
  const code = await callHost('plugin.readFile', { pluginId: plugin.id, path });
  if (isModuleScript(code)) return executeModuleScript(code, context);
  const fn = new AsyncFunction('context', 'myAppPlugins', code);
  return fn(context, pluginScopes);
}

async function ensurePluginRuntime(input) {
  if (loadedProjectSignature === input.signature) return;
  const activePlugins = Array.isArray(input.activePlugins) ? input.activePlugins : [];
  const allPlugins = Array.isArray(input.allPlugins) ? input.allPlugins : activePlugins;
  const projectPath = asString(input.projectPath);
  const nextGlobal = {
    base: {
      plugins: new Map(allPlugins.map(plugin => [plugin.manifest.id, plugin.manifest])),
      projectPath
    }
  };
  const loadedGlobals = [];
  for (const descriptor of activePlugins) {
    const plugin = descriptor.manifest;
    const initGlobal = plugin.entry?.initGlobal;
    const globalExport = initGlobal
      ? await executePluginScript(plugin, initGlobal, { api: runtimeApi(plugin.id), plugin })
      : {};
    nextGlobal[plugin.id] = globalExport ?? {};
    loadedGlobals.push({ descriptor, globalExport });
  }
  pluginScopes.global = nextGlobal;
  pluginScopes.chat = {};
  loadedProjectSignature = input.signature;
}

async function preparePluginChatGeneration(input) {
  await ensurePluginRuntime(input.runtime);
  const activePlugins = Array.isArray(input.runtime?.activePlugins) ? input.runtime.activePlugins : [];
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const chat = input.chat;
  const state = cloneJson(input.state);
  const metadata = { ...asRecord(input.metadata) };
  pluginScopes.chat = {
    base: {
      chatblocks: blocks
    }
  };

  for (const descriptor of activePlugins) {
    const plugin = descriptor.manifest;
    const initChat = plugin.entry?.initChat;
    if (initChat) {
      pluginScopes.chat[plugin.id] = await executePluginScript(plugin, initChat, {
        api: runtimeApi(plugin.id, chat, blocks),
        blocks,
        chat,
        plugin,
        project: input.project
      }) ?? {};
    }
    const processorPath = plugin.entry?.chatBlockProcessor;
    if (!processorPath) continue;
    const processor = asRecord(await executePluginScript(plugin, processorPath, {
      api: runtimeApi(plugin.id, chat, blocks),
      blocks,
      chat,
      plugin,
      project: input.project
    }));
    if (typeof processor.process !== 'function') continue;
    const result = asRecord(await processor.process(state));
    if (Array.isArray(result.blocks)) state.blocks = result.blocks;
    if (Array.isArray(result.displayBlocks)) state.blocks = result.displayBlocks;
    if (Array.isArray(result.messages)) state.messages = result.messages;
    if (Array.isArray(result.virtualBlocks)) {
      state.virtualBlocks = result.virtualBlocks;
      if (!Array.isArray(result.blocks) && !Array.isArray(result.displayBlocks)) {
        state.blocks = mergeVirtualBlocks(state.blocks, state.virtualBlocks);
      }
    }
    Object.assign(metadata, asRecord(result.metadata));
  }

  return {
    displayBlocks: Array.isArray(state.blocks) ? state.blocks : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    metadata,
    virtualBlocks: Array.isArray(state.virtualBlocks) ? state.virtualBlocks : []
  };
}

async function handlePluginToolCallRequest(input) {
  await ensurePluginRuntime(input.runtime);
  const plugins = Array.isArray(input.runtime?.allPlugins) ? input.runtime.allPlugins : [];
  const request = asRecord(input.request);
  const descriptor = plugins.find(plugin => plugin.manifest.id === request.pluginId);
  const toolCalls = descriptor?.manifest?.entry?.toolCalls;
  const toolCall = Array.isArray(toolCalls) ? toolCalls.find(item => item.name === request.toolCallName) : null;
  if (!descriptor || !toolCall?.handler) throw new Error('插件工具 handler 不存在。');
  const handler = asRecord(await executePluginScript(descriptor.manifest, toolCall.handler, {
    api: runtimeApi(descriptor.manifest.id),
    plugin: descriptor.manifest
  }));
  if (typeof handler.handle !== 'function') throw new Error('插件工具 handler 没有导出 handle。');
  return handler.handle(input.request);
}

const methods = {
  ensurePluginRuntime,
  preparePluginChatGeneration,
  handlePluginToolCallRequest
};

function handlePortMessage(event) {
  const data = asRecord(event.data);
  if (data.source !== HOST_SOURCE) return;
  if (data.type === 'host-response') {
    const pending = pendingHostCalls.get(data.id);
    if (!pending) return;
    pendingHostCalls.delete(data.id);
    if (data.ok) pending.resolve(data.value);
    else pending.reject(new Error(asString(data.error, 'Plugin host call failed')));
    return;
  }
  if (data.type !== 'invoke') return;
  const method = methods[data.method];
  if (typeof method !== 'function') {
    postToHost({
      type: 'response',
      id: data.id,
      ok: false,
      value: null,
      error: 'Unknown plugin sandbox method: ' + String(data.method ?? '')
    });
    return;
  }
  Promise.resolve()
    .then(() => method(data.args))
    .then(value => postToHost({
      type: 'response',
      id: data.id,
      ok: true,
      value: safeResponseValue(value),
      error: ''
    }))
    .catch(error => postToHost({
      type: 'response',
      id: data.id,
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error)
    }));
}

window.addEventListener('message', event => {
  const data = asRecord(event.data);
  if (bridgePort || data.source !== HOST_SOURCE || data.type !== 'connect') return;
  const port = event.ports?.[0];
  if (!port) return;
  bridgePort = port;
  bridgePostMessage = port.postMessage.bind(port);
  bridgePort.onmessage = handlePortMessage;
  bridgePort.start?.();
  postToHost({ type: 'ready' });
});

window.parent.postMessage({ source: SANDBOX_SOURCE, type: 'bootstrap-ready' }, '*');
})();
`
}

function sandboxHtml(): string {
  const script = sandboxScript().replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
</head>
<body><script>${script}</script></body>
</html>`
}

function createSandboxFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.sandbox.add('allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.title = 'ST Forge Plugin Sandbox'
  frame.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute;left:-9999px;top:-9999px;'
  frame.srcdoc = sandboxHtml()
  return frame
}

async function ensurePluginSandbox(): Promise<void> {
  installMessageListener()
  if (sandboxFrame?.contentWindow && readyPromise) return readyPromise
  sandboxPort?.close()
  sandboxPort = null
  readyPromise = new Promise(resolve => {
    readyResolve = resolve
  })
  sandboxFrame = createSandboxFrame()
  ;(document.body ?? document.documentElement).append(sandboxFrame)
  return readyPromise
}

export async function invokePluginSandbox<T = unknown>(method: string, args: unknown): Promise<T> {
  await ensurePluginSandbox()
  const frame = sandboxFrame?.contentWindow
  if (!frame) throw new Error('Plugin sandbox is not available.')
  const id = ++nextMessageId
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingInvocations.delete(id)
      reject(new Error(`Plugin sandbox call timed out: ${method}`))
    }, INVOCATION_TIMEOUT_MS)
    pendingInvocations.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout })
    sandboxPort?.postMessage(cloneForMessage({
      source: HOST_SOURCE,
      type: 'invoke',
      id,
      method,
      args
    }))
  })
}
