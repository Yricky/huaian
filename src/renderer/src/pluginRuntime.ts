import {
  baseMessagesFromBlocks,
  messageHasContent,
  type ChatBlock,
  type ChatGenerationPreviewMessage,
  type JsonRecord,
  type PluginManifest,
  type PluginProcessorState,
  type PluginToolCallManifest
} from '@st-forge/plugin-api'
import type {
  ChatSession,
  ChatToolDefinition,
  LlmToolDefinition,
  PluginDescriptor,
  PluginToolCallRequest,
  ProjectSnapshot
} from '../../shared/types'
import { asRecord, cloneJson } from '../../shared/value-utils'
import { invokePluginSandbox } from './pluginSandbox'

export interface PluginChatGenerationBundle {
  displayBlocks: ChatBlock[]
  messages: ChatGenerationPreviewMessage[]
  promptMetadata: JsonRecord
  toolDefinitions: LlmToolDefinition[]
  virtualBlocks: ChatBlock[]
}

let toolRequestUnsubscribe: (() => void) | null = null

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

function pluginRuntimeSignature(project: ProjectSnapshot): string {
  return JSON.stringify({
    path: project.path,
    enabledPluginIds: project.config.plugins.enabledPluginIds,
    plugins: project.plugins.map(plugin => ({
      id: plugin.manifest.id,
      versionCode: plugin.manifest.versionCode
    }))
  })
}

function sandboxRuntime(project: ProjectSnapshot, plugins = activePlugins(project)): JsonRecord {
  return {
    signature: pluginRuntimeSignature(project),
    allPlugins: project.plugins,
    activePlugins: plugins
  }
}

function chatForPlugin(chat: ChatSession): PluginProcessorState['chat'] {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt
  }
}

export async function ensurePluginRuntime(project: ProjectSnapshot): Promise<void> {
  await invokePluginSandbox('ensurePluginRuntime', sandboxRuntime(project))
}

export async function preparePluginChatGeneration(
  project: ProjectSnapshot,
  chat: ChatSession,
  blocks: ChatBlock[]
): Promise<PluginChatGenerationBundle> {
  const plugins = activePlugins(project, chat)
  const pluginChat = chatForPlugin(chat)
  const state: PluginProcessorState = {
    blocks: cloneJson(blocks),
    chat: pluginChat,
    messages: baseMessagesFromBlocks(blocks),
    virtualBlocks: []
  }
  const metadata: JsonRecord = { plugins: plugins.map(plugin => plugin.manifest.id) }

  const result = asRecord(await invokePluginSandbox('preparePluginChatGeneration', {
    runtime: sandboxRuntime(project, plugins),
    blocks,
    chat: pluginChat,
    hostChat: chat,
    metadata,
    state
  }))
  const resultMessages = Array.isArray(result.messages)
    ? result.messages as ChatGenerationPreviewMessage[]
    : state.messages
  const displayBlocks = Array.isArray(result.displayBlocks)
    ? result.displayBlocks as ChatBlock[]
    : state.blocks
  const virtualBlocks = Array.isArray(result.virtualBlocks)
    ? result.virtualBlocks as ChatBlock[]
    : state.virtualBlocks
  const promptMetadata = {
    ...metadata,
    ...asRecord(result.metadata)
  }

  const messages = resultMessages.filter(messageHasContent)
  return {
    displayBlocks,
    messages,
    promptMetadata,
    toolDefinitions: toolDefinitionsForChat(plugins, chat.runtimeConfig.toolDefinitions),
    virtualBlocks
  }
}

function toolCallManifestByName(plugin: PluginManifest, name: string): PluginToolCallManifest | null {
  return plugin.entry?.toolCalls?.find(toolCall => toolCall.name === name) ?? null
}

function toolDefinitionsForChat(plugins: PluginDescriptor[], configuredTools: ChatToolDefinition[]): LlmToolDefinition[] {
  const pluginById = new Map(plugins.map(plugin => [plugin.manifest.id, plugin.manifest]))
  const definitions: LlmToolDefinition[] = []
  for (const configuredTool of configuredTools) {
    const pluginId = configuredTool.pluginId
    const toolCallName = configuredTool.toolCallName
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
        commonArgs: asRecord(configuredTool.commonArgs)
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
    const output = await invokePluginSandbox('handlePluginToolCallRequest', {
      runtime: sandboxRuntime(project),
      request
    })
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
