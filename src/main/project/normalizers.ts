import type {
  ChatCreationDefaults,
  ChatRuntimeConfig,
  JsonRecord,
  PluginProjectConfig,
  ProjectConfig
} from '../../shared/types'
import { asBoolean, asRecord, asString } from '../../shared/value-utils'

export { asRecord }

export function defaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: 1,
    chatCreateDefaults: defaultChatCreationDefaults(),
    plugins: defaultPluginProjectConfig()
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

function nullableInteger(value: unknown): number | null {
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
      'character_card_tool_calls',
      'st_prompt_template_compat'
    ]
  }
}

export function normalizePluginProjectConfig(value: unknown): PluginProjectConfig {
  const data = asRecord(value)
  const enabledPluginIds = Array.isArray(data.enabledPluginIds)
    ? data.enabledPluginIds.map(item => String(item).trim()).filter(Boolean)
    : defaultPluginProjectConfig().enabledPluginIds
  return {
    enabledPluginIds: [...new Set(enabledPluginIds)]
  }
}

export function normalizeChatCreationDefaults(value: unknown): ChatCreationDefaults {
  const data = asRecord(value)
  return {
    enabledPluginIds: Array.isArray(data.enabledPluginIds)
      ? [...new Set(data.enabledPluginIds.map(item => String(item).trim()).filter(Boolean))]
      : [...defaultPluginProjectConfig().enabledPluginIds]
  }
}

export function normalizeProjectConfig(value: unknown): ProjectConfig {
  const data = asRecord(value)
  return {
    schemaVersion: toNumber(data.schemaVersion, 1),
    chatCreateDefaults: normalizeChatCreationDefaults(data.chatCreateDefaults),
    plugins: normalizePluginProjectConfig(data.plugins)
  }
}

export function normalizeChatRuntimeConfig(value: unknown): ChatRuntimeConfig {
  const data = asRecord(value)
  return {
    llmInstanceId: nullableInteger(data.llmInstanceId),
    enabledPluginIds: Array.isArray(data.enabledPluginIds)
      ? [...new Set(data.enabledPluginIds.map(item => String(item).trim()).filter(Boolean))]
      : defaultPluginProjectConfig().enabledPluginIds,
    pluginData: asRecord(data.pluginData)
  }
}
