export type JsonRecord = Record<string, unknown>

export interface CharacterEntry {
  id: number
  createdAt: string
  updatedAt: string
  stData: JsonRecord
  forgeData: CharacterForgeData
}

export type CharacterUpdatePayload = Pick<CharacterEntry, 'id' | 'stData' | 'forgeData'>

export interface CharacterForgeData {
  worldEntryIds: number[]
  exportFileName?: string
  characterBookName?: string
}

export interface WorldEntry {
  id: number
  createdAt: string
  updatedAt: string
  stData: CharacterBookEntryData
  forgeData: JsonRecord
}

export type WorldEntryUpdatePayload = Pick<WorldEntry, 'id' | 'stData' | 'forgeData'>

export interface CharacterBookEntryData {
  id?: number
  keys: string[]
  secondary_keys?: string[]
  comment?: string
  content: string
  constant?: boolean
  selective?: boolean
  insertion_order: number
  enabled: boolean
  position?: 'before_char' | 'after_char'
  case_sensitive?: boolean
  extensions: JsonRecord
}

export interface WorldBookExportConfig {
  id: string
  name: string
  worldEntryIds: number[]
  exportFileName?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectConfig {
  schemaVersion: number
  worldBookExports: WorldBookExportConfig[]
}

export interface ProjectSnapshot {
  path: string
  config: ProjectConfig
  characters: CharacterEntry[]
  worldEntries: WorldEntry[]
}

export interface ExportResult {
  historyPath: string
  savedPath?: string
}

export type SidebarView = 'characters' | 'worldBooks' | 'worldEntries'

export type IpcJsonPayload<T> = T | string
