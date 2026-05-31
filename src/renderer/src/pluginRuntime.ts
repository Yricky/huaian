import {
  baseMessagesFromBlocks,
  mergeVirtualBlocks,
  messageHasContent,
  textFromContentParts,
  type ChatBlock,
  type ChatGenerationPreviewMessage,
  type ChatRuntimeConfig,
  type ChatSession,
  type JsonRecord,
  type LlmToolDefinition,
  type PluginChatBlockProcessor,
  type PluginDescriptor,
  type PluginManifest,
  type PluginProcessorState,
  type PluginToolCallManifest,
  type PluginToolCallRequest
} from '@st-forge/plugin-api'
import type { ProjectSnapshot } from '../../shared/types'
import { asRecord, asString, cloneJson } from '../../shared/value-utils'

type PluginScopes = {
  chat: Record<string, unknown>
  global: Record<string, unknown>
}

export interface PluginChatGenerationBundle {
  displayBlocks: ChatBlock[]
  messages: ChatGenerationPreviewMessage[]
  promptMetadata: JsonRecord
  toolDefinitions: LlmToolDefinition[]
  virtualBlocks: ChatBlock[]
}

interface LoadedPlugin {
  descriptor: PluginDescriptor
  globalExport: unknown
}

const pluginScopes: PluginScopes = { chat: {}, global: {} }
let loadedProjectSignature = ''
let loadedPlugins: LoadedPlugin[] = []
let toolRequestUnsubscribe: (() => void) | null = null

function dispatchPluginDataChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('st-forge-plugin-data-changed', { detail: { pluginId } }))
}

function dispatchProjectSnapshotChanged(): void {
  window.dispatchEvent(new CustomEvent('st-forge-project-snapshot-changed'))
}

function pluginDataFor(config: ChatRuntimeConfig, pluginId: string): JsonRecord {
  return asRecord(asRecord(config.pluginData)[pluginId])
}

function toolDefinitionMetadata(block: ChatBlock): JsonRecord {
  return asRecord(block.metadata.toolDefinition)
}

function enabledToolDefinitionBlocks(blocks: ChatBlock[]): ChatBlock[] {
  return blocks.filter(block => block.enabled && block.kind === 'tool_definition' && asString(toolDefinitionMetadata(block).pluginId))
}

function appendToolDefinitionMessages(messages: ChatGenerationPreviewMessage[], blocks: ChatBlock[]): ChatGenerationPreviewMessage[] {
  const existing = new Set(messages.map(message => message.blockId).filter((id): id is number => typeof id === 'number'))
  const toolMessages = enabledToolDefinitionBlocks(blocks)
    .filter(block => !existing.has(block.id))
    .map((block): ChatGenerationPreviewMessage | null => {
      const text = textFromContentParts(block.contentParts).trim()
      return text ? { role: 'system', content: text, blockId: block.id } : null
    })
    .filter((message): message is ChatGenerationPreviewMessage => message !== null)
  return [...messages, ...toolMessages]
}

function pluginAssetUrl(pluginId: string, path: string): string {
  return window.electronAPI.pluginAssetUrl(pluginId, path)
}

