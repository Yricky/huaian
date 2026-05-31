import {
  baseMessagesFromBlocks,
  messageHasContent,
  textFromContentParts,
  type ChatBlock,
  type ChatGenerationPreviewMessage,
  type ChatSession,
  type JsonRecord,
  type LlmToolDefinition,
  type PluginDescriptor,
  type PluginManifest,
  type PluginProcessorState,
  type PluginToolCallManifest,
  type PluginToolCallRequest
} from '@st-forge/plugin-api'
import type { ProjectSnapshot } from '../../shared/types'
import { asRecord, asString, cloneJson } from '../../shared/value-utils'
import { invokePluginSandbox } from './pluginSandbox'

export interface PluginChatGenerationBundle {
  displayBlocks: ChatBlock[]
  messages: ChatGenerationPreviewMessage[]
  promptMetadata: JsonRecord
  toolDefinitions: LlmToolDefinition[]
  virtualBlocks: ChatBlock[]
}

let toolRequestUnsubscribe: (() => void) | null = null

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
    projectPath: project.path,
    allPlugins: project.plugins,
    activePlugins: plugins
  }
}

function projectForPlugin(project: ProjectSnapshot): ProjectSnapshot {
  const sanitized = cloneJson(project)
  sanitized.llmProviders = sanitized.llmProviders.map(provider => ({
    ...provider,
    apiKey: ''
  }))
  return sanitized
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
  const pluginProject = projectForPlugin(project)
  const state: PluginProcessorState = {
    blocks: cloneJson(blocks),
    chat,
    messages: baseMessagesFromBlocks(blocks),
    project: pluginProject,
    virtualBlocks: []
  }
  const metadata: JsonRecord = { plugins: plugins.map(plugin => plugin.manifest.id) }

  const result = asRecord(await invokePluginSandbox('preparePluginChatGeneration', {
    runtime: sandboxRuntime(project, plugins),
    blocks,
    chat,
    metadata,
    project: pluginProject,
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

  const messages = appendToolDefinitionMessages(resultMessages, blocks).filter(messageHasContent)
  return {
    displayBlocks,
    messages,
    promptMetadata,
    toolDefinitions: toolDefinitionsForChat(plugins, blocks),
    virtualBlocks
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
