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
  worldBookId: number | null
  exportFileName?: string
  characterBookName?: string
}

export interface WorldBook {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export type WorldBookUpdatePayload = Pick<WorldBook, 'id' | 'name'>

export interface WorldEntry {
  id: number
  worldBookId: number
  createdAt: string
  updatedAt: string
  stData: CharacterBookEntryData
  forgeData: JsonRecord
}

export type WorldEntryUpdatePayload = Pick<WorldEntry, 'id' | 'worldBookId' | 'stData' | 'forgeData'>

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

export interface WorldEntryOrderPayload {
  worldBookId: number
  worldEntryIds: number[]
}

export interface ProjectConfig {
  schemaVersion: number
}

export interface ProjectSnapshot {
  path: string
  config: ProjectConfig
  characters: CharacterEntry[]
  worldBooks: WorldBook[]
  worldEntries: WorldEntry[]
}

export interface ExportResult {
  historyPath: string
  savedPath?: string
}

export type SidebarView = 'characters' | 'worldBooks'

export type IpcJsonPayload<T> = T | string
