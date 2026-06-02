export interface PluginFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

export interface JsonRecord {
  [key: string]: unknown
}

export interface ChatSession {
  id: number
  title: string
  runtimeConfig: {
    llmInstanceId: number | null
    enabledPluginIds: string[]
    pluginData: JsonRecord
  }
  createdAt: string
  updatedAt: string
}

export interface ParentPluginApi {
  chat: {
    getSession(): Promise<ChatSession | null>
    getPluginData(): Promise<JsonRecord>
    setPluginData(value: JsonRecord): Promise<JsonRecord>
  }
  storage: {
    list(path?: string): Promise<PluginFileEntry[]>
    listFor(pluginId: string, path?: string): Promise<PluginFileEntry[]>
    readText(path: string): Promise<string>
    readTextFor(pluginId: string, path: string): Promise<string>
    readBase64(path: string): Promise<string>
    readBase64For(pluginId: string, path: string): Promise<string>
    writeText(path: string, content: string): Promise<void>
    writeTextFor(pluginId: string, path: string, content: string): Promise<void>
    writeBase64(path: string, content: string): Promise<void>
    writeBase64For(pluginId: string, path: string, content: string): Promise<void>
    delete(path: string): Promise<void>
    deleteFor(pluginId: string, path: string): Promise<void>
    readJson(path: string, fallback?: unknown): Promise<unknown>
    readJsonFor(pluginId: string, path: string, fallback?: unknown): Promise<unknown>
    writeJson(path: string, value: unknown): Promise<void>
    writeJsonFor(pluginId: string, path: string, value: unknown): Promise<void>
  }
  toolSettings: {
    getCommonArgs(): Promise<JsonRecord>
    setCommonArgs(value: JsonRecord): Promise<JsonRecord>
  }
}

declare global {
  interface Window {
    parentPluginApi: ParentPluginApi
  }
}

export const api = window.parentPluginApi

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function parseJsonObject(text: string): JsonRecord {
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 顶层必须是对象。')
  }
  return parsed as JsonRecord
}

export function characterData(card: JsonRecord): JsonRecord {
  const data = asRecord(card.data)
  return Object.keys(data).length ? data : card
}

export function characterName(card: JsonRecord, fallback: string): string {
  return asString(characterData(card).name, asString(card.name, fallback)).trim() || fallback
}

export function characterBook(card: JsonRecord): JsonRecord | null {
  const v2Book = asRecord(asRecord(card.data).character_book)
  if (Array.isArray(v2Book.entries)) return v2Book
  const v1Book = asRecord(card.character_book)
  if (Array.isArray(v1Book.entries)) return v1Book
  return null
}

export function worldBookEntryCount(book: JsonRecord): number {
  if (Array.isArray(book.entries)) return book.entries.length
  const entries = asRecord(book.entries)
  return Object.keys(entries).length
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '')
}

export function withExtension(fileName: string, extension: string, fallback: string): string {
  const clean = (fileName || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_')
  const base = stripExtension(clean) || stripExtension(fallback)
  return `${base}.${extension.replace(/^\./, '')}`
}

export function formatBytes(value?: number): string {
  if (!Number.isFinite(value ?? NaN)) return ''
  const bytes = Number(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  downloadBytes(fileName, new TextEncoder().encode(text), type)
}

export function downloadBytes(fileName: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
