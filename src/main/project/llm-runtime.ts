import type { WebContents } from 'electron'
import { jsonSchema, stepCountIs, streamText, tool, type LanguageModelUsage } from 'ai'
import { buildSillyTavernLikePrompt } from '../../shared/st-prompt-builder'
import { LOREBOOK_EDIT_TOOL_GROUP, LOREBOOK_EDIT_TOOL_NAMES, loreBookToolFieldHints } from '../../shared/lorebook-tooling'
import { asRecord, asString } from '../../shared/value-utils'
import {
  filterPromptTemplateMessageBlocks,
  preprocessPromptTemplate,
  processPromptTemplateBlockRender,
  processPromptTemplateGeneration,
  processPromptTemplateOutput,
  type PromptTemplateGenerationResult,
  type PromptTemplatePreprocessResult,
  type RuntimeWorldEntry
} from './prompt-template'
import type {
  ChatBlock,
  ChatBlockTokenUsage,
  ChatContentPart,
  ChatGenerationEvent,
  ChatGenerationPreviewMessage,
  ChatGenerationRequest,
  ChatGenerationStartResult,
  JsonRecord,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  PromptTemplateDiagnostic,
  PromptTemplateBlockRenderRequest,
  PromptTemplateBlockRenderResult,
  PromptTemplateVariables
} from '../../shared/types'
import {
  getLoreBookDraftEntriesJson,
  listLoreBookDraftEntries,
  testLoreBookDraftTrigger,
  upsertLoreBookDraftEntry,
  type LoreBookEntryUpsertInput
} from './lorebook-drafts'
import {
  createAssistantGenerationBlock,
  getChat,
  getChatBlock,
  getProjectSnapshot,
  listCharacters,
  listChatBlocksForChat,
  listLoreBooks,
  listWorldEntries,
  prepareAssistantBlockForRegeneration,
  updateChat,
  updateProjectConfig,
  updateAssistantGenerationBlock
} from './store'
import {
  createLanguageModel,
  providerOptionsKey,
  resolveLlmProviderForInstance
} from './llm-provider'

type ModelMessage = ChatGenerationPreviewMessage

interface ActiveGeneration {
  abortController: AbortController
  blockId: number
  chatId: number
}

interface PromptTemplateBundle {
  messages: ModelMessage[]
  requestBlockIds: number[]
  templateDiagnostics: PromptTemplateDiagnostic[]
  templateVariables: PromptTemplateVariables
  templateGlobalVariables: JsonRecord
  templateLocalVariables: JsonRecord
  templateMessageVariablesByBlockId: Map<number, JsonRecord>
  specialEntries: RuntimeWorldEntry[]
}

const activeGenerations = new Map<number, ActiveGeneration>()

const LEGACY_LOREBOOK_EDIT_TOOL_NAMES = [
  'list_lorebook_entries',
  'test_lorebook_trigger',
  'upsert_lorebook_entry'
] as const

function usageNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeUsage(usage: LanguageModelUsage | null | undefined): ChatBlockTokenUsage | null {
  if (!usage) return null
  const normalized: ChatBlockTokenUsage = {
    inputTokens: usageNumber(usage.inputTokens),
    inputTokenDetails: {
      noCacheTokens: usageNumber(usage.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: usageNumber(usage.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: usageNumber(usage.inputTokenDetails?.cacheWriteTokens)
    },
    outputTokens: usageNumber(usage.outputTokens),
    outputTokenDetails: {
      textTokens: usageNumber(usage.outputTokenDetails?.textTokens),
      reasoningTokens: usageNumber(usage.outputTokenDetails?.reasoningTokens)
    },
    totalTokens: usageNumber(usage.totalTokens)
  }
  const raw = asRecord(usage.raw)
  if (Object.keys(raw).length > 0) normalized.raw = raw

  const hasTokenCount = [
    normalized.inputTokens,
    normalized.inputTokenDetails?.noCacheTokens,
    normalized.inputTokenDetails?.cacheReadTokens,
    normalized.inputTokenDetails?.cacheWriteTokens,
    normalized.outputTokens,
    normalized.outputTokenDetails?.textTokens,
    normalized.outputTokenDetails?.reasoningTokens,
    normalized.totalTokens
  ].some(value => typeof value === 'number')

  return hasTokenCount || normalized.raw ? normalized : null
}

function sendEvent(webContents: WebContents, event: ChatGenerationEvent): void {
  if (!webContents.isDestroyed()) {
    webContents.send('chat:generationEvent', event)
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function messageHasSendableContent(message: ModelMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  return message.content.some(part => {
    if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0
    return true
  })
}

function generationSettings(instance: LlmInstance, abortSignal: AbortSignal): JsonRecord {
  const parameters = instance.parameters
  const settings: JsonRecord = { ...instance.extra }

  const setNumber = (key: keyof LlmGenerationParameters) => {
    const value = parameters[key]
    if (typeof value === 'number' && Number.isFinite(value)) settings[key] = value
  }

  setNumber('temperature')
  setNumber('topP')
  setNumber('maxOutputTokens')
  setNumber('frequencyPenalty')
  setNumber('presencePenalty')
  setNumber('topK')
  setNumber('seed')

  if (parameters.stopSequences?.length) {
    settings.stopSequences = parameters.stopSequences.filter(Boolean)
  }
  if (parameters.responseFormat === 'json') {
    settings.responseFormat = { type: 'json' }
  } else if (parameters.responseFormat === 'text') {
    settings.responseFormat = { type: 'text' }
  }

  const providerOptions = asRecord(settings.providerOptions)
  const providerKey = providerOptionsKey(instance)
  const providerOption = asRecord(providerOptions[providerKey])
  if (typeof parameters.repetitionPenalty === 'number' && Number.isFinite(parameters.repetitionPenalty)) {
    providerOption.repetitionPenalty = parameters.repetitionPenalty
  }
  if (parameters.reasoningEffort) {
    providerOption.reasoningEffort = parameters.reasoningEffort
    providerOption.effort = parameters.reasoningEffort
  }
  if (Object.keys(providerOption).length) {
    settings.providerOptions = { ...providerOptions, [providerKey]: providerOption }
  }

  settings.abortSignal = abortSignal
  settings.maxRetries = 0
  return settings
}

interface ActiveLoreBookToolDefinition {
  block: ChatBlock
  loreBookId: number
  loreBookName: string
  toolNames: Array<typeof LOREBOOK_EDIT_TOOL_NAMES[number]>
}

function numberFromToolDefinition(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function activeLoreBookToolDefinition(blocks: ChatBlock[]): ActiveLoreBookToolDefinition | null {
  const loreBooks = listLoreBooks()
  const loreBookById = new Map(loreBooks.map(book => [book.id, book]))
  const definitions = [...blocks]
    .filter(block => block.enabled && block.kind === 'tool_definition')
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)

  for (const block of definitions.reverse()) {
    const definition = asRecord(block.metadata.toolDefinition)
    if (asString(definition.group) !== LOREBOOK_EDIT_TOOL_GROUP) continue
    const loreBookId = numberFromToolDefinition(definition.loreBookId)
    if (loreBookId === null) continue
    const loreBook = loreBookById.get(loreBookId)
    if (!loreBook) continue
    const enabledTools = Array.isArray(definition.enabledTools)
      ? definition.enabledTools.filter((name): name is typeof LOREBOOK_EDIT_TOOL_NAMES[number] => (
        typeof name === 'string' && (LOREBOOK_EDIT_TOOL_NAMES as readonly string[]).includes(name)
      ))
      : [...LOREBOOK_EDIT_TOOL_NAMES]
    const hasLegacyFullSet = LEGACY_LOREBOOK_EDIT_TOOL_NAMES.every(name => enabledTools.includes(name))
    const toolNames = hasLegacyFullSet
      ? [...new Set([...enabledTools, 'get_lorebook_entries_json' as const])]
      : enabledTools
    return {
      block,
      loreBookId,
      loreBookName: loreBook.name,
      toolNames: toolNames.length > 0 ? toolNames : [...LOREBOOK_EDIT_TOOL_NAMES]
    }
  }

  return null
}

function loreBookToolSchemas() {
  return {
    list_lorebook_entries: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
      additionalProperties: false
    }),
    get_lorebook_entries_json: jsonSchema<{ ids: number[] }>({
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'number' },
          description: '要读取完整 JSON 的世界书条目 id 列表。可包含正式条目 id 或临时副本中新建条目的负数 id。'
        }
      },
      required: ['ids'],
      additionalProperties: false
    }),
    test_lorebook_trigger: jsonSchema<{ example: string }>({
      type: 'object',
      properties: {
        example: {
          type: 'string',
          description: '用于测试世界书触发的例句。系统会把它当作最新一条用户消息进行扫描。'
        }
      },
      required: ['example'],
      additionalProperties: false
    }),
    upsert_lorebook_entry: jsonSchema<LoreBookEntryUpsertInput>({
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: '要更新的世界书条目 id；不传或传入不存在的 id 时会新建条目，并返回新条目 id。'
        },
        title: { type: 'string', description: loreBookToolFieldHints.title },
        order: { type: 'number', description: loreBookToolFieldHints.order },
        position: {
          type: 'number',
          enum: [0, 1, 2, 3, 4, 5, 6, 7],
          description: `${loreBookToolFieldHints.position} 0=Before Char Defs，1=After Char Defs，2=Before Author's Note，3=After Author's Note，4=At Depth，5=Before Example Messages，6=After Example Messages，7=Outlet。`
        },
        role: {
          anyOf: [
            { type: 'number', enum: [0, 1, 2] },
            { type: 'string', enum: ['system', 'user', 'assistant'] }
          ],
          description: `${loreBookToolFieldHints.role} 0/system，1/user，2/assistant。`
        },
        depth: { type: 'number', description: loreBookToolFieldHints.depth },
        outletName: { type: 'string', description: loreBookToolFieldHints.outletName },
        probability: { type: 'number', minimum: 0, maximum: 100, description: loreBookToolFieldHints.probability },
        enabled: { type: 'boolean', description: loreBookToolFieldHints.enabled },
        constant: { type: 'boolean', description: loreBookToolFieldHints.constant },
        selective: { type: 'boolean', description: loreBookToolFieldHints.selective },
        selectiveLogic: {
          type: 'number',
          enum: [0, 1, 2, 3],
          description: `${loreBookToolFieldHints.selectiveLogic} 0=AND ANY，3=AND ALL，1=NOT ALL，2=NOT ANY。`
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: loreBookToolFieldHints.keys
        },
        secondaryKeys: {
          type: 'array',
          items: { type: 'string' },
          description: loreBookToolFieldHints.secondaryKeys
        },
        content: { type: 'string', description: loreBookToolFieldHints.content }
      },
      additionalProperties: false
    })
  }
}

