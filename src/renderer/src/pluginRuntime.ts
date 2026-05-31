import ejs from 'ejs'
import { buildSillyTavernLikePrompt, testWorldEntryActivations } from '../../shared/st-prompt-builder'
import { chatBlockTargetRole } from '../../shared/chat-blocks'
import type {
  ChatBlock,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  ChatRuntimeConfig,
  ChatSession,
  CharacterEntry,
  JsonRecord,
  LlmToolDefinition,
  LoreBook,
  PluginDescriptor,
  PluginManifest,
  PluginToolCallManifest,
  PluginToolCallRequest,
  ProjectSnapshot,
  WorldEntry
} from '../../shared/types'
import { asRecord, asString } from '../../shared/value-utils'

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

interface ProcessorState {
  blocks: ChatBlock[]
  chat: ChatSession
  messages: ChatGenerationPreviewMessage[]
  project: ProjectSnapshot
  virtualBlocks: ChatBlock[]
}

interface LoadedPlugin {
  descriptor: PluginDescriptor
  globalExport: unknown
}

interface PluginFileRecord {
  fileName: string
  data: JsonRecord
}

type SillyTavernRuntimeConfig = ChatRuntimeConfig & {
  characterId: number | null
  loreBookIds: number[]
  characterRegexScriptsEnabled: boolean
  promptTemplateVariables: JsonRecord
}

const DEFAULT_USER_NAME = 'User'
const pluginScopes: PluginScopes = { chat: {}, global: {} }
let loadedProjectSignature = ''
let loadedPlugins: LoadedPlugin[] = []
let toolRequestUnsubscribe: (() => void) | null = null

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function dispatchPluginDataChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('st-forge-plugin-data-changed', { detail: { pluginId } }))
}

function dispatchProjectSnapshotChanged(): void {
  window.dispatchEvent(new CustomEvent('st-forge-project-snapshot-changed'))
}

function pluginDataFor(config: ChatRuntimeConfig, pluginId: string): JsonRecord {
  return asRecord(asRecord(config.pluginData)[pluginId])
}

function textFromParts(parts: ChatContentPart[]): string {
  return parts.map(part => {
    if (part.type === 'text') return part.text
    if (part.type !== 'tool_call' || part.sendAsContext !== true) return ''
    return [
      `[Tool call: ${part.toolName}]`,
      `input: ${JSON.stringify(part.input)}`,
      part.status === 'success' ? `output: ${JSON.stringify(part.output ?? null)}` : '',
      part.status === 'error' ? `error: ${part.error ?? ''}` : ''
    ].filter(Boolean).join('\n')
  }).join('')
}

function messageHasContent(message: ChatGenerationPreviewMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  return message.content.some(part => part.type === 'tool_call' || part.text.trim().length > 0)
}

function baseMessagesFromBlocks(blocks: ChatBlock[]): ChatGenerationPreviewMessage[] {
  return blocks
    .filter(block => block.enabled && block.metadata.virtual !== true)
    .map((block): ChatGenerationPreviewMessage | null => {
      const text = textFromParts(block.contentParts).trim()
      if (!text) return null
      return {
        role: chatBlockTargetRole(block),
        content: text,
        blockId: block.id
      }
    })
    .filter((message): message is ChatGenerationPreviewMessage => message !== null)
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
      const text = textFromParts(block.contentParts).trim()
      return text ? { role: 'system', content: text, blockId: block.id } : null
    })
    .filter((message): message is ChatGenerationPreviewMessage => message !== null)
  return [...messages, ...toolMessages]
}

