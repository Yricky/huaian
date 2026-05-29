import {
  createStreamingMarkdownRenderer,
  getDefaultStyleSheet,
  getDefaultThemeVars,
  type ResolvedImage,
  type StreamingMarkdownRenderer,
} from '../../src/index.js'

const source = requireElement<HTMLTextAreaElement>('source')
const preview = requireElement<HTMLElement>('preview')
const play = requireElement<HTMLButtonElement>('play')
const pause = requireElement<HTMLButtonElement>('pause')
const resume = requireElement<HTMLButtonElement>('resume')
const reset = requireElement<HTMLButtonElement>('reset')
const finalize = requireElement<HTMLButtonElement>('finalize')
const interval = requireElement<HTMLInputElement>('interval')
const chunkSize = requireElement<HTMLInputElement>('chunk-size')
const allowHtml = requireElement<HTMLInputElement>('allow-html')
const imageResolver = requireElement<HTMLInputElement>('image-resolver')
const stats = requireElement<HTMLElement>('stats')

let renderer: StreamingMarkdownRenderer = createRenderer()
let timer: number | null = null
let cursor = 0

source.value = `# Streaming Markdown

This demo feeds the renderer small chunks, just like an LLM API stream. It keeps text selectable while pretext owns line wrapping.

## Inline syntax

You can mix **strong text**, *emphasis*, ~~deleted text~~, \`inline code\`, [links](https://example.com), and math like $E = mc^2$.

> A blockquote waits for its inner blocks to parse, then renders with the same pretext line layout.

- [x] Parse chunks
- [ ] Keep the last block hot while streaming
- Support nested content
  - Including simple nested lists

| Feature | First version | Notes |
| :--- | :---: | ---: |
| Tables | yes | cells render line-by-line |
| Images | resolver | dimensions come from host |
| HTML | optional | hook-owned |

![Example resolved by host](https://example.com/streaming-markdown.png "Host image")

\`\`\`ts
renderer.append(chunk)
renderer.finalize()
\`\`\`

\`\`\`mermaid
flowchart LR
  A[LLM stream] --> B[Streaming parser]
  B --> C[Pretext layout]
  C --> D[DOM lines]
\`\`\`

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

<aside>Raw HTML is passed to a renderHtml hook only when allowHtml is enabled.</aside>
`

installDemoStyles()
wireControls()
renderer.replace(source.value)
renderer.flush()

function createRenderer(): StreamingMarkdownRenderer {
  return createStreamingMarkdownRenderer(preview, {
    allowHtml: allowHtml.checked,
    defaultWidth: 720,
    renderHtml: (html, element) => {
      element.textContent = `HTML hook received: ${html}`
    },
    renderMath: ({ display, value }, element) => {
      element.textContent = display ? `$$ ${value} $$` : `$${value}$`
    },
    renderMermaid: (code, element) => {
      element.textContent = `Mermaid hook received ${code.split('\n').length} lines`
    },
    resolveImage: imageResolver.checked ? resolveDemoImage : undefined,
  })
}

function resolveDemoImage({ src, alt }: { src: string; alt: string }): Promise<ResolvedImage> {
  return new Promise(resolve => {
    window.setTimeout(() => {
      resolve({
        alt,
        decoding: 'async',
        height: 360,
        loading: 'lazy',
        src,
        width: 720,
      })
    }, 180)
  })
}

function wireControls(): void {
  play.addEventListener('click', () => {
    stop()
    recreateRenderer()
    cursor = 0
    tick()
  })

  pause.addEventListener('click', stop)
  resume.addEventListener('click', tick)

  reset.addEventListener('click', () => {
    stop()
    cursor = 0
    renderer.reset()
    updateStats()
  })

  finalize.addEventListener('click', () => {
    stop()
    renderer.finalize()
    renderer.flush()
    updateStats()
  })

  allowHtml.addEventListener('change', recreateAndRenderFullSource)
  imageResolver.addEventListener('change', recreateAndRenderFullSource)

  renderer.subscribe(() => updateStats())
}

function tick(): void {
  if (timer !== null) return

  const run = (): void => {
    const text = source.value
    const size = Number(chunkSize.value)
    if (cursor >= text.length) {
      stop()
      renderer.finalize()
      return
    }

    renderer.append(text.slice(cursor, cursor + size))
    cursor += size
    updateStats()
    timer = window.setTimeout(run, Number(interval.value))
  }

  run()
}

function recreateAndRenderFullSource(): void {
  stop()
  recreateRenderer()
  cursor = source.value.length
  renderer.replace(source.value)
  renderer.finalize()
  renderer.flush()
  updateStats()
}

function recreateRenderer(): void {
  renderer.destroy()
  renderer = createRenderer()
  renderer.subscribe(() => updateStats())
}

function stop(): void {
  if (timer === null) return
  window.clearTimeout(timer)
  timer = null
}

function updateStats(): void {
  const rendererStats = renderer.getStats()
  stats.textContent = `${cursor.toLocaleString()} / ${source.value.length.toLocaleString()} chars · ${rendererStats.blockCount} blocks · ${rendererStats.lineCount} lines · ${rendererStats.lastRenderDurationMs.toFixed(1)} ms`
}

function installDemoStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
${getDefaultStyleSheet()}

:root {
  ${Object.entries(getDefaultThemeVars('light')).map(([key, value]) => `${key}: ${value};`).join('\n  ')}
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: #f3f5f8;
  color: #171a1f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button, input, textarea {
  font: inherit;
}

button {
  border: 1px solid #c9d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2630;
  cursor: pointer;
  min-height: 34px;
  padding: 0 12px;
}

button:hover {
  border-color: #8fa1bd;
}

.demo-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
}

.demo-controls {
  align-items: center;
  border-bottom: 1px solid #d8dee8;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 14px;
}

.demo-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.demo-field {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: max-content 140px;
}

.demo-field span, .demo-check, .demo-stats {
  color: #536071;
  font-size: 13px;
}

.demo-check {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

.demo-stats {
  margin-inline-start: auto;
  white-space: nowrap;
}

.demo-workbench {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(320px, 1.1fr);
  min-height: 0;
}

#source {
  border: 0;
  border-right: 1px solid #d8dee8;
  min-height: 0;
  outline: none;
  padding: 16px;
  resize: none;
}

#preview {
  background: #ffffff;
  min-height: 0;
  overflow: auto;
  padding: 22px;
}

@media (max-width: 760px) {
  .demo-workbench {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 0.8fr) minmax(280px, 1.2fr);
  }

  #source {
    border-bottom: 1px solid #d8dee8;
    border-right: 0;
  }

  .demo-stats {
    margin-inline-start: 0;
  }
}
`
  document.head.append(style)
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing #${id}`)
  return element as T
}