function loreBookEditTools(definition: ActiveLoreBookToolDefinition) {
  const schemas = loreBookToolSchemas()
  return {
    list_lorebook_entries: tool({
      description: `获取世界书「${definition.loreBookName}」临时副本中的所有条目，只返回 [id, title] 二元组。`,
      inputSchema: schemas.list_lorebook_entries,
      execute: async () => listLoreBookDraftEntries(definition.loreBookId)
    }),
    get_lorebook_entries_json: tool({
      description: `按 id 列表读取世界书「${definition.loreBookName}」临时副本中的完整条目 JSON，返回匹配到的 WorldEntry 对象列表。`,
      inputSchema: schemas.get_lorebook_entries_json,
      execute: async ({ ids }) => getLoreBookDraftEntriesJson(definition.loreBookId, ids)
    }),
    test_lorebook_trigger: tool({
      description: `用一条例句测试世界书「${definition.loreBookName}」临时副本会触发哪些条目，返回 id/title/reason/content。`,
      inputSchema: schemas.test_lorebook_trigger,
      execute: async ({ example }) => testLoreBookDraftTrigger(definition.loreBookId, example)
    }),
    upsert_lorebook_entry: tool({
      description: `更新或新建世界书「${definition.loreBookName}」临时副本中的条目。只允许编辑世界书编辑 UI 中除高级 JSON 以外的字段。`,
      inputSchema: schemas.upsert_lorebook_entry,
      execute: async (input) => upsertLoreBookDraftEntry(definition.loreBookId, input)
    })
  }
}