function mergeVirtualBlocks(blocks: ChatBlock[], virtualBlocks: ChatBlock[]): ChatBlock[] {
  const startBlocks: ChatBlock[] = []
  const endBlocks: ChatBlock[] = []
  const before = new Map<number, ChatBlock[]>()
  const after = new Map<number, ChatBlock[]>()

  for (const block of virtualBlocks) {
    const metadata = asRecord(block.metadata)
    const beforeBlockId = typeof metadata.displayBeforeBlockId === 'number' ? metadata.displayBeforeBlockId : null
    const afterBlockId = typeof metadata.displayAfterBlockId === 'number' ? metadata.displayAfterBlockId : null
    if (beforeBlockId !== null) {
      const list = before.get(beforeBlockId) ?? []
      list.push(block)
      before.set(beforeBlockId, list)
      continue
    }
    if (afterBlockId !== null) {
      const list = after.get(afterBlockId) ?? []
      list.push(block)
      after.set(afterBlockId, list)
      continue
    }
    if (metadata.displaySlot === 'end') endBlocks.push(block)
    else startBlocks.push(block)
  }

  const result = [...startBlocks]
  for (const block of blocks) {
    result.push(...(before.get(block.id) ?? []), block, ...(after.get(block.id) ?? []))
  }
  result.push(...endBlocks)
  return result
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
        return clone(fallback)
      }
    },
    readJsonFor: async (targetPluginId: string, path: string, fallback: unknown = {}) => {
      try {
        return JSON.parse(await window.electronAPI.readPluginDataFile(targetPluginId, path))
      } catch {
        return clone(fallback)
      }
    },
    writeJson: (path: string, value: unknown) => writeText(path, `${JSON.stringify(value, null, 2)}\n`),
    writeJsonFor: (targetPluginId: string, path: string, value: unknown) => (
      writeTextFor(targetPluginId, path, `${JSON.stringify(value, null, 2)}\n`)
    )
  }
}

function normalizeCharacter(record: PluginFileRecord, id: number): CharacterEntry {
  const data = asRecord(record.data.data)
  data.name = asString(data.name ?? record.data.name, record.fileName.replace(/\.json$/i, ''))
  data.extensions = {
    ...asRecord(data.extensions),
    depth_prompt: {
      prompt: asString(asRecord(asRecord(data.extensions).depth_prompt).prompt),
      depth: Number(asRecord(asRecord(data.extensions).depth_prompt).depth ?? 4),
      role: asString(asRecord(asRecord(data.extensions).depth_prompt).role, 'system')
    }
  }
  return {
    id,
    createdAt: '',
    updatedAt: '',
    assetPath: null,
    stData: { ...record.data, data },
    forgeData: { loreBookId: null, exportFileName: record.fileName, characterBookName: '' }
  }
}

function normalizeWorldEntry(value: unknown, id: number, loreBookId: number): WorldEntry {
  const record = asRecord(value)
  const extensions = asRecord(record.extensions)
  const position = Number(extensions.position ?? (record.position === 'after_char' ? 1 : 0))
  return {
    id,
    loreBookId,
    createdAt: '',
    updatedAt: '',
    stData: {
      id,
      keys: Array.isArray(record.keys) ? record.keys.map(String) : Array.isArray(record.key) ? record.key.map(String) : [],
      secondary_keys: Array.isArray(record.secondary_keys) ? record.secondary_keys.map(String) : [],
      comment: asString(record.comment),
      content: asString(record.content),
      constant: record.constant === true,
      selective: record.selective === true,
      insertion_order: Number(record.insertion_order ?? record.order ?? 100),
      enabled: record.enabled !== false && record.disable !== true,
      position: position === 1 ? 'after_char' : 'before_char',
      case_sensitive: record.case_sensitive === undefined ? undefined : record.case_sensitive === true,
      extensions: {
        ...extensions,
        position,
        depth: Number(extensions.depth ?? 4),
        role: extensions.role ?? 0,
        probability: Number(extensions.probability ?? 100),
        useProbability: extensions.useProbability !== false,
        selectiveLogic: Number(extensions.selectiveLogic ?? 0)
      }
    },
    forgeData: {}
  }
}

