import type {
  ChatBlock,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  ChatRuntimeConfig,
  CharacterEntry,
  JsonRecord,
  LoreBook,
  WorldEntry
} from './types'

type RuntimeBlock = Pick<ChatBlock, 'id' | 'kind' | 'targetRole' | 'enabled' | 'contentParts' | 'metadata'>

export interface InjectionDetail {
  title: string
  source: 'character' | 'worldInfo'
  sourceName: string
  reason: string
  content: string
  entryId?: number
  loreBookId?: number
}

export interface InjectionPreviewBlock extends ChatBlock {
  metadata: JsonRecord & {
    virtual: true
    source: 'character' | 'worldInfo'
    activatedEntryIds?: number[]
    loreBookIds?: number[]
    injectionDetails?: InjectionDetail[]
    displaySlot?: 'start' | 'end'
    displayBeforeBlockId?: number
    displayAfterBlockId?: number
  }
}

export interface PromptBuildInput {
  chat: { id: number; runtimeConfig: ChatRuntimeConfig; createdAt: string; updatedAt: string }
  characters: CharacterEntry[]
  loreBooks: LoreBook[]
  worldEntries: WorldEntry[]
  blocks: RuntimeBlock[]
}

export interface PromptBuildResult {
  messages: ChatGenerationPreviewMessage[]
  virtualBlocks: InjectionPreviewBlock[]
  requestBlockIds: number[]
  character: CharacterEntry | null
  activeLoreBookIds: number[]
}

interface ActivationEntry {
  entry: WorldEntry
  content: string
  position: number
  order: number
  depth: number
  role: ChatBlockTargetRole
  reason: string
}

const DEFAULT_SCAN_DEPTH = 2
const DEFAULT_DEPTH = 4
const DEFAULT_USER_NAME = 'User'
const DEFAULT_ASSISTANT_NAME = 'Assistant'

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function asNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function blockText(block: RuntimeBlock): string {
  return block.contentParts.filter(part => part.type === 'text').map(part => part.text).join('')
}

function blockReasoningText(block: RuntimeBlock): string {
  return block.contentParts.filter(part => part.type === 'reasoning').map(part => part.text).join('')
}

function shouldSendReasoning(block: RuntimeBlock): boolean {
  return block.metadata.sendReasoning === true
}

function blockRole(block: RuntimeBlock): 'system' | 'user' | 'assistant' {
  return block.kind === 'injection' ? block.targetRole : block.kind as 'system' | 'user' | 'assistant'
}

function roleFromExtension(value: unknown): ChatBlockTargetRole {
  if (value === 'user' || value === 1 || value === '1') return 'user'
  if (value === 'assistant' || value === 2 || value === '2') return 'assistant'
  return 'system'
}

function characterData(character: CharacterEntry | null): JsonRecord {
  return asRecord(character?.stData?.data)
}

function characterName(character: CharacterEntry | null): string {
  return asString(characterData(character).name, DEFAULT_ASSISTANT_NAME).trim() || DEFAULT_ASSISTANT_NAME
}

function replaceMacros(value: string, character: CharacterEntry | null): string {
  const char = characterName(character)
  return value
    .replace(/\{\{char\}\}/gi, char)
    .replace(/\{\{user\}\}/gi, DEFAULT_USER_NAME)
    .replace(/\{\{charIfNotGroup\}\}/gi, char)
}

function parseRegexFromString(input: string): RegExp | null {
  if (!input.startsWith('/')) return null
  const lastSlash = input.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const rawPattern = input.slice(1, lastSlash)
  const flags = input.slice(lastSlash + 1)
  if (!/^[gimsuy]*$/.test(flags)) return null
  try {
    return new RegExp(rawPattern, flags)
  } catch {
    return null
  }
}

function transformForCase(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase()
}

