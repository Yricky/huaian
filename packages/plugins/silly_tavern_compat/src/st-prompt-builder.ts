import type {
  ChatBlock,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatGenerationPreviewMessage,
  JsonRecord
} from '@st-forge/plugin-api'
import { chatBlockTargetRole } from '@st-forge/plugin-api'
import { asBoolean, asNumber, asRecord, asString } from '@st-forge/plugin-api'
import type {
  CharacterEntry,
  InjectionDetail,
  InjectionPreviewBlock,
  InjectionPreviewMetadataInput,
  LoreBook,
  WorldEntry
} from './types'
import {
  REGEX_PLACEMENT,
  characterData,
  characterName,
  getRegexedPromptString,
  getRegexedString,
  replaceCharacterMacros,
  type RegexPlacement
} from './st-regex-scripts'

type RuntimeBlock = Pick<ChatBlock, 'id' | 'kind' | 'enabled' | 'orderIndex' | 'contentParts' | 'metadata'>

interface SillyTavernPromptRuntimeConfig {
  characterId?: number | null
  loreBookIds?: number[]
  characterRegexScriptsEnabled?: boolean
}

export interface PromptBuildInput {
  chat: { id: number; runtimeConfig: SillyTavernPromptRuntimeConfig; createdAt: string; updatedAt: string }
  characters: CharacterEntry[]
  loreBooks: LoreBook[]
  worldEntries: WorldEntry[]
  blocks: RuntimeBlock[]
}

export interface PromptBuildResult {
  messages: ChatGenerationPreviewMessage[]
  virtualBlocks: InjectionPreviewBlock[]
  character: CharacterEntry | null
  activeLoreBookIds: number[]
}

