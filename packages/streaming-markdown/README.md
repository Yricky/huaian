# @st-forge/streaming-markdown

A framework-neutral DOM renderer for LLM-style streaming Markdown. It uses a small streaming-aware Markdown parser and `@chenglou/pretext` for manual line layout, so text remains selectable while line wrapping does not depend on browser reflow.

## Install

```sh
pnpm add @st-forge/streaming-markdown
```

## API

```ts
import {
  createStreamingMarkdownRenderer,
  getDefaultStyleSheet,
  getDefaultThemeVars,
} from '@st-forge/streaming-markdown'

const style = document.createElement('style')
style.textContent = getDefaultStyleSheet()
document.head.append(style)

const renderer = createStreamingMarkdownRenderer(container, {
  allowHtml: false,
  resolveImage: async ({ src, alt }) => {
    const meta = await imageMetadataCache.get(src)
    if (!meta) return null
    return {
      alt,
      decoding: 'async',
      height: meta.height,
      loading: 'lazy',
      src,
      width: meta.width,
    }
  },
})

Object.assign(container.style, getDefaultThemeVars('light'))

renderer.append(chunk)
renderer.finalize()
```

`createStreamingMarkdownRenderer(container, options)` returns:

- `append(chunk)`, `replace(markdown)`, `reset()`, `finalize()`
- `flush()` for immediate sync rendering when a caller needs it
- `destroy()`
- `getSnapshot()` for parsed blocks and diagnostics
- `getStats()` for block count, line count, source length, and last render time
- `subscribe(listener)` for render and image-error events

## First-Version Markdown

Supported: headings, paragraphs, emphasis, strong, strike, links, inline code, images, blockquotes, unordered/ordered/task lists, fenced code, horizontal rules, GFM-style pipe tables, `$inline$` math, `$$block$$` math, and fenced `mermaid` blocks.

Raw HTML is disabled by default. When `allowHtml` is enabled, raw HTML is parsed as an `html` node and passed to `renderHtml`; the core renderer does not call `innerHTML`.

## Streaming Behavior

- Unclosed code fences render as live code previews.
- Unclosed Mermaid fences render a small animated placeholder until the closing fence arrives.
- Unclosed math blocks render a placeholder while streaming; after `finalize()`, incomplete math falls back to ordinary text.
- The parser allows local reclassification as chunks arrive, so a line can become a list item, table, or fence once enough syntax is present.

## Image Resolver

The core renderer only inserts real images when the host provides dimensions. This keeps layout stable during streaming.

```ts
createStreamingMarkdownRenderer(container, {
  resolveImage: async ({ src, alt }) => {
    const meta = await lookupImageSize(src)
    if (!meta) return null
    return {
      alt,
      height: meta.height,
      src,
      width: meta.width,
    }
  },
  onImageResolveError: ({ src, error }) => {
    console.warn('image metadata failed', src, error)
  },
})
```

## Styling

Use `getDefaultClassNames(prefix)` when integrating with an existing design system. Use `getDefaultThemeVars('light' | 'dark')` to seed CSS variables, or `getDefaultStyleSheet(prefix)` for the package's baseline stylesheet.

The default root class is `sm-root`; block classes include `sm-paragraph`, `sm-heading`, `sm-code`, `sm-table`, `sm-image`, and `sm-placeholder`.

## Scripts

```sh
pnpm --filter @st-forge/streaming-markdown dev
pnpm --filter @st-forge/streaming-markdown build
pnpm --filter @st-forge/streaming-markdown test
pnpm --filter @st-forge/streaming-markdown bench
```
