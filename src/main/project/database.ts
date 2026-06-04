import Database from 'better-sqlite3'
import type {
  AppSessionRecord,
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
import { asRecord } from './normalizers'

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

    CREATE TABLE IF NOT EXISTS app_sessions (
      app_id TEXT NOT NULL,
      id INTEGER NOT NULL,
      title TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      PRIMARY KEY (app_id, id)
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
  return db
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

export function rowToAppSession(row: any): AppSessionRecord {
  return {
    id: Number(row.id),
    appId: row.app_id,
    title: row.title,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at
  }
}
