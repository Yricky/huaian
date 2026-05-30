import {
  prepareWithSegments,
  type PreparedTextWithSegments,
  type PrepareOptions,
} from '@chenglou/pretext'
import {
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineItem,
} from '@chenglou/pretext/rich-inline'

import type { PreparedTextCacheStats, RichInlineCacheStats } from './types.js'

const DEFAULT_PREPARED_TEXT_CACHE_MAX_ENTRIES = 512
const DEFAULT_RICH_INLINE_CACHE_MAX_ENTRIES = 2048

export class PreparedTextCache {
  private readonly cache = new Map<string, PreparedTextWithSegments>()
  private maxEntries: number

  constructor(maxEntries = DEFAULT_PREPARED_TEXT_CACHE_MAX_ENTRIES) {
    this.maxEntries = normalizeMaxEntries(maxEntries)
  }

  get(
    text: string,
    font: string,
    options: PrepareOptions = {},
  ): PreparedTextWithSegments {
    if (this.maxEntries <= 0) return prepareWithSegments(text, font, options)

    const key = createPreparedTextCacheKey(text, font, options)
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }

    const prepared = prepareWithSegments(text, font, options)
    this.cache.set(key, prepared)
    this.trim()
    return prepared
  }

  clear(): void {
    this.cache.clear()
  }

  configure(maxEntries: number): void {
    this.maxEntries = normalizeMaxEntries(maxEntries)
    this.trim()
  }

  getStats(): PreparedTextCacheStats {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
    }
  }

  private trim(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      this.cache.delete(oldest)
    }
  }
}

export class RichInlineCache {
  private readonly cache = new Map<string, PreparedRichInline>()
  private maxEntries: number

  constructor(maxEntries = DEFAULT_RICH_INLINE_CACHE_MAX_ENTRIES) {
    this.maxEntries = normalizeMaxEntries(maxEntries)
  }

  get(items: RichInlineItem[]): PreparedRichInline {
    if (this.maxEntries <= 0) return prepareRichInline(items)

    const key = createRichInlineCacheKey(items)
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }

    const prepared = prepareRichInline(items)
    this.cache.set(key, prepared)
    this.trim()
    return prepared
  }

  clear(): void {
    this.cache.clear()
  }

  configure(maxEntries: number): void {
    this.maxEntries = normalizeMaxEntries(maxEntries)
    this.trim()
  }

  getStats(): RichInlineCacheStats {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
    }
  }

  private trim(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      this.cache.delete(oldest)
    }
  }
}

function normalizeMaxEntries(value: number): number {
  return Math.max(0, Math.floor(value))
}

function createPreparedTextCacheKey(
  text: string,
  font: string,
  options: PrepareOptions,
): string {
  return JSON.stringify([
    text,
    font,
    options.whiteSpace ?? null,
    options.wordBreak ?? null,
    options.letterSpacing ?? null,
  ])
}

function createRichInlineCacheKey(items: RichInlineItem[]): string {
  return JSON.stringify(items.map(item => [
    item.text,
    item.font,
    item.break ?? null,
    item.extraWidth ?? null,
    item.letterSpacing ?? null,
  ]))
}