async function loadJsonRecords(pluginId: string, directory: string): Promise<PluginFileRecord[]> {
  const files = await window.electronAPI.listPluginDataFiles(pluginId, directory)
  const jsonFiles = files.filter(file => !file.isDirectory && file.name.endsWith('.json'))
  const records = await Promise.all(jsonFiles.map(async file => {
    try {
      return {
        fileName: file.name,
        data: asRecord(JSON.parse(await window.electronAPI.readPluginDataFile(pluginId, file.path)))
      }
    } catch {
      return null
    }
  }))
  return records.filter((record): record is PluginFileRecord => record !== null)
}

async function loadSillyTavernCompatData(chat: ChatSession) {
  const [characterRecords, worldBookRecords] = await Promise.all([
    loadJsonRecords('silly_tavern_compat', 'characters'),
    loadJsonRecords('silly_tavern_compat', 'worldbooks')
  ])
  const characters = characterRecords.map((record, index) => normalizeCharacter(record, index + 1))
  const loreBooks: LoreBook[] = worldBookRecords.map((record, index) => ({
    id: index + 1,
    name: asString(record.data.name, record.fileName.replace(/\.json$/i, '')),
    createdAt: '',
    updatedAt: ''
  }))
  const worldEntries = worldBookRecords.flatMap((record, bookIndex) => {
    const loreBookId = bookIndex + 1
    const entries = Array.isArray(record.data.entries)
      ? record.data.entries
      : Object.values(asRecord(record.data.entries))
    return entries.map((entry, index) => normalizeWorldEntry(entry, index + 1 + bookIndex * 10000, loreBookId))
  })
  const config = pluginDataFor(chat.runtimeConfig, 'silly_tavern_compat')
  const characterFile = asString(config.characterFile)
  const worldBookFiles = Array.isArray(config.worldBookFiles) ? config.worldBookFiles.map(String) : []
  const selectedCharacterIndex = characterRecords.findIndex(record => record.fileName === characterFile)
  const characterId = selectedCharacterIndex >= 0 ? selectedCharacterIndex + 1 : characters[0]?.id ?? null
  const selectedWorldBookIds = worldBookFiles.length
    ? worldBookFiles.map(fileName => worldBookRecords.findIndex(record => record.fileName === fileName) + 1).filter(id => id > 0)
    : loreBooks.map(book => book.id)
  const runtimeConfig: SillyTavernRuntimeConfig = {
    ...chat.runtimeConfig,
    characterId: characters.some(character => character.id === characterId) ? characterId : characters[0]?.id ?? null,
    loreBookIds: selectedWorldBookIds,
    characterRegexScriptsEnabled: true,
    promptTemplateVariables: {}
  }
  return {
    characters,
    loreBooks,
    worldEntries,
    runtimeConfig
  }
}

function createSillyTavernCompatProcessor() {
  return {
    async process(state: ProcessorState) {
      const data = await loadSillyTavernCompatData(state.chat)
      const prompt = buildSillyTavernLikePrompt({
        chat: {
          ...state.chat,
          runtimeConfig: data.runtimeConfig
        },
        characters: data.characters,
        loreBooks: data.loreBooks,
        worldEntries: data.worldEntries,
        blocks: state.blocks
      })
      return {
        blocks: mergeVirtualBlocks(state.blocks, prompt.virtualBlocks),
        messages: prompt.messages,
        virtualBlocks: prompt.virtualBlocks,
        metadata: {
          sillyTavernCompat: {
            characterId: data.runtimeConfig.characterId,
            loreBookIds: data.runtimeConfig.loreBookIds
          }
        }
      }
    }
  }
}

async function renderPromptTemplateText(content: string, variables: JsonRecord): Promise<string> {
  if (!content.includes('<%')) return content
  try {
    return await ejs.render(content, {
      ...variables,
      variables,
      userName: DEFAULT_USER_NAME
    }, {
      async: true,
      outputFunctionName: 'print'
    })
  } catch {
    return content
  }
}

function messageText(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content
  return content.map(part => part.type === 'text' ? part.text : '').join('')
}

