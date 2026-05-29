import Database from 'better-sqlite3'
import type {
  ChatBlock,
  ChatBlockKind,
  ChatBlockStatus,
  ChatBlockTargetRole,
  ChatContentPart,
  ChatSession,
  CharacterEntry,
  JsonRecord,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  LlmProviderSnapshot,
  LlmProviderType,
  ProviderModelCacheItem,
  WorldBook,
  WorldEntry
} from '../../shared/types'
import {
  asRecord,
  normalizeCharacterCard,
  normalizeCharacterForgeData,
  normalizeWorldEntryData
} from './normalizers'

export function initDatabase(dbPath: string): any {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      st_data TEXT NOT NULL,
      forge_data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_book_id INTEGER NOT NULL REFERENCES world_books(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      st_data TEXT NOT NULL,
      forge_data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      config_json TEXT NOT NULL,
      models_cache_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider_id INTEGER,
      model_id TEXT NOT NULL,
      provider_snapshot_json TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      extra_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      llm_instance_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      target_role TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content_parts_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      llm_instance_snapshot_json TEXT,
      request_block_ids_json TEXT NOT NULL,
      error_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return db
}

function parseJsonColumn(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function parseJsonArray<T>(value: string): T[] {
  const parsed = parseJsonColumn(value)
  return Array.isArray(parsed) ? parsed as T[] : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asBoolean(value: unknown): boolean {
  return Boolean(value)
}

function normalizeProviderType(value: unknown): LlmProviderType {
  return (
    value === 'openai' ||
    value === 'openai-compatible' ||
    value === 'anthropic' ||
    value === 'google' ||
    value === 'ollama' ||
    value === 'custom'
  ) ? value : 'openai-compatible'
}

function normalizeProviderSnapshot(value: unknown): LlmProviderSnapshot {
  const record = asRecord(value)
  return {
    providerName: asString(record.providerName, ''),
    type: normalizeProviderType(record.type),
    config: asRecord(record.config)
  }
}

function normalizeParameters(value: unknown): LlmGenerationParameters {
  const record = asRecord(value)
  return {
    temperature: record.temperature === null || record.temperature === undefined ? null : Number(record.temperature),
    topP: record.topP === null || record.topP === undefined ? null : Number(record.topP),
    maxOutputTokens: record.maxOutputTokens === null || record.maxOutputTokens === undefined ? null : Number(record.maxOutputTokens),
    frequencyPenalty: record.frequencyPenalty === null || record.frequencyPenalty === undefined ? null : Number(record.frequencyPenalty),
    presencePenalty: record.presencePenalty === null || record.presencePenalty === undefined ? null : Number(record.presencePenalty),
    repetitionPenalty: record.repetitionPenalty === null || record.repetitionPenalty === undefined ? null : Number(record.repetitionPenalty),
    topK: record.topK === null || record.topK === undefined ? null : Number(record.topK),
    stopSequences: Array.isArray(record.stopSequences)
      ? record.stopSequences.filter((item): item is string => typeof item === 'string')
      : [],
    seed: record.seed === null || record.seed === undefined ? null : Number(record.seed),
    reasoningEffort: record.reasoningEffort === 'low' || record.reasoningEffort === 'medium' || record.reasoningEffort === 'high'
      ? record.reasoningEffort
      : '',
    responseFormat: record.responseFormat === 'text' || record.responseFormat === 'json'
      ? record.responseFormat
      : ''
  }
}

function normalizeContentParts(value: unknown): ChatContentPart[] {
  if (!Array.isArray(value)) return []
  return value
    .map(part => asRecord(part))
    .filter(part => part.type === 'text' || part.type === 'reasoning')
    .map(part => ({
      type: part.type as 'text' | 'reasoning',
      text: asString(part.text)
    }))
}

function normalizeBlockKind(value: unknown): ChatBlockKind {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'injection' ? value : 'user'
}

function normalizeTargetRole(value: unknown): ChatBlockTargetRole {
  return value === 'system' || value === 'user' || value === 'assistant' ? value : 'system'
}

function normalizeBlockStatus(value: unknown): ChatBlockStatus {
  return value === 'generating' || value === 'stopped' || value === 'error' ? value : 'idle'
}

export function rowToCharacter(row: any): CharacterEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stData: normalizeCharacterCard(parseJsonColumn(row.st_data), row.created_at),
    forgeData: normalizeCharacterForgeData(parseJsonColumn(row.forge_data))
  }
}

export function rowToWorldBook(row: any): WorldBook {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function rowToWorldEntry(row: any): WorldEntry {
  return {
    id: row.id,
    worldBookId: row.world_book_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stData: normalizeWorldEntryData(parseJsonColumn(row.st_data)),
    forgeData: asRecord(parseJsonColumn(row.forge_data))
  }
}

export function rowToLlmProvider(row: any): LlmProvider {
  return {
    id: row.id,
    name: row.name,
    type: normalizeProviderType(row.type),
    apiKey: row.api_key ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    config: asRecord(parseJsonColumn(row.config_json)),
    modelsCache: parseJsonArray<ProviderModelCacheItem>(row.models_cache_json)
  }
}

export function rowToLlmInstance(row: any): LlmInstance {
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id === null || row.provider_id === undefined ? null : Number(row.provider_id),
    modelId: row.model_id,
    providerSnapshot: normalizeProviderSnapshot(parseJsonColumn(row.provider_snapshot_json)),
    parameters: normalizeParameters(parseJsonColumn(row.parameters_json)),
    extra: asRecord(parseJsonColumn(row.extra_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function rowToChatSession(row: any): ChatSession {
  return {
    id: row.id,
    title: row.title,
    llmInstanceId: row.llm_instance_id === null || row.llm_instance_id === undefined ? null : Number(row.llm_instance_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function rowToChatBlock(row: any): ChatBlock {
  const llmSnapshot = row.llm_instance_snapshot_json
    ? normalizeLlmInstanceSnapshot(parseJsonColumn(row.llm_instance_snapshot_json))
    : null

  return {
    id: row.id,
    chatId: row.chat_id,
    kind: normalizeBlockKind(row.kind),
    targetRole: normalizeTargetRole(row.target_role),
    enabled: asBoolean(row.enabled),
    status: normalizeBlockStatus(row.status),
    orderIndex: row.order_index,
    title: row.title,
    summary: row.summary,
    contentParts: normalizeContentParts(parseJsonColumn(row.content_parts_json)),
    metadata: asRecord(parseJsonColumn(row.metadata_json)),
    llmInstanceSnapshot: llmSnapshot,
    requestBlockIds: parseJsonArray<number>(row.request_block_ids_json).filter(Number.isFinite),
    errorText: row.error_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeLlmInstanceSnapshot(value: unknown): LlmInstance | null {
  const record = asRecord(value)
  const id = Number(record.id)
  if (!Number.isFinite(id)) return null
  return {
    id,
    name: asString(record.name),
    providerId: record.providerId === null || record.providerId === undefined ? null : Number(record.providerId),
    modelId: asString(record.modelId),
    providerSnapshot: normalizeProviderSnapshot(record.providerSnapshot),
    parameters: normalizeParameters(record.parameters),
    extra: asRecord(record.extra),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt)
  }
}
