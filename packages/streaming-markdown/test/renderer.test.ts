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
