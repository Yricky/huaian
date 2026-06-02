import type {
  ChatCreationDefaults,
  ChatRuntimeConfig,
  ChatToolDefinition,
  JsonRecord,
  JsonRecordValue,
  PluginProjectConfig,
  ProjectConfig
} from '../../shared/types'
import { asBoolean, asRecord, asString } from '../../shared/value-utils'

export { asRecord }

export function defaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: 1,
    chatCreateDefaults: defaultChatCreationDefaults(),
    debugMode: false,
    plugins: defaultPluginProjectConfig()
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export function toString(value: JsonRecordValue, fallback = ''): string {
  return asString(value, fallback)
}

export function toStringArray(value: JsonRecordValue): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
  return []
}

export function toNumber(value: JsonRecordValue, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toBoolean(value: JsonRecordValue, fallback: boolean): boolean {
  return asBoolean(value, fallback)
}

function nullableInteger(value: JsonRecordValue): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

export function defaultChatCreationDefaults(): ChatCreationDefaults {
  return {
    enabledPluginIds: [...defaultPluginProjectConfig().enabledPluginIds]
  }
}

export function defaultPluginProjectConfig(): PluginProjectConfig {
  return {
    enabledPluginIds: [
      'silly_tavern_compat',
      'st_prompt_template_compat'
    ]
  }
}

export function normalizePluginProjectConfig(value: JsonRecordValue): PluginProjectConfig {
  const data = asRecord(value)
  const enabledPluginIds = Array.isArray(data.enabledPluginIds)
    ? data.enabledPluginIds.map(item => String(item).trim()).filter(Boolean)
    : defaultPluginProjectConfig().enabledPluginIds
  return {
    enabledPluginIds: [...new Set(enabledPluginIds)]
  }
}

export function normalizeChatCreationDefaults(value: JsonRecordValue): ChatCreationDefaults {
  const data = asRecord(value)
  return {
    enabledPluginIds: Array.isArray(data.enabledPluginIds)
      ? [...new Set(data.enabledPluginIds.map(item => String(item).trim()).filter(Boolean))]
      : [...defaultPluginProjectConfig().enabledPluginIds]
  }
}

export function normalizeProjectConfig(value: JsonRecordValue): ProjectConfig {
  const data = asRecord(value)
  return {
    schemaVersion: toNumber(data.schemaVersion, 1),
    chatCreateDefaults: normalizeChatCreationDefaults(data.chatCreateDefaults),
    debugMode: toBoolean(data.debugMode, false),
    plugins: normalizePluginProjectConfig(data.plugins)
  }
}

export function normalizeChatRuntimeConfig(value: JsonRecordValue): ChatRuntimeConfig {
  const data = asRecord(value)
  return {
    llmInstanceId: nullableInteger(data.llmInstanceId),
    enabledPluginIds: Array.isArray(data.enabledPluginIds)
      ? [...new Set(data.enabledPluginIds.map(item => String(item).trim()).filter(Boolean))]
      : defaultPluginProjectConfig().enabledPluginIds,
    pluginData: asRecord(data.pluginData),
    toolDefinitions: normalizeChatToolDefinitions(data.toolDefinitions)
  }
}

export function normalizeChatToolDefinitions(value: JsonRecordValue): ChatToolDefinition[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const definitions: ChatToolDefinition[] = []
  for (const item of value) {
    const record = asRecord(item)
    const pluginId = asString(record.pluginId).trim()
    const toolCallName = asString(record.toolCallName).trim()
    if (!pluginId || !toolCallName) continue
    const key = `${pluginId}\u0000${toolCallName}`
    if (seen.has(key)) continue
    seen.add(key)
    definitions.push({
      pluginId,
      toolCallName,
      commonArgs: asRecord(record.commonArgs)
    })
  }
  return definitions
}
