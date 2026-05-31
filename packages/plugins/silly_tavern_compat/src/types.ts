import type { ChatBlock, ChatBlockTargetRole, JsonRecord } from '@st-forge/plugin-api'

export interface CharacterEntry {
  id: number
  createdAt: string
  updatedAt: string
  assetPath: string | null
  stData: JsonRecord
  forgeData: CharacterForgeData
}

export interface CharacterForgeData {
  loreBookId: number | null
  exportFileName?: string
  characterBookName?: string
}

export interface LoreBook {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export interface WorldEntry {
  id: number
  loreBookId: number
  createdAt: string
  updatedAt: string
  stData: CharacterBookEntryData
  forgeData: JsonRecord
}

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

export interface InjectionDetail {
  title: string
  source: 'character' | 'worldInfo'
  sourceName: string
  reason: string
  content: string
  entryId?: number
  loreBookId?: number
}

export interface InjectionPreviewBlock extends ChatBlock {
  metadata: JsonRecord & {
    virtual: true
    targetRole: ChatBlockTargetRole
    source: 'character' | 'worldInfo'
    activatedEntryIds?: number[]
    loreBookIds?: number[]
    injectionDetails?: InjectionDetail[]
    displaySlot?: 'start' | 'end'
    displayBeforeBlockId?: number
    displayAfterBlockId?: number
  }
}

export type InjectionPreviewMetadataInput = JsonRecord & {
  virtual: true
  source: 'character' | 'worldInfo'
  activatedEntryIds?: number[]
  loreBookIds?: number[]
  injectionDetails?: InjectionDetail[]
  displaySlot?: 'start' | 'end'
  displayBeforeBlockId?: number
  displayAfterBlockId?: number
}

export interface PluginFileRecord {
  fileName: string
  data: JsonRecord
}
