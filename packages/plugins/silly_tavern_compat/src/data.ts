import type { ChatSession, JsonRecord, PluginStorageApi } from '@huaian/plugin-api'
import { asRecord, asString, toStructuredCloneable } from '@huaian/plugin-api'
import type { CharacterEntry, LoreBook, PluginFileRecord, WorldEntry } from './types'

const DEFAULT_DEPTH = 4
const DEFAULT_ORDER = 100
const DEFAULT_PROBABILITY = 100
const DEFAULT_ROLE = 0
const WORLD_INFO_POSITION_BEFORE = 0
const WORLD_INFO_POSITION_AFTER = 1

export interface SillyTavernRuntimeConfig {
  characterId: number | null
  loreBookIds: number[]
  characterRegexScriptsEnabled: boolean
  promptTemplateVariables: JsonRecord
}

export function characterCardData(card: JsonRecord): JsonRecord {
  const v2Data = asRecord(card.data)
  return Object.keys(v2Data).length ? v2Data : card
}

export function characterBookFromCard(card: JsonRecord): JsonRecord | null {
  const v2Book = asRecord(asRecord(card.data).character_book)
  if (Array.isArray(v2Book.entries)) return v2Book
  const v1Book = asRecord(card.character_book)
  if (Array.isArray(v1Book.entries)) return v1Book
  return null
}