function messageWithText(message: ChatGenerationPreviewMessage, text: string): ChatGenerationPreviewMessage {
  if (typeof message.content === 'string') return { ...message, content: text }
  return {
    ...message,
    content: message.content.map(part => part.type === 'text' ? { ...part, text } : part)
  }
}

async function renderContentParts(parts: ChatContentPart[], variables: JsonRecord): Promise<ChatContentPart[]> {
  return Promise.all(parts.map(async part => {
    if (part.type !== 'text' && part.type !== 'reasoning') return part
    return {
      ...part,
      text: await renderPromptTemplateText(part.text, variables)
    }
  }))
}

async function renderBlock(block: ChatBlock, variables: JsonRecord): Promise<ChatBlock> {
  return {
    ...block,
    contentParts: await renderContentParts(block.contentParts, {
      ...variables,
      blockId: block.id,
      kind: block.kind,
      role: chatBlockTargetRole(block)
    }),
    metadata: {
      ...block.metadata,
      renderedByPlugin: 'st_prompt_template_compat'
    }
  }
}

function createPromptTemplateCompatProcessor(pluginId: string) {
  return {
    async process(state: ProcessorState) {
      const config = asRecord(await storageApi(pluginId).readJson('config.json', {
        enabled: true,
        renderMessages: true,
        globalVariables: {}
      }))
      if (config.enabled === false || config.renderMessages === false) return {}
      const variables = asRecord(config.globalVariables)
      const messages = await Promise.all(state.messages.map(async message => (
        messageWithText(message, await renderPromptTemplateText(messageText(message.content), {
          ...variables,
          chatId: state.chat.id,
          role: message.role
        }))
      )))
      const blocks = await Promise.all(state.blocks.map(block => renderBlock(block, {
        ...variables,
        chatId: state.chat.id
      })))
      return {
        blocks,
        messages,
        metadata: { promptTemplateCompat: { enabled: true } }
      }
    }
  }
}

function entryTitle(entry: WorldEntry): string {
  return entry.stData.comment?.trim() || entry.stData.keys.join(', ') || `Entry #${entry.id}`
}

function roleToNumber(value: unknown): number | null {
  if (value === 'system') return 0
  if (value === 'user') return 1
  if (value === 'assistant') return 2
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(2, Math.trunc(number))) : null
}

function applyToolInput(entry: JsonRecord, input: JsonRecord): JsonRecord {
  const next = clone(entry)
  const extensions = asRecord(next.extensions)
  if (input.title !== undefined) next.comment = String(input.title)
  if (input.content !== undefined) next.content = String(input.content)
  if (input.enabled !== undefined) next.enabled = input.enabled === true
  if (input.constant !== undefined) next.constant = input.constant === true
  if (input.selective !== undefined) next.selective = input.selective === true
  if (input.order !== undefined && input.order !== null) next.insertion_order = Number(input.order)
  if (Array.isArray(input.keys)) next.keys = input.keys.map(String).filter(Boolean)
  if (Array.isArray(input.secondaryKeys)) next.secondary_keys = input.secondaryKeys.map(String).filter(Boolean)
  if (input.position !== undefined && input.position !== null) {
    const position = Number(input.position)
    extensions.position = position
    next.position = position === 1 ? 'after_char' : 'before_char'
  }
  const role = roleToNumber(input.role)
  if (role !== null) extensions.role = role
  if (input.depth !== undefined && input.depth !== null) extensions.depth = Math.max(0, Number(input.depth))
  if (input.probability !== undefined && input.probability !== null) extensions.probability = Math.max(0, Math.min(100, Number(input.probability)))
  if (input.selectiveLogic !== undefined && input.selectiveLogic !== null) extensions.selectiveLogic = Math.max(0, Math.min(3, Number(input.selectiveLogic)))
  next.extensions = extensions
  return next
}

