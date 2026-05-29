import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../src/index.js'

describe('parseMarkdown', () => {
  it('parses the first-version GFM subset', () => {
    const snapshot = parseMarkdown(`# Title

- [x] done
- pending

| A | B |
| :--- | ---: |
| **x** | \`y\` |
`)

    expect(snapshot.blocks.map(block => block.type)).toEqual(['heading', 'list', 'table'])
    expect(snapshot.blocks[1]?.type).toBe('list')
    if (snapshot.blocks[1]?.type === 'list') {
      expect(snapshot.blocks[1].items[0]?.task).toBe(true)
      expect(snapshot.blocks[1].items[0]?.checked).toBe(true)
    }
  })

  it('keeps unclosed code fences previewable', () => {
    const snapshot = parseMarkdown('```ts\nconst value = 1')
    expect(snapshot.blocks[0]?.type).toBe('code')
    expect(snapshot.blocks[0]?.closed).toBe(false)
  })

  it('uses a placeholder for unclosed mermaid fences while streaming', () => {
    const snapshot = parseMarkdown('```mermaid\nflowchart LR\nA-->B')
    expect(snapshot.blocks[0]?.type).toBe('placeholder')
  })

  it('turns finalized unclosed math into ordinary text', () => {
    const snapshot = parseMarkdown('$$\na+b', { finalized: true })
    expect(snapshot.blocks[0]?.type).toBe('paragraph')
  })

  it('does not emit raw HTML blocks unless allowHtml is enabled', () => {
    expect(parseMarkdown('<aside>Hello</aside>').blocks[0]?.type).toBe('paragraph')
    expect(parseMarkdown('<aside>Hello</aside>', { allowHtml: true }).blocks[0]?.type).toBe('html')
  })
})