export interface WorldEntryActivationTestResult {
  id: number
  title: string
  reason: string
  content: string
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

function contextTextForPart(part: ChatContentPart): string {
  if (part.type === 'text') return part.text
  if (part.type !== 'tool_call' || part.sendAsContext !== true) return ''
  return [
    `[Tool call: ${part.toolName}]`,
    `input: ${JSON.stringify(part.input)}`,
    part.status === 'success' ? `output: ${JSON.stringify(part.output ?? null)}` : '',
    part.status === 'error' ? `error: ${part.error ?? ''}` : ''
  ].filter(Boolean).join('\n')
}

function blockText(block: RuntimeBlock): string {
  return block.contentParts.map(contextTextForPart).join('')
}

function reasoningPartSendsAsContext(part: ChatContentPart): boolean {
  return part.type === 'reasoning' && part.sendAsContext === true
}

function blockHasSentReasoning(block: RuntimeBlock): boolean {
  return block.contentParts.some(part => (
    part.type === 'reasoning' &&
    reasoningPartSendsAsContext(part) &&
    part.text.trim().length > 0
  ))
}

function blockRole(block: RuntimeBlock): 'system' | 'user' | 'assistant' {
  if (block.kind === 'tool_definition') return 'system'
  return chatBlockTargetRole(block)
}

function numberFromMetadata(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function stringFromMetadata(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toolDefinitionRecord(block: RuntimeBlock): JsonRecord {
  return asRecord(block.metadata.toolDefinition)
}

function toolDefinitionGroup(block: RuntimeBlock): string {
  return stringFromMetadata(toolDefinitionRecord(block).group)
}

function toolDefinitionLoreBookId(block: RuntimeBlock): number | null {
  return numberFromMetadata(toolDefinitionRecord(block).loreBookId)
}

function activeLoreBookToolDefinitionIds(blocks: RuntimeBlock[], loreBooks: LoreBook[]): Set<number> {
  const loreBookIds = new Set(loreBooks.map(book => book.id))
  const active = [...blocks]
    .filter(block => block.enabled && block.kind === 'tool_definition')
    .filter(block => toolDefinitionGroup(block) === 'lorebook_edit')
    .filter(block => {
      const loreBookId = toolDefinitionLoreBookId(block)
      return loreBookId !== null && loreBookIds.has(loreBookId)
    })
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
    .at(-1)
  return active ? new Set([active.id]) : new Set()
}

function shouldSendBlock(block: RuntimeBlock, activeToolDefinitionIds: Set<number>): boolean {
  if (!block.enabled) return false
  if (block.kind === 'tool_definition') return activeToolDefinitionIds.has(block.id)
  return true
}

function roleFromExtension(value: unknown): ChatBlockTargetRole {
  if (value === 'user' || value === 1 || value === '1') return 'user'
  if (value === 'assistant' || value === 2 || value === '2') return 'assistant'
  return 'system'
}

function replaceMacros(value: string, character: CharacterEntry | null): string {
  return replaceCharacterMacros(value, character, { userName: DEFAULT_USER_NAME })
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

function applyPromptRegex(
  value: string,
  placement: RegexPlacement,
  character: CharacterEntry | null,
  regexEnabled: boolean,
  depth?: number
): string {
  return getRegexedString(value, placement, {
    character,
    enabled: regexEnabled,
    isPrompt: true,
    depth
  })
}

function activateWorldEntries(
  entries: WorldEntry[],
  scanMessages: string[],
  character: CharacterEntry | null,
  regexEnabled = true
): ActivationEntry[] {
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

    const position = entryPosition(entry)
    const depth = entryDepth(entry)
    const content = applyPromptRegex(
      replaceMacros(entry.stData.content, character),
      REGEX_PLACEMENT.WORLD_INFO,
      character,
      regexEnabled,
      position === 4 ? depth : undefined
    )

    activated.push({
      entry,
      content,
      position,
      order: entryOrder(entry),
      depth,
      role: roleFromExtension(extensions.role),
      reason
    })
  }

  return activated
}

export function testWorldEntryActivations(
  entries: WorldEntry[],
  example: string,
  character: CharacterEntry | null = null
): WorldEntryActivationTestResult[] {
  const line = `${DEFAULT_USER_NAME}: ${example.trim()}`
  return activateWorldEntries(entries, [line], character).map(entry => ({
    id: entry.entry.id,
    title: entryTitle(entry.entry),
    reason: entry.reason,
    content: entry.content
  }))
}

function pushMessage(messages: ChatGenerationPreviewMessage[], role: 'system' | 'user' | 'assistant', content: string | ChatContentPart[], blockId?: number) {
  const metadata = blockId === undefined ? {} : { blockId }
  if (Array.isArray(content)) {
    if (content.length > 0) messages.push({ role, content, ...metadata })
    return
  }
  const text = content.trim()
  if (text) messages.push({ role, content: text, ...metadata })
}

function regexPlacementForBlock(block: RuntimeBlock): RegexPlacement | null {
  const role = blockRole(block)
  if (role === 'user') return REGEX_PLACEMENT.USER_INPUT
  if (role === 'assistant') return REGEX_PLACEMENT.AI_OUTPUT
  return null
}

function regexPromptText(
  value: string,
  placement: RegexPlacement | null,
  character: CharacterEntry | null,
  regexEnabled: boolean,
  depth: number
): string {
  return placement === null
    ? value
    : getRegexedPromptString(value, placement, {
      character,
      enabled: regexEnabled,
      depth
    })
}

function realBlockMessage(
  block: RuntimeBlock,
  activeToolDefinitionIds: Set<number>,
  character: CharacterEntry | null,
  regexEnabled: boolean,
  depth: number
): ChatGenerationPreviewMessage | null {
  if (!shouldSendBlock(block, activeToolDefinitionIds)) return null
  const role = blockRole(block)
  const placement = regexPlacementForBlock(block)
  const text = regexPromptText(blockText(block), placement, character, regexEnabled, depth).trim()

  if (role === 'assistant' && blockHasSentReasoning(block)) {
    const content: ChatContentPart[] = []
    for (const part of block.contentParts) {
      if (part.type === 'reasoning' && reasoningPartSendsAsContext(part) && part.text.trim().length > 0) {
        const reasoningText = getRegexedPromptString(part.text, REGEX_PLACEMENT.REASONING, {
          character,
          enabled: regexEnabled,
          depth
        })
        if (reasoningText.trim().length > 0) {
          content.push({ type: 'reasoning', text: reasoningText })
        }
      }
      const partText = contextTextForPart(part)
      if (partText.trim().length > 0) {
        const regexedPartText = regexPromptText(partText, placement, character, regexEnabled, depth)
        if (regexedPartText.trim().length > 0) {
          content.push({ type: 'text', text: regexedPartText })
        }
      }
    }
    return content.length > 0 ? { role, content, blockId: block.id } : null
  }

  return text.length > 0 ? { role, content: text, blockId: block.id } : null
}

function realBlockScanLine(block: RuntimeBlock, character: CharacterEntry | null): string {
  if (block.kind === 'tool_definition') return ''
  const text = blockText(block).trim()
  if (!text) return ''
  const role = blockRole(block)
  const name = role === 'assistant' ? characterName(character) : role === 'user' ? DEFAULT_USER_NAME : 'System'
  return `${name}: ${text}`
}

function activeLoreBookIds(config: SillyTavernPromptRuntimeConfig, character: CharacterEntry | null): number[] {
  const characterLoreBookId = character?.forgeData.loreBookId
  const ids = [
    ...(characterLoreBookId === null || characterLoreBookId === undefined ? [] : [characterLoreBookId]),
    ...(config.loreBookIds ?? [])
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

function virtualBlock(
  id: number,
  chat: PromptBuildInput['chat'],
  role: ChatBlockTargetRole,
  content: string,
  metadata: InjectionPreviewMetadataInput
): InjectionPreviewBlock {
  return {
    id,
    chatId: chat.id,
    kind: 'injection',
    enabled: true,
    status: 'idle',
    orderIndex: id,
    contentParts: [{ type: 'text', text: content }],
    metadata: {
      ...metadata,
      targetRole: role
    },
    llmInstanceSnapshot: null,
    errorText: '',
    createdAt: chat.updatedAt,
    updatedAt: chat.updatedAt
  }
}

export function buildSillyTavernLikePrompt(input: PromptBuildInput): PromptBuildResult {
  const character = input.characters.find(item => item.id === input.chat.runtimeConfig.characterId) ?? null
  const regexEnabled = input.chat.runtimeConfig.characterRegexScriptsEnabled !== false
  const activeToolDefinitionIds = activeLoreBookToolDefinitionIds(input.blocks, input.loreBooks)
  const loreBookIds = activeLoreBookIds(input.chat.runtimeConfig, character)
  const loreEntries = entriesForLoreBooks(input.worldEntries, loreBookIds)
  const enabledRealBlocks = input.blocks.filter(block => shouldSendBlock(block, activeToolDefinitionIds))
  const scanMessages = enabledRealBlocks.map(block => realBlockScanLine(block, character)).filter(Boolean).reverse()
  const activated = activateWorldEntries(loreEntries, scanMessages, character, regexEnabled)

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
    const blockId = virtualId--
    pushMessage(messages, 'system', topInjection, blockId)
    virtualBlocks.push(virtualBlock(
      blockId,
      input.chat,
      'system',
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

  const regexDepthBlocks = enabledRealBlocks.filter(block => regexPlacementForBlock(block) !== null && blockText(block).trim().length > 0)
  const regexDepthByBlockId = new Map(regexDepthBlocks.map((block, index) => [block.id, regexDepthBlocks.length - index - 1]))
  const realMessageItems = enabledRealBlocks
    .map(block => ({
      block,
      message: realBlockMessage(
        block,
        activeToolDefinitionIds,
        character,
        regexEnabled,
        regexDepthByBlockId.get(block.id) ?? 0
      )
    }))
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
      const blockId = virtualId--
      pushMessage(messages, injection.role, injection.content, blockId)
      const beforeBlockId = realMessageItems[index]?.block.id
      const afterBlockId = beforeBlockId === undefined
        ? realMessageItems[realMessageItems.length - 1]?.block.id
        : undefined
      virtualBlocks.push(virtualBlock(
        blockId,
        input.chat,
        injection.role,
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
    const blockId = virtualId--
    pushMessage(messages, 'system', postHistory, blockId)
    virtualBlocks.push(virtualBlock(
      blockId,
      input.chat,
      'system',
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
    character,
    activeLoreBookIds: loreBookIds
  }
}
