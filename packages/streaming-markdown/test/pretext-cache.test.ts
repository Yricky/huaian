import { describe, expect, it } from 'vitest'

import { PreparedTextCache, RichInlineCache } from '../src/pretext-cache.js'

describe('prepared text cache', () => {
  it('reuses prepareWithSegments results for identical parameters', () => {
    const cache = new PreparedTextCache(8)

    const first = cache.get('same text', '400 16px sans-serif', { whiteSpace: 'pre-wrap' })
    const second = cache.get('same text', '400 16px sans-serif', { whiteSpace: 'pre-wrap' })

    expect(second).toBe(first)
    expect(cache.getStats().entries).toBe(1)
  })

  it('keeps different prepare options in different cache slots', () => {
    const cache = new PreparedTextCache(8)

    const normal = cache.get('same text', '400 16px sans-serif')
    const preWrap = cache.get('same text', '400 16px sans-serif', { whiteSpace: 'pre-wrap' })

    expect(preWrap).not.toBe(normal)
    expect(cache.getStats().entries).toBe(2)
  })

  it('evicts least recently used entries when over the limit', () => {
    const cache = new PreparedTextCache(2)

    const first = cache.get('one', '400 16px sans-serif')
    cache.get('two', '400 16px sans-serif')
    cache.get('one', '400 16px sans-serif')
    cache.get('three', '400 16px sans-serif')

    expect(cache.getStats().entries).toBe(2)
    expect(cache.get('one', '400 16px sans-serif')).toBe(first)
  })
})

describe('rich inline cache', () => {
  it('reuses prepareRichInline results for identical item parameters', () => {
    const cache = new RichInlineCache(8)
    const items = [
      { font: '400 16px sans-serif', text: 'hello ' },
      { break: 'never' as const, extraWidth: 10, font: '600 16px sans-serif', text: 'chip' },
    ]

    const first = cache.get(items)
    const second = cache.get(items.map(item => ({ ...item })))

    expect(second).toBe(first)
    expect(cache.getStats().entries).toBe(1)
  })

  it('evicts rich inline entries least recently used', () => {
    const cache = new RichInlineCache(2)
    const first = cache.get([{ font: '400 16px sans-serif', text: 'one' }])

    cache.get([{ font: '400 16px sans-serif', text: 'two' }])
    cache.get([{ font: '400 16px sans-serif', text: 'one' }])
    cache.get([{ font: '400 16px sans-serif', text: 'three' }])

    expect(cache.getStats().entries).toBe(2)
    expect(cache.get([{ font: '400 16px sans-serif', text: 'one' }])).toBe(first)
  })
})