function generatedText(parts: ChatContentPart[]): string {
  return parts.filter(part => part.type === 'text').map(part => part.text).join('')
}

function hasVisibleGenerationParts(parts: ChatContentPart[]): boolean {
  return parts.some(part => (
    (part.type === 'text' || part.type === 'reasoning') ? part.text.trim().length > 0 : true
  ))
}

function appendTextDelta(parts: ChatContentPart[], type: 'text' | 'reasoning', text: string): ChatContentPart[] {
  const next = [...parts]
  const last = next.at(-1)
  if (last?.type === type) {
    next[next.length - 1] = { ...last, text: last.text + text }
    return next
  }
  next.push({ type, text })
  return next
}

function loreBookToolCallExtensions(definition: ActiveLoreBookToolDefinition | null): JsonRecord {
  if (!definition) return {}
  return {
    loreBookEdit: {
      sourceToolDefinitionBlockId: definition.block.id,
      loreBookId: definition.loreBookId,
      loreBookName: definition.loreBookName
    }
  }
}

function upsertToolCallPart(
  parts: ChatContentPart[],
  patch: {
    toolCallId: string
    toolName: string
    status: 'pending' | 'success' | 'error'
    input?: unknown
    output?: unknown
    error?: string
    extensions?: JsonRecord
  }
): ChatContentPart[] {
  const now = new Date().toISOString()
  const next = [...parts]
  const index = next.findIndex(part => part.type === 'tool_call' && part.toolCallId === patch.toolCallId)
  const current = index >= 0 && next[index].type === 'tool_call' ? next[index] : null
  const part = {
    type: 'tool_call' as const,
    toolCallId: patch.toolCallId,
    toolName: patch.toolName,
    status: patch.status,
    input: patch.input === undefined ? current?.input ?? {} : asRecord(patch.input),
    output: patch.output === undefined ? current?.output : patch.output,
    error: patch.error === undefined ? current?.error : patch.error,
    sendAsContext: current?.sendAsContext === true,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    extensions: patch.extensions ?? current?.extensions ?? {}
  }

  if (index >= 0) next[index] = part
  else next.push(part)
  return next
}

function contextBlocksForGeneration(chatId: number, regenerateBlockId?: number | null): ChatBlock[] {
  const blocks = listChatBlocksForChat(chatId)
  if (!regenerateBlockId) return blocks
  const target = blocks.find(block => block.id === regenerateBlockId)
  if (!target) throw new Error('要重新生成的助手块不存在。')
  if (target.kind !== 'assistant') throw new Error('只能重新生成助手块。')
  return blocks.filter(block => block.orderIndex < target.orderIndex)
}

async function buildPromptBundle(
  chat: ReturnType<typeof getChat>,
  blocks: ChatBlock[],
  options: { dryRun?: boolean } = {}
): Promise<PromptTemplateBundle> {
  const config = getProjectSnapshot().config.promptTemplate
  const settings = config.settings
  const contextBlocks = filterPromptTemplateMessageBlocks(settings, blocks)
  const characters = listCharacters()
  const loreBooks = listLoreBooks()
  const worldEntries = listWorldEntries()
  const preprocessed: PromptTemplatePreprocessResult = await preprocessPromptTemplate({
    chat,
    characters,
    loreBooks,
    worldEntries,
    blocks: contextBlocks,
    settings,
    globalVariables: config.globalVariables,
    dryRun: options.dryRun
  })
  const prompt = buildSillyTavernLikePrompt({
    chat: {
      ...chat,
      runtimeConfig: {
        ...chat.runtimeConfig,
        promptTemplateVariables: preprocessed.localVariables
      }
    },
    characters,
    loreBooks,
    worldEntries: preprocessed.worldEntries,
    blocks: contextBlocks
  })
  const generated: PromptTemplateGenerationResult = await processPromptTemplateGeneration({
    chat: {
      ...chat,
      runtimeConfig: {
        ...chat.runtimeConfig,
        promptTemplateVariables: preprocessed.localVariables
      }
    },
    characters,
    loreBooks,
    worldEntries: preprocessed.worldEntries,
    blocks: contextBlocks,
    settings,
    globalVariables: preprocessed.globalVariables,
    initialVariables: preprocessed.variables.initial,
    messageVariablesByBlockId: preprocessed.messageVariablesByBlockId,
    dryRun: options.dryRun,
    messages: prompt.messages,
    virtualBlocks: prompt.virtualBlocks,
    specialEntries: preprocessed.specialEntries
  })

  return {
    messages: generated.messages.filter(messageHasSendableContent),
    requestBlockIds: prompt.requestBlockIds,
    templateDiagnostics: [...preprocessed.diagnostics, ...generated.diagnostics],
    templateVariables: generated.variables,
    templateGlobalVariables: generated.globalVariables,
    templateLocalVariables: generated.localVariables,
    templateMessageVariablesByBlockId: generated.messageVariablesByBlockId,
    specialEntries: preprocessed.specialEntries
  }
}

