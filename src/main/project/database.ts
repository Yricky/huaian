import Database from 'better-sqlite3'
import type {
  AppSessionRecord,
  JsonRecordValue,
  LlmInstance,
  LlmProvider,
  LlmProviderType,
  ProviderModelCacheItem
} from '../../shared/types'
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
      extra_json TEXT NOT NULL,
      order_index INTEGER NOT NULL,
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
    providerId: row.provider_id === null ? null : Number(row.provider_id),
    modelId: row.model_id,
    extra: asRecord(parseJsonColumn(row.extra_json)),
    orderIndex: Number(row.order_index),
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
