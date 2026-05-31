import type {
  CharacterBookEntryData,
  ChatCreationDefaults,
  CharacterForgeData,
  ChatRuntimeConfig,
  JsonRecord,
  PromptTemplateProjectConfig,
  PromptTemplateSettings,
  ProjectConfig
} from '../../shared/types'
import { asBoolean, asRecord, asString } from '../../shared/value-utils'

export { asRecord }

export function defaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: 1,
    chatCreateDefaults: defaultChatCreationDefaults(),
    promptTemplate: defaultPromptTemplateConfig()
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export function toString(value: unknown, fallback = ''): string {
  return asString(value, fallback)
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
  return []
}

export function toNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
  return asBoolean(value, fallback)
}

export function normalizeCharacterForgeData(value: unknown): CharacterForgeData {
  const data = asRecord(value)
  const rawLoreBookId = data.loreBookId
  const loreBookId = Number(rawLoreBookId)
  return {
    loreBookId: rawLoreBookId === null || rawLoreBookId === undefined || !Number.isInteger(loreBookId)
      ? null
      : loreBookId,
    exportFileName: toString(data.exportFileName),
    characterBookName: toString(data.characterBookName)
  }
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

export function defaultChatCreationDefaults(): ChatCreationDefaults {
  return {
    characterId: null,
    loreBookIds: [],
    characterRegexScriptsEnabled: true
  }
}

export function defaultPromptTemplateSettings(): PromptTemplateSettings {
  return {
    enabled: true,
    generateEnabled: true,
    generateLoaderEnabled: true,
    renderEnabled: true,
    renderLoaderEnabled: true,
    rawMessageEvaluationEnabled: true,
    filterMessageEnabled: true,
    injectLoaderEnabled: true,
    invertEnabled: true,
    sandbox: true,
    withContextDisabled: false,
    debugEnabled: false,
    cacheEnabled: 0,
    cacheSize: 64
  }
}

function cacheMode(value: unknown): 0 | 1 | 2 {
  const number = toNumber(value, 0)
  return number === 1 || number === 2 ? number : 0
}

export function normalizePromptTemplateSettings(value: unknown): PromptTemplateSettings {
  const data = asRecord(value)
  const defaults = defaultPromptTemplateSettings()
  return {
    enabled: toBoolean(data.enabled, defaults.enabled),
    generateEnabled: toBoolean(data.generateEnabled, defaults.generateEnabled),
    generateLoaderEnabled: toBoolean(data.generateLoaderEnabled, defaults.generateLoaderEnabled),
    renderEnabled: toBoolean(data.renderEnabled, defaults.renderEnabled),
    renderLoaderEnabled: toBoolean(data.renderLoaderEnabled, defaults.renderLoaderEnabled),
    rawMessageEvaluationEnabled: toBoolean(data.rawMessageEvaluationEnabled, defaults.rawMessageEvaluationEnabled),
    filterMessageEnabled: toBoolean(data.filterMessageEnabled, defaults.filterMessageEnabled),
    injectLoaderEnabled: toBoolean(data.injectLoaderEnabled, defaults.injectLoaderEnabled),
    invertEnabled: toBoolean(data.invertEnabled, defaults.invertEnabled),
    sandbox: toBoolean(data.sandbox, defaults.sandbox),
    withContextDisabled: toBoolean(data.withContextDisabled, defaults.withContextDisabled),
    debugEnabled: toBoolean(data.debugEnabled, defaults.debugEnabled),
    cacheEnabled: cacheMode(data.cacheEnabled),
    cacheSize: Math.max(0, Math.trunc(toNumber(data.cacheSize, defaults.cacheSize)))
  }
}

export function defaultPromptTemplateConfig(): PromptTemplateProjectConfig {
  return {
    settings: defaultPromptTemplateSettings(),
    globalVariables: {}
  }
}

export function normalizePromptTemplateConfig(value: unknown): PromptTemplateProjectConfig {
  const data = asRecord(value)
  return {
    settings: normalizePromptTemplateSettings(data.settings ?? data),
    globalVariables: asRecord(data.globalVariables)
  }
}

export function normalizeChatCreationDefaults(value: unknown): ChatCreationDefaults {
  const data = asRecord(value)
  const loreBookIds = Array.isArray(data.loreBookIds)
    ? data.loreBookIds.map(item => Number(item)).filter(Number.isInteger)
    : []

  return {
    characterId: nullableInteger(data.characterId),
    loreBookIds: [...new Set(loreBookIds)],
    characterRegexScriptsEnabled: data.characterRegexScriptsEnabled !== false
  }
}

export function normalizeProjectConfig(value: unknown): ProjectConfig {
  const data = asRecord(value)
  return {
    schemaVersion: toNumber(data.schemaVersion, 1),
    chatCreateDefaults: normalizeChatCreationDefaults(data.chatCreateDefaults),
    promptTemplate: normalizePromptTemplateConfig(data.promptTemplate)
  }
}

export function normalizeChatRuntimeConfig(value: unknown): ChatRuntimeConfig {
  const data = asRecord(value)
  const loreBookIds = Array.isArray(data.loreBookIds)
    ? data.loreBookIds.map(item => Number(item)).filter(Number.isInteger)
    : []

  return {
    characterId: nullableInteger(data.characterId),
    llmInstanceId: nullableInteger(data.llmInstanceId),
    loreBookIds: [...new Set(loreBookIds)],
    characterRegexScriptsEnabled: data.characterRegexScriptsEnabled !== false,
    promptTemplateVariables: asRecord(data.promptTemplateVariables)
  }
}

export function normalizeCharacterCard(value: unknown, now = new Date().toISOString()): JsonRecord {
  const card = asRecord(cloneJson(value || {}))
  const data = asRecord(card.data)
  const extensions = asRecord(data.extensions)
  const depthPrompt = asRecord(extensions.depth_prompt)

  data.name = toString(data.name ?? card.name, 'Untitled Character')
  data.description = toString(data.description ?? card.description)
  data.personality = toString(data.personality ?? card.personality)
  data.scenario = toString(data.scenario ?? card.scenario)
  data.first_mes = toString(data.first_mes ?? card.first_mes)
  data.mes_example = toString(data.mes_example ?? card.mes_example)
  data.creator_notes = toString(data.creator_notes ?? card.creatorcomment)
  data.system_prompt = toString(data.system_prompt)
  data.post_history_instructions = toString(data.post_history_instructions)
  data.alternate_greetings = toStringArray(data.alternate_greetings)
  data.tags = toStringArray(data.tags ?? card.tags)
  data.creator = toString(data.creator ?? card.creator)
  data.character_version = toString(data.character_version)

  extensions.talkativeness = toNumber(extensions.talkativeness ?? card.talkativeness, 0.5)
  extensions.fav = toBoolean(extensions.fav ?? card.fav, false)
  extensions.world = toString(extensions.world)
  extensions.depth_prompt = {
    prompt: toString(depthPrompt.prompt),
    depth: toNumber(depthPrompt.depth, 4),
    role: ['system', 'user', 'assistant'].includes(String(depthPrompt.role))
      ? String(depthPrompt.role)
      : 'system'
  }
  data.extensions = extensions
  delete data.character_book

  card.spec = 'chara_card_v2'
  card.spec_version = '2.0'
  card.data = data
  card.name = data.name
  card.description = data.description
  card.personality = data.personality
  card.scenario = data.scenario
  card.first_mes = data.first_mes
  card.mes_example = data.mes_example
  card.creatorcomment = data.creator_notes
  card.avatar = toString(card.avatar, 'none') || 'none'
  card.talkativeness = extensions.talkativeness
  card.fav = extensions.fav
  card.tags = data.tags
  card.create_date = toString(card.create_date, now)

  return card
}

export function defaultCharacterCard(): JsonRecord {
  return normalizeCharacterCard({})
}

export function normalizeWorldEntryData(value: unknown): CharacterBookEntryData {
  const data = asRecord(cloneJson(value || {}))
  const extensions = asRecord(data.extensions)
  const numericPosition = toNumber(extensions.position ?? data.position, data.position === 'after_char' ? 1 : 0)
  const position = data.position === 'after_char' || numericPosition === 1 ? 'after_char' : 'before_char'
  const id = toNumber(data.id, Number.NaN)

  extensions.position = numericPosition
  extensions.depth = toNumber(extensions.depth, 4)
  extensions.role = extensions.role === null ? null : toNumber(extensions.role, 0)
  extensions.probability = toNumber(extensions.probability, 100)
  extensions.useProbability = toBoolean(extensions.useProbability, true)
  extensions.display_index = toNumber(extensions.display_index, 0)

  const normalized: CharacterBookEntryData = {
    keys: toStringArray(data.keys ?? data.key),
    secondary_keys: toStringArray(data.secondary_keys ?? data.keysecondary),
    comment: toString(data.comment),
    content: toString(data.content),
    constant: toBoolean(data.constant, false),
    selective: toBoolean(data.selective, false),
    insertion_order: toNumber(data.insertion_order ?? data.order, 100),
    enabled: toBoolean(data.enabled ?? (data.disable === undefined ? true : !data.disable), true),
    position,
    case_sensitive: data.case_sensitive === undefined ? undefined : toBoolean(data.case_sensitive, false),
    extensions
  }
  if (Number.isInteger(id)) normalized.id = id
  return normalized
}

export function defaultWorldEntry(): CharacterBookEntryData {
  return normalizeWorldEntryData({})
}