async function persistPromptTemplateVariables(chat: ReturnType<typeof getChat>, bundle: Pick<PromptTemplateBundle, 'templateGlobalVariables' | 'templateLocalVariables'>): Promise<void> {
  await updateProjectConfig({
    promptTemplate: {
      ...getProjectSnapshot().config.promptTemplate,
      globalVariables: bundle.templateGlobalVariables
    }
  })
  const currentChat = getChat(chat.id)
  updateChat({
    id: chat.id,
    runtimeConfig: {
      ...currentChat.runtimeConfig,
      promptTemplateVariables: bundle.templateLocalVariables
    }
  })
}

export async function previewChatGeneration(request: ChatGenerationRequest): Promise<ChatGenerationPreviewMessage[]> {
  const chat = getChat(request.chatId)
  if (activeGenerations.has(chat.id)) {
    throw new Error('当前聊天已有正在生成的块。')
  }
  resolveLlmProviderForInstance(chat.runtimeConfig.llmInstanceId)
  const contextBlocks = contextBlocksForGeneration(chat.id, request.regenerateBlockId)
    .filter(block => block.id !== request.regenerateBlockId)
  const prompt = await buildPromptBundle(chat, contextBlocks, { dryRun: true })
  const messages = prompt.messages
  if (!messages.length) {
    throw new Error('没有可发送的内容块。')
  }

  return messages
}

export async function renderPromptTemplateBlock(request: PromptTemplateBlockRenderRequest): Promise<PromptTemplateBlockRenderResult> {
  const chat = getChat(request.chatId)
  const block = getChatBlock(request.blockId)
  if (block.chatId !== chat.id) throw new Error('要渲染的聊天块不属于当前聊天。')

  const config = getProjectSnapshot().config.promptTemplate
  const characters = listCharacters()
  const loreBooks = listLoreBooks()
  const worldEntries = listWorldEntries()
  const blocks = listChatBlocksForChat(chat.id).filter(item => item.orderIndex <= block.orderIndex)
  const preprocessed = await preprocessPromptTemplate({
    chat,
    characters,
    loreBooks,
    worldEntries,
    blocks,
    settings: config.settings,
    globalVariables: config.globalVariables,
    dryRun: true
  })
  const rendered = await processPromptTemplateBlockRender({
    chat: {
      ...chat,
      runtimeConfig: {
        ...chat.runtimeConfig,
        promptTemplateVariables: preprocessed.localVariables
      }
    },
    characters,
    loreBooks,
    worldEntries: preprocessed.worldEntries,
    blocks,
    settings: config.settings,
    globalVariables: preprocessed.globalVariables,
    initialVariables: preprocessed.variables.initial,
    messageVariablesByBlockId: preprocessed.messageVariablesByBlockId,
    dryRun: true,
    block,
    contentParts: block.contentParts,
    specialEntries: preprocessed.specialEntries
  })

  return {
    blockId: block.id,
    contentParts: rendered.contentParts,
    diagnostics: [...preprocessed.diagnostics, ...rendered.diagnostics],
    variables: rendered.variables
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message))
}

