import Database from 'better-sqlite3'
import type { CharacterEntry, WorldEntry } from '../../shared/types'
import {
  asRecord,
  normalizeCharacterCard,
  normalizeCharacterForgeData,
  normalizeWorldEntryData
} from './normalizers'

export function initDatabase(dbPath: string): any {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      st_data TEXT NOT NULL,
      forge_data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      st_data TEXT NOT NULL,
      forge_data TEXT NOT NULL
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

export function rowToCharacter(row: any): CharacterEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stData: normalizeCharacterCard(parseJsonColumn(row.st_data), row.created_at),
    forgeData: normalizeCharacterForgeData(parseJsonColumn(row.forge_data))
  }
}

export function rowToWorldEntry(row: any): WorldEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stData: normalizeWorldEntryData(parseJsonColumn(row.st_data)),
    forgeData: asRecord(parseJsonColumn(row.forge_data))
  }
}
