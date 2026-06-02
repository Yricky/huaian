import Database from 'better-sqlite3'
import type {
  DbChatBlock,
  ChatBlockKind,
  ChatBlockStatus,
  ChatContentPart,
  ChatSession,
  JsonRecord,
  JsonRecordValue,
  LlmGenerationParameters,
  LlmInstance,
  LlmProvider,
  LlmProviderSnapshot,
  LlmProviderType,
  ProviderModelCacheItem
} from '../../shared/types'
import { asString } from '../../shared/value-utils'
import {
  asRecord,
  normalizeChatRuntimeConfig
} from './normalizers'

export function initDatabase(dbPath: string): any {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
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
      runtime_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      content_parts_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      llm_instance_snapshot_json TEXT,
      error_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  ensureColumn(db, 'chat_sessions', 'runtime_config_json', 'TEXT NOT NULL DEFAULT \'{}\'')
  return db
}

function ensureColumn(db: any, tableName: string, columnName: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all()
  if (rows.some((row: any) => row.name === columnName)) return
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run()
}

function parseJsonColumn(value: string): JsonRecordValue {
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

function asBoolean(value: JsonRecordValue): boolean {
  return Boolean(value)
}

function normalizeProviderType(value: JsonRecordValue): LlmProviderType {
  return (
    value === 'openai' ||
    value === 'openai-compatible' ||
    value === 'anthropic' ||
    value === 'google' ||
    value === 'ollama' ||
    value === 'custom'
  ) ? value : 'openai-compatible'
}

function normalizeProviderSnapshot(value: JsonRecordValue): LlmProviderSnapshot {
  const record = asRecord(value)
  return {
    providerName: asString(record.providerName, ''),
    type: normalizeProviderType(record.type),
    config: asRecord(record.config)
  }
}

function normalizeParameters(value: JsonRecordValue): LlmGenerationParameters {
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

function normalizeContentParts(value: JsonRecordValue): ChatContentPart[] {
  if (!Array.isArray(value)) return []
  return value
    .map(part => asRecord(part))
    .filter(part => part.type === 'text' || part.type === 'reasoning' || part.type === 'tool_call')
    .map(part => {
      if (part.type === 'tool_call') {
        const now = new Date().toISOString()
        const status = part.status === 'success' || part.status === 'error' ? part.status : 'pending'
        return {
          type: 'tool_call',
          toolCallId: asString(part.toolCallId),
          toolName: asString(part.toolName),
          status,
          input: asRecord(part.input),
          output: part.output,
          error: asString(part.error),
          sendAsContext: part.sendAsContext === true,
          createdAt: asString(part.createdAt, now),
          updatedAt: asString(part.updatedAt, now),
          extensions: asRecord(part.extensions)
        }
      }

      if (part.type === 'reasoning') {
        return {
          type: 'reasoning',
          text: asString(part.text),
          sendAsContext: part.sendAsContext === true
        }
      }

      return {
        type: 'text',
        text: asString(part.text)
      }
    })
}

function normalizeBlockKind(value: JsonRecordValue): ChatBlockKind {
  return (
    value === 'system' ||
    value === 'user' ||
    value === 'assistant' ||
    value === 'injection'
  ) ? value : 'user'
}

function normalizeBlockStatus(value: JsonRecordValue): ChatBlockStatus {
  return value === 'generating' || value === 'stopped' || value === 'error' ? value : 'idle'
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
    runtimeConfig: normalizeChatRuntimeConfig(parseJsonColumn(row.runtime_config_json ?? '{}')),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function rowToChatBlock(row: any): DbChatBlock {
  const llmSnapshot = row.llm_instance_snapshot_json
    ? normalizeLlmInstanceSnapshot(parseJsonColumn(row.llm_instance_snapshot_json))
    : null

  return {
    id: row.id,
    chatId: row.chat_id,
    kind: normalizeBlockKind(row.kind),
    enabled: asBoolean(row.enabled),
    status: normalizeBlockStatus(row.status),
    orderIndex: row.order_index,
    contentParts: normalizeContentParts(parseJsonColumn(row.content_parts_json)),
    metadata: asRecord(parseJsonColumn(row.metadata_json)),
    llmInstanceSnapshot: llmSnapshot,
    errorText: row.error_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeLlmInstanceSnapshot(value: JsonRecordValue): LlmInstance | null {
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