function worldBookEntries(book: JsonRecord): unknown[] {
  if (Array.isArray(book.entries)) return book.entries
  return Object.values(asRecord(book.entries))
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function stringArray(...values: unknown[]): string[] {
  const value = values.find(Array.isArray)
  return Array.isArray(value) ? value.map(String) : []
}

function firstPresent<T>(fallback: T, ...values: unknown[]): unknown {
  const value = values.find(item => item !== undefined && item !== null && item !== '')
  return value ?? fallback
}

function numberValue(fallback: number, ...values: unknown[]): number {
  const value = firstPresent(fallback, ...values)
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function optionalNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function optionalBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return null
}

function booleanValue(fallback: boolean, ...values: unknown[]): boolean {
  return optionalBoolean(...values) ?? fallback
}

function delayUntilRecursionValue(...values: unknown[]): boolean | number {
  const bool = optionalBoolean(...values)
  if (bool !== null) return bool
  return optionalNumber(...values) ?? false
}

function numericPosition(value: unknown): number | null {
  if (value === 'before_char') return WORLD_INFO_POSITION_BEFORE
  if (value === 'after_char') return WORLD_INFO_POSITION_AFTER
  return optionalNumber(value)
}

function entryPosition(record: JsonRecord, extensions: JsonRecord): number {
  if (typeof record.position === 'number' || (typeof record.position === 'string' && /^-?\d+(\.\d+)?$/.test(record.position))) {
    return numericPosition(record.position) ?? WORLD_INFO_POSITION_BEFORE
  }
  return numericPosition(extensions.position)
    ?? numericPosition(record.position)
    ?? WORLD_INFO_POSITION_BEFORE
}

function characterBookPosition(position: number): 'before_char' | 'after_char' {
  return position === WORLD_INFO_POSITION_BEFORE ? 'before_char' : 'after_char'
}

function isSillyTavernWorldInfoEntry(record: JsonRecord): boolean {
  return hasOwn(record, 'key') ||
    hasOwn(record, 'keysecondary') ||
    hasOwn(record, 'order') ||
    hasOwn(record, 'disable') ||
    typeof record.position === 'number'
}

function normalizedEntryExtensions(record: JsonRecord, extensions: JsonRecord, position: number): JsonRecord {
  const caseSensitive = optionalBoolean(record.caseSensitive, record.case_sensitive, extensions.case_sensitive)
  const matchWholeWords = optionalBoolean(record.matchWholeWords, extensions.match_whole_words)
  const scanDepth = optionalNumber(record.scanDepth, extensions.scan_depth)
  const triggers = Array.isArray(record.triggers)
    ? record.triggers.map(String)
    : Array.isArray(extensions.triggers)
      ? extensions.triggers.map(String)
      : []
  return {
    ...extensions,
    position,
    exclude_recursion: booleanValue(false, record.excludeRecursion, extensions.exclude_recursion),
    prevent_recursion: booleanValue(false, record.preventRecursion, extensions.prevent_recursion),
    delay_until_recursion: delayUntilRecursionValue(record.delayUntilRecursion, extensions.delay_until_recursion),
    display_index: optionalNumber(record.displayIndex, extensions.display_index),
    probability: clampPercent(numberValue(DEFAULT_PROBABILITY, record.probability, extensions.probability)),
    useProbability: booleanValue(true, record.useProbability, extensions.useProbability),
    depth: Math.max(0, numberValue(DEFAULT_DEPTH, record.depth, extensions.depth)),
    selectiveLogic: Math.max(0, Math.min(3, Math.trunc(numberValue(0, record.selectiveLogic, extensions.selectiveLogic)))),
    outlet_name: asString(firstPresent('', record.outletName, extensions.outlet_name)),
    group: asString(firstPresent('', record.group, extensions.group)),
    group_override: booleanValue(false, record.groupOverride, extensions.group_override),
    group_weight: optionalNumber(record.groupWeight, extensions.group_weight),
    scan_depth: scanDepth,
    match_whole_words: matchWholeWords,
    use_group_scoring: optionalBoolean(record.useGroupScoring, extensions.use_group_scoring),
    case_sensitive: caseSensitive,
    automation_id: asString(firstPresent('', record.automationId, extensions.automation_id)),
    role: firstPresent(DEFAULT_ROLE, record.role, extensions.role),
    vectorized: booleanValue(false, record.vectorized, extensions.vectorized),
    sticky: optionalNumber(record.sticky, extensions.sticky),
    cooldown: optionalNumber(record.cooldown, extensions.cooldown),
    delay: optionalNumber(record.delay, extensions.delay),
    match_persona_description: booleanValue(false, record.matchPersonaDescription, extensions.match_persona_description),
    match_character_description: booleanValue(false, record.matchCharacterDescription, extensions.match_character_description),
    match_character_personality: booleanValue(false, record.matchCharacterPersonality, extensions.match_character_personality),
    match_character_depth_prompt: booleanValue(false, record.matchCharacterDepthPrompt, extensions.match_character_depth_prompt),
    match_scenario: booleanValue(false, record.matchScenario, extensions.match_scenario),
    match_creator_notes: booleanValue(false, record.matchCreatorNotes, extensions.match_creator_notes),
    triggers,
    ignore_budget: booleanValue(false, record.ignoreBudget, extensions.ignore_budget),
    character_filter: asRecord(record.characterFilter ?? extensions.character_filter)
  }
}

export function normalizeCharacter(record: PluginFileRecord, id: number): CharacterEntry {
  const data = { ...characterCardData(record.data) }
  data.name = asString(data.name ?? record.data.name, record.fileName.replace(/\.json$/i, ''))
  data.extensions = {
    ...asRecord(data.extensions),
    depth_prompt: {
      prompt: asString(asRecord(asRecord(data.extensions).depth_prompt).prompt),
      depth: numberValue(DEFAULT_DEPTH, asRecord(asRecord(data.extensions).depth_prompt).depth),
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

export function normalizeWorldEntry(value: unknown, id: number, loreBookId: number): WorldEntry {
  const record = asRecord(value)
  const extensions = asRecord(record.extensions)
  const position = entryPosition(record, extensions)
  const normalizedExtensions = normalizedEntryExtensions(record, extensions, position)
  const isWorldInfoEntry = isSillyTavernWorldInfoEntry(record)
  const caseSensitive = optionalBoolean(record.case_sensitive, record.caseSensitive, normalizedExtensions.case_sensitive)
  return {
    id,
    loreBookId,
    createdAt: '',
    updatedAt: '',
    stData: {
      id,
      keys: stringArray(record.keys, record.key),
      secondary_keys: stringArray(record.secondary_keys, record.keysecondary),
      comment: asString(record.comment),
      content: asString(record.content),
      constant: booleanValue(false, record.constant),
      selective: booleanValue(isWorldInfoEntry, record.selective),
      insertion_order: numberValue(DEFAULT_ORDER, record.insertion_order, record.order),
      enabled: record.enabled !== false && record.disable !== true,
      position: characterBookPosition(position),
      case_sensitive: caseSensitive ?? undefined,
      extensions: normalizedExtensions
    },
    forgeData: {}
  }
}

export async function loadJsonRecords(storage: PluginStorageApi, directory: string): Promise<PluginFileRecord[]> {
  const files = await storage.list(directory)
  const jsonFiles = files.filter(file => !file.isDirectory && file.name.endsWith('.json'))
  const records = await Promise.all(jsonFiles.map(async file => {
    try {
      return {
        fileName: file.name,
        data: asRecord(JSON.parse(await storage.readText(file.path)))
      }
    } catch {
      return null
    }
  }))
  return records.filter((record): record is PluginFileRecord => record !== null)
}

export async function loadSillyTavernCompatData(storage: PluginStorageApi, chat: ChatSession, configValue: JsonRecord) {
  const [characterRecords, worldBookRecords] = await Promise.all([
    loadJsonRecords(storage, 'characters'),
    loadJsonRecords(storage, 'worldbooks')
  ])
  const config = asRecord(configValue)
  const characterFile = asString(config.characterFile)
  const worldBookFiles = Array.isArray(config.worldBookFiles) ? config.worldBookFiles.map(String) : []
  const characters = characterRecords.map((record, index) => normalizeCharacter(record, index + 1))
  const selectedCharacterIndex = characterRecords.findIndex(record => record.fileName === characterFile)
  const characterId = selectedCharacterIndex >= 0 ? selectedCharacterIndex + 1 : characters[0]?.id ?? null
  const selectedCharacterRecord = characterId === null ? null : characterRecords[characterId - 1] ?? null
  const embeddedBook = selectedCharacterRecord ? characterBookFromCard(selectedCharacterRecord.data) : null
  const embeddedBookId = embeddedBook ? 1 : null
  const externalBookIdOffset = embeddedBook ? 2 : 1
  if (embeddedBookId !== null && characterId !== null && characters[characterId - 1]) {
    const selectedCharacter = characters[characterId - 1]
    characters[characterId - 1] = {
      ...selectedCharacter,
      forgeData: {
        ...selectedCharacter.forgeData,
        loreBookId: embeddedBookId,
        characterBookName: asString(embeddedBook.name, `${asString(characterCardData(selectedCharacterRecord?.data ?? {}).name, '角色卡')} 内置世界书`)
      }
    }
  }

  const embeddedLoreBooks: LoreBook[] = embeddedBook && embeddedBookId !== null ? [{
    id: embeddedBookId,
    name: asString(embeddedBook.name, characters[characterId === null ? -1 : characterId - 1]?.forgeData.characterBookName || '角色卡内置世界书'),
    createdAt: '',
    updatedAt: ''
  }] : []
  const externalLoreBooks: LoreBook[] = worldBookRecords.map((record, index) => ({
    id: index + externalBookIdOffset,
    name: asString(record.data.name, record.fileName.replace(/\.json$/i, '')),
    createdAt: '',
    updatedAt: ''
  }))
  const loreBooks = [...embeddedLoreBooks, ...externalLoreBooks]
  const embeddedWorldEntries = embeddedBook && embeddedBookId !== null
    ? worldBookEntries(embeddedBook).map((entry, index) => normalizeWorldEntry(entry, index + 1 + embeddedBookId * 10000, embeddedBookId))
    : []
  const externalWorldEntries = worldBookRecords.flatMap((record, bookIndex) => {
    const loreBookId = bookIndex + externalBookIdOffset
    const entries = worldBookEntries(record.data)
    return entries.map((entry, index) => normalizeWorldEntry(entry, index + 1 + loreBookId * 10000, loreBookId))
  })
  const worldEntries = [...embeddedWorldEntries, ...externalWorldEntries]
  const selectedWorldBookIds = worldBookFiles
    .map(fileName => {
      const index = worldBookRecords.findIndex(record => record.fileName === fileName)
      return index >= 0 ? index + externalBookIdOffset : 0
    })
    .filter(id => id > 0)
  const runtimeConfig: SillyTavernRuntimeConfig = {
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

export function entryTitle(entry: WorldEntry): string {
  return entry.stData.comment?.trim() || entry.stData.keys.join(', ') || `Entry #${entry.id}`
}

export function roleToNumber(value: unknown): number | null {
  if (value === 'system') return 0
  if (value === 'user') return 1
  if (value === 'assistant') return 2
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(2, Math.trunc(number))) : null
}

export function applyToolInput(entry: JsonRecord, input: JsonRecord): JsonRecord {
  const next = toStructuredCloneable(entry) ?? {}
  const extensions = asRecord(next.extensions)
  if (input.title !== undefined) next.comment = String(input.title)
  if (input.content !== undefined) next.content = String(input.content)
  if (input.enabled !== undefined) {
    next.enabled = input.enabled === true
    if (hasOwn(next, 'disable')) next.disable = input.enabled !== true
  }
  if (input.constant !== undefined) next.constant = input.constant === true
  if (input.selective !== undefined) next.selective = input.selective === true
  if (input.order !== undefined && input.order !== null) {
    next.insertion_order = Number(input.order)
    if (hasOwn(next, 'order')) next.order = Number(input.order)
  }
  if (Array.isArray(input.keys)) {
    const keys = input.keys.map(String).filter(Boolean)
    if (hasOwn(next, 'key')) next.key = keys
    next.keys = keys
  }
  if (Array.isArray(input.secondaryKeys)) {
    const keys = input.secondaryKeys.map(String).filter(Boolean)
    if (hasOwn(next, 'keysecondary')) next.keysecondary = keys
    next.secondary_keys = keys
  }
  if (input.position !== undefined && input.position !== null) {
    const position = Number(input.position)
    extensions.position = position
    next.position = hasOwn(next, 'key') || hasOwn(next, 'order')
      ? position
      : characterBookPosition(position)
  }
  const role = roleToNumber(input.role)
  if (role !== null) extensions.role = role
  if (input.depth !== undefined && input.depth !== null) extensions.depth = Math.max(0, Number(input.depth))
  if (input.probability !== undefined && input.probability !== null) extensions.probability = Math.max(0, Math.min(100, Number(input.probability)))
  if (input.selectiveLogic !== undefined && input.selectiveLogic !== null) extensions.selectiveLogic = Math.max(0, Math.min(3, Number(input.selectiveLogic)))
  next.extensions = extensions
  return next
}