function storageApi(pluginId: string) {
  const writeText = async (path: string, content: string) => {
    await window.electronAPI.writePluginDataFile(pluginId, path, content)
    dispatchPluginDataChanged(pluginId)
  }
  const writeTextFor = async (targetPluginId: string, path: string, content: string) => {
    await window.electronAPI.writePluginDataFile(targetPluginId, path, content)
    dispatchPluginDataChanged(targetPluginId)
  }
  return {
    list: (path = '') => window.electronAPI.listPluginDataFiles(pluginId, path),
    listFor: (targetPluginId: string, path = '') => window.electronAPI.listPluginDataFiles(targetPluginId, path),
    readText: (path: string) => window.electronAPI.readPluginDataFile(pluginId, path),
    readTextFor: (targetPluginId: string, path: string) => window.electronAPI.readPluginDataFile(targetPluginId, path),
    writeText,
    writeTextFor,
    readJson: async (path: string, fallback: unknown = {}) => {
      try {
        return JSON.parse(await window.electronAPI.readPluginDataFile(pluginId, path))
      } catch {
        return cloneJson(fallback)
      }
    },
    readJsonFor: async (targetPluginId: string, path: string, fallback: unknown = {}) => {
      try {
        return JSON.parse(await window.electronAPI.readPluginDataFile(targetPluginId, path))
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

function chatApi(pluginId: string, chat?: ChatSession, blocks: ChatBlock[] = []) {
  return {
    getPluginData: () => chat ? pluginDataFor(chat.runtimeConfig, pluginId) : {},
    setPluginData: async (value: JsonRecord) => {
      if (!chat) return null
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
    },
    getBlockPluginData: (blockId: number) => {
      const block = blocks.find(item => item.id === blockId)
      return block ? asRecord(asRecord(block.metadata.pluginData)[pluginId]) : {}
    },
    setBlockPluginData: async (blockId: number, value: JsonRecord) => {
      const block = blocks.find(item => item.id === blockId)
      if (!block) return null
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
  }
}

function runtimeApi(pluginId: string, chat?: ChatSession, blocks: ChatBlock[] = []) {
  return {
    assetUrl: (path: string) => pluginAssetUrl(pluginId, path),
    chat: chatApi(pluginId, chat, blocks),
    storage: storageApi(pluginId)
  }
}

function isModuleScript(code: string): boolean {
  return /^\s*import\s/m.test(code) || /\bexport\s+(default|\{|\*)/.test(code)
}

async function executeModuleScript(code: string, context: JsonRecord): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const module = await import(/* @vite-ignore */ url)
    const entry = module.default ?? module
    return typeof entry === 'function' ? entry(context, pluginScopes) : entry
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function executePluginScript(plugin: PluginManifest, path: string, context: JsonRecord): Promise<unknown> {
  const code = await window.electronAPI.readPluginFile(plugin.id, path)
  if (isModuleScript(code)) return executeModuleScript(code, context)
  const fn = new AsyncFunction('context', 'myAppPlugins', code)
  return fn(context, pluginScopes)
}

function activePlugins(project: ProjectSnapshot, chat?: ChatSession): PluginDescriptor[] {
  const projectEnabled = new Set(project.config.plugins.enabledPluginIds)
  const chatEnabled = new Set(chat?.runtimeConfig.enabledPluginIds ?? project.config.plugins.enabledPluginIds)
  const byId = new Map(project.plugins.map(plugin => [plugin.manifest.id, plugin]))
  const result: PluginDescriptor[] = []
  for (const plugin of project.plugins) {
    if (!projectEnabled.has(plugin.manifest.id) || !chatEnabled.has(plugin.manifest.id)) continue
    const dependencies = plugin.manifest.dependencies ?? []
    if (dependencies.every(id => projectEnabled.has(id) && chatEnabled.has(id) && byId.has(id))) result.push(plugin)
  }
  return result
}

export async function ensurePluginRuntime(project: ProjectSnapshot): Promise<void> {
  const signature = JSON.stringify({
    path: project.path,
    enabledPluginIds: project.config.plugins.enabledPluginIds,
    plugins: project.plugins.map(plugin => ({
      id: plugin.manifest.id,
      versionCode: plugin.manifest.versionCode
    }))
  })
  if (loadedProjectSignature === signature) return
  loadedProjectSignature = signature
  loadedPlugins = []
  pluginScopes.global = {
    base: {
      plugins: new Map(project.plugins.map(plugin => [plugin.manifest.id, plugin.manifest])),
      projectPath: project.path
    }
  }
  pluginScopes.chat = {}

  for (const descriptor of activePlugins(project)) {
    const plugin = descriptor.manifest
    const initGlobal = plugin.entry?.initGlobal
    const globalExport = initGlobal
      ? await executePluginScript(plugin, initGlobal, { api: runtimeApi(plugin.id), plugin })
      : {}
    pluginScopes.global[plugin.id] = globalExport ?? {}
    loadedPlugins.push({ descriptor, globalExport })
  }
}

export async function preparePluginChatGeneration(
  project: ProjectSnapshot,
  chat: ChatSession,
  blocks: ChatBlock[]
): Promise<PluginChatGenerationBundle> {
  await ensurePluginRuntime(project)
  pluginScopes.chat = {
    base: {
      chatblocks: blocks
    }
  }
  const plugins = activePlugins(project, chat)
  const state: PluginProcessorState = {
    blocks: cloneJson(blocks),
    chat,
    messages: baseMessagesFromBlocks(blocks),
    project,
    virtualBlocks: []
  }
  const metadata: JsonRecord = { plugins: plugins.map(plugin => plugin.manifest.id) }

  for (const descriptor of plugins) {
    const plugin = descriptor.manifest
    const initChat = plugin.entry?.initChat
    if (initChat) {
      pluginScopes.chat[plugin.id] = await executePluginScript(plugin, initChat, {
        api: runtimeApi(plugin.id, chat, blocks),
        blocks,
        chat,
        plugin,
        project
      }) ?? {}
    }
    const processorPath = plugin.entry?.chatBlockProcessor
    if (!processorPath) continue
    const processor = asRecord(await executePluginScript(plugin, processorPath, {
      api: runtimeApi(plugin.id, chat, blocks),
      blocks,
      chat,
      plugin,
      project
    })) as unknown as Partial<PluginChatBlockProcessor>
    if (typeof processor.process !== 'function') continue
    const result = asRecord(await processor.process(state))
    if (Array.isArray(result.blocks)) state.blocks = result.blocks as ChatBlock[]
    if (Array.isArray(result.displayBlocks)) state.blocks = result.displayBlocks as ChatBlock[]
    if (Array.isArray(result.messages)) state.messages = result.messages as ChatGenerationPreviewMessage[]
    if (Array.isArray(result.virtualBlocks)) {
      state.virtualBlocks = result.virtualBlocks as ChatBlock[]
      if (!Array.isArray(result.blocks) && !Array.isArray(result.displayBlocks)) {
        state.blocks = mergeVirtualBlocks(state.blocks, state.virtualBlocks)
      }
    }
    Object.assign(metadata, asRecord(result.metadata))
  }

  state.messages = appendToolDefinitionMessages(state.messages, blocks).filter(messageHasContent)
  return {
    displayBlocks: state.blocks,
    messages: state.messages,
    promptMetadata: metadata,
    toolDefinitions: toolDefinitionsForChat(plugins, blocks),
    virtualBlocks: state.virtualBlocks
  }
}

function toolCallManifestByName(plugin: PluginManifest, name: string): PluginToolCallManifest | null {
  return plugin.entry?.toolCalls?.find(toolCall => toolCall.name === name) ?? null
}

function toolDefinitionsForChat(plugins: PluginDescriptor[], blocks: ChatBlock[]): LlmToolDefinition[] {
  const pluginById = new Map(plugins.map(plugin => [plugin.manifest.id, plugin.manifest]))
  const definitions: LlmToolDefinition[] = []
  for (const block of enabledToolDefinitionBlocks(blocks)) {
    const metadata = toolDefinitionMetadata(block)
    const pluginId = asString(metadata.pluginId)
    const toolCallName = asString(metadata.toolCallName)
    const plugin = pluginById.get(pluginId)
    const toolCall = plugin ? toolCallManifestByName(plugin, toolCallName) : null
    if (!plugin || !toolCall) continue
    for (const schema of toolCall.tools ?? []) {
      definitions.push({
        pluginId,
        toolCallName,
        toolName: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        commonArgs: asRecord(metadata.commonArgs)
      })
    }
  }
  return definitions
}

export function availableToolCalls(project: ProjectSnapshot, chat: ChatSession): Array<{
  plugin: PluginManifest
  toolCall: PluginToolCallManifest
}> {
  return activePlugins(project, chat).flatMap(descriptor => (
    descriptor.manifest.entry?.toolCalls?.map(toolCall => ({
      plugin: descriptor.manifest,
      toolCall
    })) ?? []
  ))
}

export async function handlePluginToolCallRequest(project: ProjectSnapshot, request: PluginToolCallRequest): Promise<void> {
  try {
    await ensurePluginRuntime(project)
    const descriptor = project.plugins.find(plugin => plugin.manifest.id === request.pluginId)
    const toolCall = descriptor?.manifest.entry?.toolCalls?.find(item => item.name === request.toolCallName)
    if (!descriptor || !toolCall?.handler) throw new Error('插件工具 handler 不存在。')
    const handler = asRecord(await executePluginScript(descriptor.manifest, toolCall.handler, {
      api: runtimeApi(descriptor.manifest.id),
      plugin: descriptor.manifest
    }))
    if (typeof handler.handle !== 'function') throw new Error('插件工具 handler 没有导出 handle。')
    const output = await (handler.handle as Function)(request)
    await window.electronAPI.resolvePluginToolCall({ requestId: request.requestId, ok: true, output })
  } catch (error) {
    await window.electronAPI.resolvePluginToolCall({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function startPluginToolBridge(getProject: () => ProjectSnapshot | null): void {
  if (toolRequestUnsubscribe) return
  toolRequestUnsubscribe = window.electronAPI.onPluginToolCallRequest(request => {
    const project = getProject()
    if (!project) {
      void window.electronAPI.resolvePluginToolCall({
        requestId: request.requestId,
        ok: false,
        error: '项目尚未加载。'
      })
      return
    }
    void handlePluginToolCallRequest(project, request)
  })
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => Function