function matchKey(haystack: string, needle: string, options: { caseSensitive: boolean; matchWholeWords: boolean }): boolean {
  const regex = parseRegexFromString(needle)
  if (regex) {
    regex.lastIndex = 0
    return regex.test(haystack)
  }

  const text = transformForCase(haystack, options.caseSensitive)
  const key = transformForCase(needle, options.caseSensitive)
  if (!key) return false

  if (!options.matchWholeWords) return text.includes(key)
  const words = key.split(/\s+/)
  if (words.length > 1) return text.includes(key)
  return new RegExp(`(?:^|\\W)(${escapeRegex(key)})(?:$|\\W)`).test(text)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function deterministicRollPercent(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 10000 / 100
}

function entryExtensions(entry: WorldEntry): JsonRecord {
  return asRecord(entry.stData.extensions)
}

function entryPosition(entry: WorldEntry): number {
  const extensions = entryExtensions(entry)
  return asNumber(extensions.position, entry.stData.position === 'after_char' ? 1 : 0)
}

function entryDepth(entry: WorldEntry): number {
  return asNumber(entryExtensions(entry).depth, DEFAULT_DEPTH)
}

function entryOrder(entry: WorldEntry): number {
  return asNumber(entry.stData.insertion_order, 100)
}

function entryKeys(entry: WorldEntry): string[] {
  return Array.isArray(entry.stData.keys) ? entry.stData.keys : []
}

function entrySecondaryKeys(entry: WorldEntry): string[] {
  return Array.isArray(entry.stData.secondary_keys) ? entry.stData.secondary_keys : []
}

function loreBookName(loreBooks: LoreBook[], id: number): string {
  return loreBooks.find(book => book.id === id)?.name ?? `World Book #${id}`
}

function entryTitle(entry: WorldEntry): string {
  const comment = asString(entry.stData.comment).trim()
  return comment || `Entry #${entry.id}`
}

function activationScanText(
  scanMessages: string[],
  character: CharacterEntry | null,
  entry: WorldEntry
): string {
  const data = characterData(character)
  const extensions = entryExtensions(entry)
  const scanDepth = asNumber(extensions.scan_depth, DEFAULT_SCAN_DEPTH)
  const chunks = scanMessages.slice(0, Math.max(0, scanDepth))

  if (asBoolean(extensions.match_character_description)) chunks.push(asString(data.description))
  if (asBoolean(extensions.match_character_personality)) chunks.push(asString(data.personality))
  if (asBoolean(extensions.match_scenario)) chunks.push(asString(data.scenario))
  if (asBoolean(extensions.match_creator_notes)) chunks.push(asString(data.creator_notes))

  const depthPrompt = asRecord(asRecord(data.extensions).depth_prompt)
  if (asBoolean(extensions.match_character_depth_prompt)) chunks.push(asString(depthPrompt.prompt))

  return chunks.filter(Boolean).join('\n')
}

function matchingKeys(scanText: string, keys: string[], character: CharacterEntry | null, caseSensitive: boolean, matchWholeWords: boolean): string[] {
  return keys
    .map(key => replaceMacros(key, character).trim())
    .filter(Boolean)
    .filter(key => matchKey(scanText, key, { caseSensitive, matchWholeWords }))
}

function secondaryKeysMatch(scanText: string, entry: WorldEntry, character: CharacterEntry | null, caseSensitive: boolean, matchWholeWords: boolean): { matched: boolean; reason: string } {
  const secondaryKeys = entrySecondaryKeys(entry).map(key => replaceMacros(key, character).trim()).filter(Boolean)
  if (!entry.stData.selective || secondaryKeys.length === 0) return { matched: true, reason: '' }

  const logic = asNumber(entryExtensions(entry).selectiveLogic, 0)
  const matches = secondaryKeys.map(key => matchKey(scanText, key, { caseSensitive, matchWholeWords }))
  const matchedKeys = secondaryKeys.filter((_, index) => matches[index])
  const missingKeys = secondaryKeys.filter((_, index) => !matches[index])
  const hasAny = matches.some(Boolean)
  const hasAll = matches.every(Boolean)

  if (logic === 1) {
    return {
      matched: !hasAll,
      reason: !hasAll ? `次关键词 NOT ALL 未全部命中：${missingKeys.join(', ')}` : ''
    }
  }
  if (logic === 2) {
    return {
      matched: !hasAny,
      reason: !hasAny ? '次关键词 NOT ANY 全部未命中' : ''
    }
  }
  if (logic === 3) {
    return {
      matched: hasAll,
      reason: hasAll ? `次关键词 AND ALL 全部命中：${matchedKeys.join(', ')}` : ''
    }
  }
  return {
    matched: hasAny,
    reason: hasAny ? `次关键词 AND ANY 命中：${matchedKeys.join(', ')}` : ''
  }
}

function activateWorldEntries(entries: WorldEntry[], scanMessages: string[], character: CharacterEntry | null): ActivationEntry[] {
  const latestScanText = scanMessages.join('\n')
  const activated: ActivationEntry[] = []

  for (const entry of [...entries].sort((a, b) => entryOrder(b) - entryOrder(a) || a.id - b.id)) {
    if (!entry.stData.enabled) continue

    const extensions = entryExtensions(entry)
    const caseSensitive = entry.stData.case_sensitive ?? asBoolean(extensions.case_sensitive, false)
    const matchWholeWords = asBoolean(extensions.match_whole_words, false)
    const scanDepth = asNumber(extensions.scan_depth, DEFAULT_SCAN_DEPTH)
    const scanText = activationScanText(scanMessages, character, entry)
    const primaryKeys = entryKeys(entry).map(key => replaceMacros(key, character).trim()).filter(Boolean)
    const primaryMatches = matchingKeys(scanText, primaryKeys, character, caseSensitive, matchWholeWords)
    const primaryMatched = Boolean(entry.stData.constant) || primaryMatches.length > 0

    if (!primaryMatched) continue
    const secondaryMatch = secondaryKeysMatch(scanText, entry, character, caseSensitive, matchWholeWords)
    if (!secondaryMatch.matched) continue

    const useProbability = asBoolean(extensions.useProbability, true)
    const probability = asNumber(extensions.probability, 100)
    const reason = [
      entry.stData.constant ? '常驻条目' : `主关键词命中：${primaryMatches.join(', ')}`,
      secondaryMatch.reason,
      useProbability && probability < 100 ? `概率 ${probability}% 通过` : '',
      `扫描深度 ${scanDepth}`
    ].filter(Boolean).join('；')

    if (useProbability && probability < 100) {
      const roll = deterministicRollPercent(`${entry.id}:${entry.updatedAt}:${latestScanText}`)
      if (roll >= probability) continue
    }

    activated.push({
      entry,
      content: replaceMacros(entry.stData.content, character),
      position: entryPosition(entry),
      order: entryOrder(entry),
      depth: entryDepth(entry),
      role: roleFromExtension(extensions.role),
      reason
    })
  }

  return activated
}

function pushMessage(messages: ChatGenerationPreviewMessage[], role: 'system' | 'user' | 'assistant', content: string | ChatContentPart[]) {
  if (Array.isArray(content)) {
    if (content.length > 0) messages.push({ role, content })
    return
  }
  const text = content.trim()
  if (text) messages.push({ role, content: text })
}

function realBlockMessage(block: RuntimeBlock): ChatGenerationPreviewMessage | null {
  if (!block.enabled) return null
  const text = blockText(block).trim()
  const reasoning = blockReasoningText(block).trim()
  const role = blockRole(block)

  if (role === 'assistant' && shouldSendReasoning(block) && reasoning.length > 0) {
    const content: ChatContentPart[] = [{ type: 'reasoning', text: reasoning }]
    if (text.length > 0) content.push({ type: 'text', text })
    return { role, content }
  }

  return text.length > 0 ? { role, content: text } : null
}

function realBlockScanLine(block: RuntimeBlock, character: CharacterEntry | null): string {
  const text = blockText(block).trim()
  if (!text) return ''
  const role = blockRole(block)
  const name = role === 'assistant' ? characterName(character) : role === 'user' ? DEFAULT_USER_NAME : 'System'
  return `${name}: ${text}`
}

function activeLoreBookIds(config: ChatRuntimeConfig, character: CharacterEntry | null): number[] {
  const characterLoreBookId = character?.forgeData.loreBookId
  const ids = [
    ...(characterLoreBookId === null || characterLoreBookId === undefined ? [] : [characterLoreBookId]),
    ...config.loreBookIds
  ]
  return [...new Set(ids)]
}

function entriesForLoreBooks(entries: WorldEntry[], loreBookIds: number[]): WorldEntry[] {
  const order = new Map(loreBookIds.map((id, index) => [id, index]))
  return entries
    .filter(entry => order.has(entry.loreBookId))
    .sort((a, b) => {
      const bookDelta = (order.get(a.loreBookId) ?? 0) - (order.get(b.loreBookId) ?? 0)
      if (bookDelta !== 0) return bookDelta
      const orderDelta = entryOrder(b) - entryOrder(a)
      return orderDelta || a.id - b.id
    })
}

function groupedContent(entries: ActivationEntry[], positions: number[]): string {
  return orderedActivationEntries(entries, positions).map(entry => entry.content.trim()).filter(Boolean).join('\n')
}

function orderedActivationEntries(entries: ActivationEntry[], positions: number[]): ActivationEntry[] {
  const values: ActivationEntry[] = []
  for (const entry of entries.filter(item => positions.includes(item.position)).sort((a, b) => b.order - a.order || a.entry.id - b.entry.id)) {
    if (entry.content.trim()) values.unshift(entry)
  }
  return values
}

function characterPromptContent(character: CharacterEntry | null): string {
  if (!character) return ''
  const data = characterData(character)
  const fallback = 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.'
  return replaceMacros(asString(data.system_prompt, fallback) || fallback, character)
}

function characterDefinitionContent(character: CharacterEntry | null, worldInfoBefore: string, worldInfoAfter: string, examples: string): string {
  if (!character) return [worldInfoBefore, worldInfoAfter].filter(Boolean).join('\n\n')
  const data = characterData(character)
  return [
    worldInfoBefore,
    asString(data.description),
    asString(data.personality),
    asString(data.scenario),
    worldInfoAfter,
    examples ? `Example dialogue:\n${examples}` : ''
  ].map(item => replaceMacros(item.trim(), character)).filter(Boolean).join('\n\n')
}

function characterInjectionDetail(character: CharacterEntry | null, title: string, reason: string, content: string): InjectionDetail | null {
  const text = replaceMacros(content.trim(), character)
  if (!text) return null
  return {
    title,
    source: 'character',
    sourceName: character ? `角色卡：${characterName(character)}` : '角色卡',
    reason,
    content: text
  }
}

function worldEntryInjectionDetail(entry: ActivationEntry, loreBooks: LoreBook[], reasonPrefix = '世界书条目激活'): InjectionDetail {
  return {
    title: entryTitle(entry.entry),
    source: 'worldInfo',
    sourceName: `世界书：${loreBookName(loreBooks, entry.entry.loreBookId)}`,
    reason: `${reasonPrefix}；${entry.reason}`,
    content: entry.content,
    entryId: entry.entry.id,
    loreBookId: entry.entry.loreBookId
  }
}

function nonNullDetails(details: Array<InjectionDetail | null>): InjectionDetail[] {
  return details.filter((detail): detail is InjectionDetail => detail !== null)
}

function virtualBlock(id: number, chat: PromptBuildInput['chat'], role: ChatBlockTargetRole, title: string, summary: string, content: string, metadata: InjectionPreviewBlock['metadata']): InjectionPreviewBlock {
  return {
    id,
    chatId: chat.id,
    kind: 'injection',
    targetRole: role,
    enabled: true,
    status: 'idle',
    orderIndex: id,
    title,
    summary,
    contentParts: [{ type: 'text', text: content }],
    metadata,
    llmInstanceSnapshot: null,
    requestBlockIds: [],
    errorText: '',
    createdAt: chat.updatedAt,
    updatedAt: chat.updatedAt
  }
}

export function buildSillyTavernLikePrompt(input: PromptBuildInput): PromptBuildResult {
  const character = input.characters.find(item => item.id === input.chat.runtimeConfig.characterId) ?? null
  const loreBookIds = activeLoreBookIds(input.chat.runtimeConfig, character)
  const loreEntries = entriesForLoreBooks(input.worldEntries, loreBookIds)
  const enabledRealBlocks = input.blocks.filter(block => block.enabled)
  const scanMessages = enabledRealBlocks.map(block => realBlockScanLine(block, character)).filter(Boolean).reverse()
  const activated = activateWorldEntries(loreEntries, scanMessages, character)

  const worldInfoBeforeEntries = orderedActivationEntries(activated, [0])
  const worldInfoAfterEntries = orderedActivationEntries(activated, [1])
  const exampleEntries = orderedActivationEntries(activated, [5, 6])
  const worldInfoBefore = groupedContent(activated, [0])
  const worldInfoAfter = groupedContent(activated, [1])
  const worldExamples = exampleEntries.map(entry => entry.content.trim()).filter(Boolean).join('\n')
  const characterExamples = replaceMacros(asString(characterData(character).mes_example), character)
  const examples = worldExamples || characterExamples
  const topActivated = [...worldInfoBeforeEntries, ...worldInfoAfterEntries, ...exampleEntries]
  const postHistory = replaceMacros(asString(characterData(character).post_history_instructions), character)
  const depthPrompt = asRecord(asRecord(characterData(character).extensions).depth_prompt)
  const characterDepthPrompt = replaceMacros(asString(depthPrompt.prompt), character)
  const characterDepth = asNumber(depthPrompt.depth, DEFAULT_DEPTH)
  const characterDepthRole = roleFromExtension(depthPrompt.role)

  const messages: ChatGenerationPreviewMessage[] = []
  const virtualBlocks: InjectionPreviewBlock[] = []
  let virtualId = -1

  const mainPrompt = characterPromptContent(character)
  const data = characterData(character)
  const definitionParts = [
    worldInfoBefore,
    replaceMacros(asString(data.description), character),
    replaceMacros(asString(data.personality), character),
    replaceMacros(asString(data.scenario), character),
    worldInfoAfter,
    examples ? `Example dialogue:\n${examples}` : ''
  ].map(item => item.trim()).filter(Boolean)
  const topDetails = nonNullDetails([
    characterInjectionDetail(character, '系统提示词', '角色卡 system_prompt', mainPrompt),
    ...worldInfoBeforeEntries.map(entry => worldEntryInjectionDetail(entry, input.loreBooks, '位置：角色定义前')),
    characterInjectionDetail(character, '角色描述', '角色卡 description', asString(data.description)),
    characterInjectionDetail(character, '角色性格', '角色卡 personality', asString(data.personality)),
    characterInjectionDetail(character, '场景', '角色卡 scenario', asString(data.scenario)),
    ...worldInfoAfterEntries.map(entry => worldEntryInjectionDetail(entry, input.loreBooks, '位置：角色定义后')),
    ...(exampleEntries.length > 0
      ? exampleEntries.map(entry => worldEntryInjectionDetail(entry, input.loreBooks, '位置：示例对话'))
      : [characterInjectionDetail(character, '示例对话', '角色卡 mes_example', examples ? `Example dialogue:\n${examples}` : '')])
  ])
  const topInjection = [mainPrompt, definitionParts.join('\n\n')].filter(Boolean).join('\n\n')
  if (topInjection.trim()) {
    pushMessage(messages, 'system', topInjection)
    virtualBlocks.push(virtualBlock(
      virtualId--,
      input.chat,
      'system',
      '注入内容',
      [
        character ? `角色卡：${characterName(character)}` : '',
        topActivated.length ? `世界书：${topActivated.length} 条` : ''
      ].filter(Boolean).join(' · ') || '角色/世界书注入',
      topInjection,
      {
        virtual: true,
        source: topActivated.length ? 'worldInfo' : 'character',
        activatedEntryIds: topActivated.map(item => item.entry.id),
        loreBookIds,
        injectionDetails: topDetails,
        displaySlot: 'start'
      }
    ))
  }

  const realMessageItems = enabledRealBlocks
    .map(block => ({ block, message: realBlockMessage(block) }))
    .filter((item): item is { block: RuntimeBlock; message: ChatGenerationPreviewMessage } => item.message !== null)
  const realMessages = realMessageItems.map(item => item.message)
  const depthInjections = activated.filter(entry => entry.position === 4 && entry.content.trim())
  const depthByIndex = new Map<number, ActivationEntry[]>()

  const allDepthInjections = [...depthInjections]
  if (characterDepthPrompt.trim()) {
    allDepthInjections.push({
      entry: {
        id: -1,
        loreBookId: -1,
        createdAt: input.chat.createdAt,
        updatedAt: input.chat.updatedAt,
        stData: {
          keys: [],
          content: characterDepthPrompt,
          constant: true,
          selective: false,
          insertion_order: 100,
          enabled: true,
          extensions: {}
        },
        forgeData: {}
      },
      content: characterDepthPrompt,
      position: 4,
      order: 100,
      depth: characterDepth,
      role: characterDepthRole,
      reason: `角色卡 depth_prompt；Depth ${characterDepth}`
    })
  }

  for (const injection of allDepthInjections) {
    const insertIndex = Math.max(0, realMessages.length - injection.depth)
    const list = depthByIndex.get(insertIndex) ?? []
    list.push(injection)
    depthByIndex.set(insertIndex, list)
  }

  for (let index = 0; index <= realMessages.length; index++) {
    const injections = depthByIndex.get(index) ?? []
    for (const injection of injections.sort((a, b) => b.order - a.order || a.entry.id - b.entry.id)) {
      pushMessage(messages, injection.role, injection.content)
      const beforeBlockId = realMessageItems[index]?.block.id
      const afterBlockId = beforeBlockId === undefined
        ? realMessageItems[realMessageItems.length - 1]?.block.id
        : undefined
      virtualBlocks.push(virtualBlock(
        virtualId--,
        input.chat,
        injection.role,
        '注入内容',
        injection.entry.id < 0 ? '角色深度提示词' : `Depth ${injection.depth} · ${injection.role}`,
        injection.content,
        {
          virtual: true,
          source: injection.entry.id < 0 ? 'character' : 'worldInfo',
          activatedEntryIds: injection.entry.id < 0 ? [] : [injection.entry.id],
          loreBookIds: injection.entry.loreBookId < 0 ? [] : [injection.entry.loreBookId],
          injectionDetails: injection.entry.id < 0
            ? nonNullDetails([characterInjectionDetail(character, '角色深度提示词', injection.reason, injection.content)])
            : [worldEntryInjectionDetail(injection, input.loreBooks, `位置：Depth ${injection.depth}`)],
          displaySlot: beforeBlockId === undefined ? 'end' : undefined,
          displayBeforeBlockId: beforeBlockId,
          displayAfterBlockId: afterBlockId
        }
      ))
    }
    const realMessage = realMessages[index]
    if (realMessage) messages.push(realMessage)
  }

  if (postHistory.trim()) {
    pushMessage(messages, 'system', postHistory)
    virtualBlocks.push(virtualBlock(
      virtualId--,
      input.chat,
      'system',
      '注入内容',
      'Post-history instructions',
      postHistory,
      {
        virtual: true,
        source: 'character',
        activatedEntryIds: [],
        loreBookIds: [],
        injectionDetails: nonNullDetails([
          characterInjectionDetail(character, 'Post-history instructions', '角色卡 post_history_instructions', postHistory)
        ]),
        displaySlot: 'end',
        displayAfterBlockId: realMessageItems[realMessageItems.length - 1]?.block.id
      }
    ))
  }

  return {
    messages,
    virtualBlocks,
    requestBlockIds: enabledRealBlocks
      .filter(block => blockText(block).trim().length > 0 || (block.kind === 'assistant' && shouldSendReasoning(block) && blockReasoningText(block).trim().length > 0))
      .map(block => block.id),
    character,
    activeLoreBookIds: loreBookIds
  }
}
