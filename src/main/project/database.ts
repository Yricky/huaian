import Database from 'better-sqlite3'
import type {
  AppSessionRecord,
  JsonRecordValue,
  LlmInstance,
  LlmFeatureString,
  LlmProvider,
  LlmProviderType,
  ProviderModelCacheItem
} from '../../shared/types'
import { DEFAULT_LLM_FEATURES } from '../../shared/types'
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
      features_json TEXT NOT NULL DEFAULT '["toolcall","img-input","img-output"]',
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
  migrateDatabase(db)
  return db
}

function tableColumns(db: any, tableName: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row: any) => String(row.name)))
}

function migrateDatabase(db: any): void {
  const llmInstanceColumns = tableColumns(db, 'llm_instances')
  if (!llmInstanceColumns.has('features_json')) {
    db.prepare(`
      ALTER TABLE llm_instances
      ADD COLUMN features_json TEXT NOT NULL DEFAULT '["toolcall","img-input","img-output"]'
    `).run()
  }
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

function normalizeLlmFeatures(value: string): LlmFeatureString[] {
  const features = parseJsonArray<unknown>(value).filter((item): item is LlmFeatureString => (
    item === 'toolcall' || item === 'img-input' || item === 'img-output'
  ))
  return features.length ? [...new Set(features)] : [...DEFAULT_LLM_FEATURES]
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
    features: normalizeLlmFeatures(row.features_json ?? '[]'),
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
