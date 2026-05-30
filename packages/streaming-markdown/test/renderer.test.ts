import { describe, expect, it } from 'vitest'

import { createStreamingMarkdownRenderer } from '../src/index.js'

describe('createStreamingMarkdownRenderer', () => {
  it('renders selectable DOM lines with pretext-computed wrapping', () => {
    const container = createContainer()
    const renderer = createStreamingMarkdownRenderer(container, { width: 360 })

    renderer.replace('# Hello\n\nA **streaming** paragraph with [a link](https://example.com).')
    renderer.flush()

    expect(container.querySelector('.sm-heading')).not.toBeNull()
    expect(container.querySelectorAll('.sm-line').length).toBeGreaterThan(1)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')

    renderer.destroy()
  })

  it('resolves block images through the host hook', () => {
    const container = createContainer()
    const renderer = createStreamingMarkdownRenderer(container, {
      resolveImage: ({ src, alt }) => ({
        alt,
        height: 200,
        src,
        width: 400,
      }),
      width: 360,
    })

    renderer.replace('![alt](https://example.com/a.png)')
    renderer.flush()

    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('https://example.com/a.png')
    expect(image?.getAttribute('width')).toBe('400')

    renderer.destroy()
  })

  it('exposes snapshots and render stats', () => {
    const container = createContainer()
    const renderer = createStreamingMarkdownRenderer(container, { width: 320 })

    renderer.append('hello')
    renderer.flush()

    expect(renderer.getSnapshot().source).toBe('hello')
    expect(renderer.getStats().sourceLength).toBe(5)

    renderer.destroy()
  })

  it('owns its prepared text cache per renderer instance', () => {
    const firstContainer = createContainer()
    const secondContainer = createContainer()
    const first = createStreamingMarkdownRenderer(firstContainer, {
      preparedTextCacheMaxEntries: 4,
      width: 320,
    })
    const second = createStreamingMarkdownRenderer(secondContainer, {
      preparedTextCacheMaxEntries: 4,
      width: 320,
    })

    first.replace('```ts\nconst cached = true\n```')
    first.finalize()
    first.flush()

    expect(first.getPreparedTextCacheStats()).toEqual({ entries: 1, maxEntries: 4 })
    expect(second.getPreparedTextCacheStats()).toEqual({ entries: 0, maxEntries: 4 })

    first.clearPreparedTextCache()
    expect(first.getPreparedTextCacheStats().entries).toBe(0)

    first.destroy()
    second.destroy()
  })

  it('owns its rich inline cache per renderer instance', () => {
    const firstContainer = createContainer()
    const secondContainer = createContainer()
    const first = createStreamingMarkdownRenderer(firstContainer, {
      richInlineCacheMaxEntries: 4,
      width: 320,
    })
    const second = createStreamingMarkdownRenderer(secondContainer, {
      richInlineCacheMaxEntries: 4,
      width: 320,
    })

    first.replace('A **cached** paragraph with `inline code`.')
    first.finalize()
    first.flush()

    expect(first.getRichInlineCacheStats()).toEqual({ entries: 1, maxEntries: 4 })
    expect(second.getRichInlineCacheStats()).toEqual({ entries: 0, maxEntries: 4 })

    first.clearRichInlineCache()
    expect(first.getRichInlineCacheStats().entries).toBe(0)

    first.destroy()
    second.destroy()
  })
})

function createContainer(): HTMLElement {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    value: 360,
  })
  document.body.append(container)
  return container
}