async function runGeneration(
  webContents: WebContents,
  chat: ReturnType<typeof getChat>,
  instance: LlmInstance,
  provider: LlmProvider,
  messages: ModelMessage[],
  generationBlock: ChatBlock,
  abortController: AbortController,
  loreBookTools: ActiveLoreBookToolDefinition | null,
  promptBundle: PromptTemplateBundle,
  contextBlocks: ChatBlock[]
): Promise<void> {
  let contentParts: ChatContentPart[] = []
  let lastPersistAt = 0
  let finishReason = ''
  let totalUsage: ChatBlockTokenUsage | null = null
  const persist = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPersistAt < 500) return
    lastPersistAt = now
    updateAssistantGenerationBlock(generationBlock.id, contentParts, 'generating', false)
  }

  try {
    const model = await createLanguageModel(instance, provider)
    const settings = generationSettings(instance, abortController.signal)
    if (loreBookTools) {
      settings.tools = loreBookEditTools(loreBookTools)
      settings.activeTools = loreBookTools.toolNames
      if (!settings.stopWhen) settings.stopWhen = stepCountIs(8)
    }
    const result = streamText({
      ...settings,
      model,
      messages
    } as any)

    for await (const part of result.fullStream) {
      if (part.type === 'finish') {
        finishReason = part.finishReason
        totalUsage = normalizeUsage(part.totalUsage)
        continue
      }
      if (part.type === 'tool-call') {
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'pending',
          input: part.input,
          extensions: loreBookToolCallExtensions(loreBookTools)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId: generationBlock.chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type === 'tool-result') {
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'success',
          input: part.input,
          output: part.output,
          extensions: loreBookToolCallExtensions(loreBookTools)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId: generationBlock.chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type === 'tool-error') {
        const input = asRecord((part as any).input)
        contentParts = upsertToolCallPart(contentParts, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'error',
          input,
          error: errorText((part as any).error),
          extensions: loreBookToolCallExtensions(loreBookTools)
        })
        persist(true)
        sendEvent(webContents, {
          type: 'delta',
          chatId: generationBlock.chatId,
          blockId: generationBlock.id,
          text: '',
          content: generatedText(contentParts),
          contentParts
        })
        continue
      }
      if (part.type !== 'text-delta' && part.type !== 'reasoning-delta') continue
      const text = part.text
      contentParts = appendTextDelta(contentParts, part.type === 'reasoning-delta' ? 'reasoning' : 'text', text)
      persist()
      sendEvent(webContents, {
        type: 'delta',
        chatId: generationBlock.chatId,
        blockId: generationBlock.id,
        text,
        content: generatedText(contentParts),
        contentParts
      })
    }

    if (!totalUsage) {
      try {
        totalUsage = normalizeUsage(await result.totalUsage)
      } catch {
        totalUsage = null
      }
    }
    let outputDiagnostics: PromptTemplateDiagnostic[] = []
    let messageVariables: JsonRecord = {}
    try {
      const config = getProjectSnapshot().config.promptTemplate
      const output = await processPromptTemplateOutput({
        chat: {
          ...getChat(chat.id),
          runtimeConfig: {
            ...getChat(chat.id).runtimeConfig,
            promptTemplateVariables: promptBundle.templateLocalVariables
          }
        },
        characters: listCharacters(),
        loreBooks: listLoreBooks(),
        worldEntries: listWorldEntries(),
        blocks: [...contextBlocks, generationBlock],
        settings: config.settings,
        globalVariables: promptBundle.templateGlobalVariables,
        initialVariables: promptBundle.templateVariables.initial,
        messageVariablesByBlockId: promptBundle.templateMessageVariablesByBlockId,
        block: generationBlock,
        contentParts,
        specialEntries: promptBundle.specialEntries
      })
      contentParts = output.contentParts
      outputDiagnostics = output.diagnostics
      messageVariables = output.messageVariables
      await persistPromptTemplateVariables(getChat(chat.id), {
        templateGlobalVariables: output.globalVariables,
        templateLocalVariables: output.localVariables
      })
    } catch (error) {
      outputDiagnostics = [{
        level: 'error',
        phase: 'render',
        message: `Prompt Template output processing failed: ${errorText(error)}`
      }]
    }

    const finishedAt = new Date().toISOString()
    const metadataPatch: JsonRecord = {
      generationFinishedAt: finishedAt,
      usageRecordedAt: finishedAt,
      promptTemplate: {
        ...asRecord(generationBlock.metadata.promptTemplate),
        variables: messageVariables,
        diagnostics: [...promptBundle.templateDiagnostics, ...outputDiagnostics]
      }
    }
    if (finishReason) metadataPatch.finishReason = finishReason
    if (totalUsage) metadataPatch.usage = totalUsage

    const block = updateAssistantGenerationBlock(
      generationBlock.id,
      contentParts,
      'idle',
      hasVisibleGenerationParts(contentParts),
      '',
      metadataPatch
    )
    sendEvent(webContents, { type: 'finished', chatId: generationBlock.chatId, block })
  } catch (error) {
    if (isAbortError(error) || abortController.signal.aborted) {
      const block = updateAssistantGenerationBlock(
        generationBlock.id,
        contentParts,
        'stopped',
        hasVisibleGenerationParts(contentParts),
        '',
        { generationFinishedAt: new Date().toISOString() }
      )
      sendEvent(webContents, { type: 'stopped', chatId: generationBlock.chatId, block })
      return
    }

    const message = errorText(error)
    const block = updateAssistantGenerationBlock(
      generationBlock.id,
      contentParts,
      'error',
      false,
      message,
      { generationFinishedAt: new Date().toISOString() }
    )
    sendEvent(webContents, { type: 'error', chatId: generationBlock.chatId, block, error: message })
  } finally {
    activeGenerations.delete(generationBlock.chatId)
  }
}