function createLoreBookToolHandler() {
  return {
    async handle(request: PluginToolCallRequest) {
      const worldBookFile = asString(request.commonArgs.worldBookFile)
      if (!worldBookFile) throw new Error('工具通参缺少 worldBookFile。')
      const path = `worldbooks/${worldBookFile}`
      const book = asRecord(JSON.parse(await window.electronAPI.readPluginDataFile('silly_tavern_compat', path)))
      const entries = Array.isArray(book.entries) ? book.entries.map(asRecord) : []
      const normalizedEntries = entries.map((entry, index) => normalizeWorldEntry(entry, Number(entry.id ?? index + 1), 1))

      if (request.toolName === 'list_lorebook_entries') {
        return normalizedEntries
          .sort((a, b) => a.stData.insertion_order - b.stData.insertion_order || a.id - b.id)
          .map(entry => [entry.id, entryTitle(entry)])
      }
      if (request.toolName === 'get_lorebook_entries_json') {
        const ids = new Set(Array.isArray(request.input.ids) ? request.input.ids.map(Number) : [])
        return entries.filter((entry, index) => ids.has(Number(entry.id ?? index + 1)))
      }
      if (request.toolName === 'test_lorebook_trigger') {
        return testWorldEntryActivations(normalizedEntries, asString(request.input.example))
      }
      if (request.toolName === 'upsert_lorebook_entry') {
        const requestedId = request.input.id === undefined || request.input.id === null ? null : Number(request.input.id)
        const index = requestedId === null ? -1 : entries.findIndex((entry, entryIndex) => Number(entry.id ?? entryIndex + 1) === requestedId)
        if (index >= 0) {
          entries[index] = applyToolInput(entries[index], request.input)
          book.entries = entries
          await window.electronAPI.writePluginDataFile('silly_tavern_compat', path, `${JSON.stringify(book, null, 2)}\n`)
          dispatchPluginDataChanged('silly_tavern_compat')
          return { success: true, id: requestedId, title: asString(entries[index].comment, `Entry #${requestedId}`) }
        }
        const nextId = Math.max(0, ...entries.map((entry, entryIndex) => Number(entry.id ?? entryIndex + 1)).filter(Number.isFinite)) + 1
        const created = applyToolInput({
          id: nextId,
          keys: [],
          secondary_keys: [],
          comment: '',
          content: '',
          constant: false,
          selective: false,
          insertion_order: entries.length + 1,
          enabled: true,
          position: 'before_char',
          extensions: { position: 0, depth: 4, role: 0, probability: 100, useProbability: true, selectiveLogic: 0 }
        }, request.input)
        created.id = nextId
        entries.push(created)
        book.entries = entries
        await window.electronAPI.writePluginDataFile('silly_tavern_compat', path, `${JSON.stringify(book, null, 2)}\n`)
        dispatchPluginDataChanged('silly_tavern_compat')
        return { success: true, id: nextId, title: asString(created.comment, `Entry #${nextId}`) }
      }
      throw new Error(`未知世界书工具：${request.toolName}`)
    }
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
    loreBookTools: { createHandler: createLoreBookToolHandler },
    promptTemplateCompat: { createProcessor: () => createPromptTemplateCompatProcessor(pluginId) },
    sillyTavernCompat: { createProcessor: createSillyTavernCompatProcessor },
    storage: storageApi(pluginId)
  }
}

async function executePluginScript(plugin: PluginManifest, path: string, context: JsonRecord): Promise<unknown> {
  const code = await window.electronAPI.readPluginFile(plugin.id, path)
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
  const state: ProcessorState = {
    blocks: clone(blocks),
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
        chat,
        plugin
      }) ?? {}
    }
    const processorPath = plugin.entry?.chatBlockProcessor
    if (!processorPath) continue
    const processor = asRecord(await executePluginScript(plugin, processorPath, {
      api: runtimeApi(plugin.id, chat, blocks),
      chat,
      plugin,
      project
    }))
    if (typeof processor.process !== 'function') continue
    const result = asRecord(await (processor.process as Function)(state))
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
