import { Window } from 'happy-dom'
import { performance } from 'node:perf_hooks'

import { createStreamingMarkdownRenderer } from '../dist/index.js'

const window = new Window()
globalThis.window = window
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLAnchorElement = window.HTMLAnchorElement
globalThis.performance = performance
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0)
globalThis.cancelAnimationFrame = handle => clearTimeout(handle)
globalThis.OffscreenCanvas = class {
  getContext() {
    return {
      font: '16px sans-serif',
      measureText(text) {
        const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16)
        return { width: text.length * size * 0.56 }
      },
    }
  }
}

const sample = buildSampleMarkdown()
const container = document.createElement('div')
Object.defineProperty(container, 'clientWidth', { value: 720 })
document.body.append(container)

const renderer = createStreamingMarkdownRenderer(container, {
  resolveImage: ({ src, alt }) => ({ alt, height: 360, src, width: 720 }),
  width: 720,
})

measure('12K-ish first render', () => {
  renderer.replace(sample)
  renderer.finalize()
  renderer.flush()
})

measure('200 streaming chunks', () => {
  renderer.reset()
  const chunkSize = Math.ceil(sample.length / 200)
  for (let index = 0; index < sample.length; index += chunkSize) {
    renderer.append(sample.slice(index, index + chunkSize))
    renderer.flush()
  }
  renderer.finalize()
  renderer.flush()
})

measure('resize relayout', () => {
  renderer.replace(sample)
  renderer.finalize()
  renderer.flush()
  for (const width of [420, 520, 640, 760, 680, 560]) {
    renderer.destroy()
    const next = document.createElement('div')
    Object.defineProperty(next, 'clientWidth', { value: width })
    document.body.replaceChildren(next)
    const resized = createStreamingMarkdownRenderer(next, { width })
    resized.replace(sample)
    resized.finalize()
    resized.flush()
    resized.destroy()
  }
})

const withoutRichInlineCache = measure('same renderer repeated layout, rich inline cache off', () => {
  return runSameRendererRepeatedLayout({ richInlineCacheMaxEntries: 0 })
})
const withRichInlineCache = measure('same renderer repeated layout, rich inline cache on', () => {
  return runSameRendererRepeatedLayout({ richInlineCacheMaxEntries: 2048 })
})
console.log(`same renderer rich inline speedup: ${formatPercent((withoutRichInlineCache - withRichInlineCache) / withoutRichInlineCache)}`)

function measure(label, run) {
  const start = performance.now()
  run()
  const duration = performance.now() - start
  console.log(`${label}: ${duration.toFixed(2)}ms`)
  return duration
}

function runSameRendererRepeatedLayout({ richInlineCacheMaxEntries }) {
  const sameContainer = document.createElement('div')
  let sameRendererWidth = 480
  Object.defineProperty(sameContainer, 'clientWidth', {
    get() {
      return sameRendererWidth
    },
  })
  document.body.replaceChildren(sameContainer)
  const sameRenderer = createStreamingMarkdownRenderer(sameContainer, {
    preparedTextCacheMaxEntries: 256,
    resolveImage: ({ src, alt }) => ({ alt, height: 360, src, width: 720 }),
    richInlineCacheMaxEntries,
  })

  sameRenderer.replace(sample)
  sameRenderer.finalize()
  sameRenderer.flush()

  for (let iteration = 0; iteration < 80; iteration++) {
    sameRendererWidth = 420 + iteration * 3
    sameRenderer.flush()
  }

  const preparedTextCache = sameRenderer.getPreparedTextCacheStats()
  const richInlineCache = sameRenderer.getRichInlineCacheStats()
  sameRenderer.destroy()
  console.log(`same renderer prepared cache entries: ${preparedTextCache.entries}/${preparedTextCache.maxEntries}`)
  console.log(`same renderer rich inline cache entries: ${richInlineCache.entries}/${richInlineCache.maxEntries}`)
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`
}

function buildSampleMarkdown() {
  const unit = `## Streaming section

This paragraph has **strong text**, *emphasis*, inline $a^2+b^2=c^2$, [links](https://example.com), and enough prose to wrap through several pretext-computed lines.

- first item
- second item
- [x] task item

| Name | Status | Count |
| :--- | :---: | ---: |
| Parser | ready | 12 |
| Renderer | ready | 34 |

\`\`\`ts
renderer.append(chunk)
renderer.flush()
\`\`\`

`
  return `# Benchmark\n\n${unit.repeat(34)}![bench](https://example.com/bench.png)\n`
}