export async function startChatGeneration(
  request: ChatGenerationRequest,
  webContents: WebContents
): Promise<ChatGenerationStartResult> {
  const chat = getChat(request.chatId)
  if (activeGenerations.has(chat.id)) {
    throw new Error('当前聊天已有正在生成的块。')
  }
  const { instance, provider } = resolveLlmProviderForInstance(chat.runtimeConfig.llmInstanceId)
  const contextBlocks = contextBlocksForGeneration(chat.id, request.regenerateBlockId)
    .filter(block => block.id !== request.regenerateBlockId)
  const prompt = await buildPromptBundle(chat, contextBlocks)
  const loreBookTools = activeLoreBookToolDefinition(contextBlocks)
  const messages = prompt.messages
  if (!messages.length) {
    throw new Error('没有可发送的内容块。')
  }

  const generationBlock = request.regenerateBlockId
    ? prepareAssistantBlockForRegeneration(request.regenerateBlockId, instance, prompt.requestBlockIds)
    : createAssistantGenerationBlock(chat.id, instance, prompt.requestBlockIds)
  const promptTemplateMetadata = {
    ...generationBlock.metadata,
    promptTemplate: {
      ...asRecord(generationBlock.metadata.promptTemplate),
      variables: asRecord(prompt.templateMessageVariablesByBlockId.get(generationBlock.id)),
      diagnostics: prompt.templateDiagnostics
    }
  }
  updateAssistantGenerationBlock(
    generationBlock.id,
    generationBlock.contentParts,
    generationBlock.status,
    generationBlock.enabled,
    generationBlock.errorText,
    promptTemplateMetadata
  )
  const currentGenerationBlock = getChatBlock(generationBlock.id)
  await persistPromptTemplateVariables(chat, prompt)
  const abortController = new AbortController()

  activeGenerations.set(chat.id, {
    abortController,
    blockId: currentGenerationBlock.id,
    chatId: chat.id
  })
  sendEvent(webContents, { type: 'started', chatId: chat.id, block: currentGenerationBlock })

  void runGeneration(webContents, chat, instance, provider, messages, currentGenerationBlock, abortController, loreBookTools, prompt, contextBlocks)

  return { block: currentGenerationBlock }
}

export function stopChatGeneration(chatId: number): boolean {
  const generation = activeGenerations.get(chatId)
  if (!generation) return false
  generation.abortController.abort(new Error('用户停止生成'))
  return true
}

export function hasActiveGeneration(chatId?: number): boolean {
  if (chatId !== undefined) return activeGenerations.has(chatId)
  return activeGenerations.size > 0
}
