import {
  layoutWithLines,
  type LayoutLine,
} from '@chenglou/pretext'
import {
  materializeRichInlineLineRange,
  walkRichInlineLineRanges,
  type RichInlineItem,
} from '@chenglou/pretext/rich-inline'

import { parseMarkdown } from './parser.js'
import { PreparedTextCache, RichInlineCache } from './pretext-cache.js'
import { getDefaultClassNames } from './styles.js'
import type {
  CodeBlock,
  DefaultTheme,
  HtmlInline,
  ImageBlock,
  ImageInline,
  LinkInline,
  ListBlock,
  MarkdownBlock,
  MarkdownInline,
  MarkdownSnapshot,
  ResolvedImage,
  PreparedTextCacheStats,
  RichInlineCacheStats,
  StreamingMarkdownClassNames,
  StreamingMarkdownOptions,
  StreamingMarkdownRenderStats,
  StreamingMarkdownRenderer,
  StreamingMarkdownSubscriber,
  TableAlign,
} from './types.js'

type InlineStyle = {
  code: boolean
  emphasis: boolean
  link: LinkInline | null
  strike: boolean
  strong: boolean
}

type InlineRenderItem = {
  breakMode: 'normal' | 'never'
  className: string
  extraWidth: number
  font: string
  html?: HtmlInline
  link: LinkInline | null
  math?: {
    display: boolean
    value: string
  }
  text: string
}

type CachedBlock = {
  node: HTMLElement
  signature: string
}

type ImageState =
  | {
      status: 'pending'
    }
  | {
      image: ResolvedImage
      status: 'resolved'
    }
  | {
      error: unknown
      status: 'error'
    }

type FontSet = {
  body: string
  bodyEmphasis: string
  bodyStrong: string
  code: string
  heading1: string
  heading2: string
  heading3: string
  heading4: string
  heading5: string
  heading6: string
  inlineCode: string
  marker: string
  small: string
}

const DEFAULT_FONTS: FontSet = {
  body: '400 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  bodyEmphasis: 'italic 400 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  bodyStrong: '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  code: '500 13px "SF Mono", ui-monospace, Menlo, Monaco, monospace',
  heading1: '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  heading2: '700 23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  heading3: '700 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  heading4: '700 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  heading5: '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  heading6: '700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  inlineCode: '500 13px "SF Mono", ui-monospace, Menlo, Monaco, monospace',
  marker: '600 13px "SF Mono", ui-monospace, Menlo, Monaco, monospace',
  small: '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const LINE_HEIGHTS = {
  body: 23,
  code: 20,
  heading1: 36,
  heading2: 30,
  heading3: 26,
  heading4: 24,
  heading5: 22,
  heading6: 21,
  table: 21,
}

const EMPTY_SNAPSHOT: MarkdownSnapshot = {
  blocks: [],
  diagnostics: [],
  finalized: false,
  source: '',
}

export function createStreamingMarkdownRenderer(
  container: HTMLElement,
  options: StreamingMarkdownOptions = {},
): StreamingMarkdownRenderer {
  return new DomStreamingMarkdownRenderer(container, options)
}

class DomStreamingMarkdownRenderer implements StreamingMarkdownRenderer {
  private readonly blockCache = new Map<string, CachedBlock>()
  private readonly classes: StreamingMarkdownClassNames
  private readonly container: HTMLElement
  private readonly imageStates = new Map<string, ImageState>()
  private readonly options: StreamingMarkdownOptions
  private readonly preparedTextCache: PreparedTextCache
  private readonly prefix: string
  private readonly richInlineCache: RichInlineCache
  private readonly subscribers = new Set<StreamingMarkdownSubscriber>()

  private finalized = false
  private lineCount = 0
  private rafId: number | null = null
  private snapshot: MarkdownSnapshot = EMPTY_SNAPSHOT
  private source = ''
  private stats: StreamingMarkdownRenderStats = {
    blockCount: 0,
    lastRenderDurationMs: 0,
    lineCount: 0,
    sourceLength: 0,
  }

  constructor(container: HTMLElement, options: StreamingMarkdownOptions) {
    this.container = container
    this.options = options
    this.preparedTextCache = new PreparedTextCache(options.preparedTextCacheMaxEntries)
    this.richInlineCache = new RichInlineCache(options.richInlineCacheMaxEntries)
    this.prefix = options.classPrefix ?? 'sm'
    this.classes = getDefaultClassNames(options.classPrefix)
    this.container.classList.add(this.classes.root)
    this.container.dataset['streamingMarkdown'] = 'true'
    this.flush()
  }

  append(chunk: string): void {
    if (chunk.length === 0) return
    this.source += chunk
    this.finalized = false
    this.schedule()
  }

  clearPreparedTextCache(): void {
    this.preparedTextCache.clear()
  }

  clearRichInlineCache(): void {
    this.richInlineCache.clear()
  }

  configurePreparedTextCache(maxEntries: number): void {
    this.preparedTextCache.configure(maxEntries)
  }

  configureRichInlineCache(maxEntries: number): void {
    this.richInlineCache.configure(maxEntries)
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.blockCache.clear()
    this.imageStates.clear()
    this.preparedTextCache.clear()
    this.richInlineCache.clear()
    this.subscribers.clear()
    this.container.replaceChildren()
    this.container.classList.remove(this.classes.root)
    delete this.container.dataset['streamingMarkdown']
  }

  finalize(): void {
    this.finalized = true
    this.schedule()
  }

  flush(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    const start = performance.now()
    const snapshot = parseMarkdown(this.source, {
      allowHtml: this.options.allowHtml,
      finalized: this.finalized,
    })
    this.snapshot = snapshot
    this.lineCount = 0

    const width = this.getWidth()
    const fragment = document.createDocumentFragment()
    for (const block of snapshot.blocks) {
      fragment.append(this.renderCachedBlock(block, width, snapshot))
    }

    this.container.replaceChildren(fragment)

    this.stats = {
      blockCount: snapshot.blocks.length,
      lastRenderDurationMs: performance.now() - start,
      lineCount: this.lineCount,
      sourceLength: this.source.length,
    }
    this.emit({ snapshot, stats: this.stats, type: 'render' })
  }

  getSnapshot(): MarkdownSnapshot {
    return this.snapshot
  }

  getPreparedTextCacheStats(): PreparedTextCacheStats {
    return this.preparedTextCache.getStats()
  }

  getRichInlineCacheStats(): RichInlineCacheStats {
    return this.richInlineCache.getStats()
  }

  getStats(): StreamingMarkdownRenderStats {
    return this.stats
  }

  replace(markdown: string): void {
    this.source = markdown
    this.finalized = false
    this.schedule()
  }

  reset(): void {
    this.source = ''
    this.finalized = false
    this.snapshot = EMPTY_SNAPSHOT
    this.blockCache.clear()
    this.imageStates.clear()
    this.schedule()
  }

  subscribe(subscriber: StreamingMarkdownSubscriber): () => void {
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  private schedule(): void {
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.flush()
    })
  }

  private emit(event: Parameters<StreamingMarkdownSubscriber>[0]): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }

  private getWidth(): number {
    return Math.max(160, Math.floor(this.options.width ?? this.container.clientWidth ?? this.options.defaultWidth ?? 720))
  }

  private renderCachedBlock(block: MarkdownBlock, width: number, snapshot: MarkdownSnapshot): HTMLElement {
    const signature = `${block.raw}\n${width}\n${this.finalized}\n${this.options.allowHtml ?? false}`
    const cached = this.blockCache.get(block.id)
    if (cached !== undefined && cached.signature === signature) return cached.node

    const node = this.renderBlock(block, width, snapshot)
    this.blockCache.set(block.id, { node, signature })
    return node
  }

  private renderBlock(block: MarkdownBlock, width: number, snapshot: MarkdownSnapshot): HTMLElement {
    switch (block.type) {
      case 'paragraph':
        return this.renderInlineBlock(block.children, width, 'paragraph', this.classes.paragraph, snapshot)
      case 'heading':
        return this.renderInlineBlock(
          block.children,
          width,
          `heading${block.depth}`,
          `${this.classes.heading} ${this.classes.heading}-${block.depth}`,
          snapshot,
        )
      case 'code':
        return this.renderCodeBlock(block, width)
      case 'mermaid':
        return this.renderMermaidBlock(block.code, width, snapshot)
      case 'math':
        return this.renderMathBlock(block.value, snapshot)
      case 'html':
        return this.renderHtmlBlock(block.value, snapshot)
      case 'blockquote':
        return this.renderNestedBlock(block.children, width - 18, this.classes.blockquote, snapshot)
      case 'list':
        return this.renderListBlock(block, width, snapshot)
      case 'rule':
        return this.withBlockClass(document.createElement('hr'), this.classes.rule)
      case 'table':
        return this.renderTableBlock(block, width, snapshot)
      case 'image':
        return this.renderImageBlock(block)
      case 'placeholder':
        return this.renderPlaceholder(block.label, block.kind)
    }
  }

  private renderInlineBlock(
    inlines: MarkdownInline[],
    width: number,
    variant: keyof typeof LINE_HEIGHTS | 'paragraph',
    className: string,
    snapshot: MarkdownSnapshot,
  ): HTMLElement {
    const block = this.withBlockClass(document.createElement('div'), className)
    const flow = this.createInlineFlow(inlines, variant === 'paragraph' ? 'body' : variant)
    this.appendInlineLines(block, flow, width, this.getLineHeight(variant), snapshot)
    return block
  }

  private renderCodeBlock(block: CodeBlock, width: number): HTMLElement {
    const root = this.withBlockClass(document.createElement('pre'), this.classes.code)
    if (block.language.length > 0) {
      const meta = document.createElement('div')
      meta.className = this.classes.codeMeta
      meta.textContent = block.language
      root.append(meta)
    }

    const prepared = this.preparedTextCache.get(block.code, DEFAULT_FONTS.code, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, Math.max(80, width - 24), LINE_HEIGHTS.code).lines
    if (lines.length === 0) {
      root.append(this.createCodeLine({ text: '', width: 0 }))
      return root
    }

    for (const line of lines) root.append(this.createCodeLine(line))
    return root
  }

  private createCodeLine(line: Pick<LayoutLine, 'text' | 'width'>): HTMLElement {
    const node = document.createElement('div')
    node.className = this.classes.codeLine
    node.style.height = `${LINE_HEIGHTS.code}px`
    node.style.lineHeight = `${LINE_HEIGHTS.code}px`
    node.style.font = DEFAULT_FONTS.code
    node.style.width = `${Math.ceil(line.width)}px`
    node.textContent = line.text
    this.lineCount++
    return node
  }

  private renderMermaidBlock(code: string, width: number, snapshot: MarkdownSnapshot): HTMLElement {
    const root = this.withBlockClass(document.createElement('div'), this.classes.mermaid)
    root.style.minHeight = '72px'
    this.options.renderMermaid?.(code, root, { finalized: this.finalized, snapshot })
    if (root.childNodes.length === 0) {
      const fallback = this.renderCodeBlock({
        closed: true,
        code,
        endLine: 0,
        id: 'mermaid-fallback',
        language: 'mermaid',
        raw: code,
        startLine: 0,
        type: 'code',
      }, Math.max(160, width - 24))
      root.append(...Array.from(fallback.childNodes))
    }
    return root
  }

  private renderMathBlock(value: string, snapshot: MarkdownSnapshot): HTMLElement {
    const root = this.withBlockClass(document.createElement('div'), this.classes.math)
    root.dataset['display'] = 'true'
    this.options.renderMath?.({ display: true, value }, root, { finalized: this.finalized, snapshot })
    if (root.childNodes.length === 0) root.textContent = value
    return root
  }

  private renderHtmlBlock(value: string, snapshot: MarkdownSnapshot): HTMLElement {
    const root = this.withBlockClass(document.createElement('div'), this.classes.html)
    this.options.renderHtml?.(value, root, { finalized: this.finalized, snapshot })
    if (root.childNodes.length === 0) {
      root.textContent = value
    }
    return root
  }

  private renderNestedBlock(
    blocks: MarkdownBlock[],
    width: number,
    className: string,
    snapshot: MarkdownSnapshot,
  ): HTMLElement {
    const root = this.withBlockClass(document.createElement('div'), className)
    for (const child of blocks) root.append(this.renderBlock(child, width, snapshot))
    return root
  }

  private renderListBlock(block: ListBlock, width: number, snapshot: MarkdownSnapshot): HTMLElement {
    const list = this.withBlockClass(document.createElement('div'), this.classes.list)
    list.setAttribute('role', 'list')

    for (let index = 0; index < block.items.length; index++) {
      const item = block.items[index]!
      const itemNode = document.createElement('div')
      itemNode.className = this.classes.listItem
      itemNode.setAttribute('role', 'listitem')

      const marker = document.createElement('div')
      marker.className = this.classes.listMarker
      marker.style.font = DEFAULT_FONTS.marker
      marker.textContent = item.task
        ? item.checked ? '[x]' : '[ ]'
        : block.ordered ? `${block.start + index}.` : '•'

      const content = document.createElement('div')
      const inline = this.renderInlineBlock(item.text, Math.max(120, width - 36), 'paragraph', this.classes.paragraph, snapshot)
      content.append(...Array.from(inline.childNodes))
      for (const child of item.children) content.append(this.renderBlock(child, Math.max(120, width - 36), snapshot))

      itemNode.append(marker, content)
      list.append(itemNode)
    }

    return list
  }

  private renderTableBlock(block: Extract<MarkdownBlock, { type: 'table' }>, width: number, snapshot: MarkdownSnapshot): HTMLElement {
    const root = this.withBlockClass(document.createElement('div'), this.classes.table)
    const table = document.createElement('table')
    table.style.width = `${Math.max(240, width)}px`
    const thead = document.createElement('thead')
    const tbody = document.createElement('tbody')
    const headRow = document.createElement('tr')

    block.headers.forEach((cell, index) => {
      const th = document.createElement('th')
      th.className = this.classes.tableCell
      this.applyTableAlign(th, block.align[index] ?? null)
      this.appendInlineLines(th, this.createInlineFlow(cell, 'body'), Math.max(80, width / block.headers.length - 18), LINE_HEIGHTS.table, snapshot)
      headRow.append(th)
    })

    thead.append(headRow)

    for (const row of block.rows) {
      const tr = document.createElement('tr')
      row.forEach((cell, index) => {
        const td = document.createElement('td')
        td.className = this.classes.tableCell
        this.applyTableAlign(td, block.align[index] ?? null)
        this.appendInlineLines(td, this.createInlineFlow(cell, 'body'), Math.max(80, width / block.headers.length - 18), LINE_HEIGHTS.table, snapshot)
        tr.append(td)
      })
      tbody.append(tr)
    }

    table.append(thead, tbody)
    root.append(table)
    return root
  }

  private renderImageBlock(block: ImageBlock): HTMLElement {
    const root = this.withBlockClass(document.createElement('figure'), this.classes.image)
    const key = `${block.src}\u0000${block.alt}`
    const state = this.ensureImageState(block, key)

    if (state.status === 'resolved') {
      const img = document.createElement('img')
      img.src = state.image.src
      img.alt = state.image.alt ?? block.alt
      img.width = state.image.width
      img.height = state.image.height
      if (state.image.title !== undefined) img.title = state.image.title
      if (state.image.loading !== undefined) img.loading = state.image.loading
      if (state.image.decoding !== undefined) img.decoding = state.image.decoding
      if (state.image.className !== undefined) img.className = state.image.className
      for (const [name, value] of Object.entries(state.image.attrs ?? {})) img.setAttribute(name, value)
      root.append(img)
      return root
    }

    if (state.status === 'error') {
      const error = document.createElement('div')
      error.className = this.classes.imageError
      error.textContent = block.alt || block.src
      root.append(error)
      return root
    }

    const pending = document.createElement('div')
    pending.className = this.classes.imagePending
    pending.style.aspectRatio = String(this.options.imagePlaceholderRatio ?? 16 / 9)
    root.append(pending)
    return root
  }

  private ensureImageState(block: ImageBlock | ImageInline, key: string): ImageState {
    const existing = this.imageStates.get(key)
    if (existing !== undefined) return existing

    const pending: ImageState = { status: 'pending' }
    this.imageStates.set(key, pending)

    if (this.options.resolveImage === undefined) return pending

    try {
      const value = this.options.resolveImage({
        alt: block.alt,
        index: this.imageStates.size - 1,
        src: block.src,
        title: block.title,
      })

      if (value instanceof Promise) {
        value.then(
          resolved => {
            if (resolved !== null) {
              this.imageStates.set(key, { image: resolved, status: 'resolved' })
              this.blockCache.clear()
              this.schedule()
            }
          },
          error => {
            this.imageStates.set(key, { error, status: 'error' })
            this.blockCache.clear()
            this.options.onImageResolveError?.({ error, src: block.src })
            this.emit({ error, src: block.src, type: 'image-error' })
            this.schedule()
          },
        )
        return pending
      }

      if (value !== null) {
        const resolved: ImageState = { image: value, status: 'resolved' }
        this.imageStates.set(key, resolved)
        return resolved
      }
    } catch (error) {
      const failed: ImageState = { error, status: 'error' }
      this.imageStates.set(key, failed)
      this.options.onImageResolveError?.({ error, src: block.src })
      this.emit({ error, src: block.src, type: 'image-error' })
      return failed
    }

    return pending
  }

  private renderPlaceholder(label: string, kind: string): HTMLElement {
    const root = this.withBlockClass(document.createElement('div'), `${this.classes.placeholder} ${this.classes.placeholder}-${kind}`)
    root.textContent = label
    return root
  }

  private createInlineFlow(inlines: MarkdownInline[], variant: string): InlineRenderItem[] {
    const items: InlineRenderItem[] = []
    this.collectInlineItems(inlines, {
      code: false,
      emphasis: false,
      link: null,
      strike: false,
      strong: false,
    }, variant, items)

    if (items.length === 0) {
      items.push({
        breakMode: 'normal',
        className: '',
        extraWidth: 0,
        font: this.fontForStyle({
          code: false,
          emphasis: false,
          link: null,
          strike: false,
          strong: false,
        }, variant),
        link: null,
        text: '',
      })
    }

    return items
  }

  private collectInlineItems(
    nodes: MarkdownInline[],
    style: InlineStyle,
    variant: string,
    out: InlineRenderItem[],
  ): void {
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          this.pushInlineText(out, node.value, style, variant)
          break
        case 'emphasis':
          this.collectInlineItems(node.children, { ...style, emphasis: true }, variant, out)
          break
        case 'strong':
          this.collectInlineItems(node.children, { ...style, strong: true }, variant, out)
          break
        case 'strike':
          this.collectInlineItems(node.children, { ...style, strike: true }, variant, out)
          break
        case 'code':
          this.pushInlineText(out, node.value, { ...style, code: true }, variant, 'never', this.classes.inlineCode, 12)
          break
        case 'link':
          this.collectInlineItems(node.children, { ...style, link: node }, variant, out)
          break
        case 'image':
          this.pushInlineText(out, node.alt || node.src, style, variant, 'never', this.classes.image, 16)
          break
        case 'math':
          out.push({
            breakMode: 'never',
            className: this.classes.math,
            extraWidth: 14,
            font: DEFAULT_FONTS.inlineCode,
            link: style.link,
            math: { display: false, value: node.value },
            text: node.value.length > 0 ? node.value : 'math',
          })
          break
        case 'html':
          out.push({
            breakMode: 'never',
            className: this.classes.inlineHtml,
            extraWidth: 8,
            font: DEFAULT_FONTS.inlineCode,
            html: node,
            link: style.link,
            text: node.value,
          })
          break
        case 'placeholder':
          out.push({
            breakMode: 'never',
            className: this.classes.placeholder,
            extraWidth: 18,
            font: DEFAULT_FONTS.small,
            link: style.link,
            text: node.label,
          })
          break
      }
    }
  }

  private pushInlineText(
    out: InlineRenderItem[],
    text: string,
    style: InlineStyle,
    variant: string,
    breakMode: 'normal' | 'never' = 'normal',
    extraClassName = '',
    extraWidth = 0,
  ): void {
    if (text.length === 0) return
    const classNames = [
      style.strong ? `${this.prefix}-strong` : '',
      style.emphasis ? `${this.prefix}-emphasis` : '',
      style.strike ? `${this.prefix}-strike` : '',
      style.link !== null ? this.classes.link : '',
      style.code ? this.classes.inlineCode : '',
      extraClassName,
    ].filter(Boolean)

    const previous = out[out.length - 1]
    const font = this.fontForStyle(style, variant)
    const className = classNames.join(' ')
    if (
      previous !== undefined
      && previous.breakMode === breakMode
      && previous.className === className
      && previous.font === font
      && previous.link === style.link
      && previous.extraWidth === extraWidth
      && previous.math === undefined
      && previous.html === undefined
    ) {
      previous.text += text
      return
    }

    out.push({
      breakMode,
      className,
      extraWidth,
      font,
      link: style.link,
      text,
    })
  }

  private appendInlineLines(
    parent: HTMLElement,
    items: InlineRenderItem[],
    maxWidth: number,
    lineHeight: number,
    snapshot: MarkdownSnapshot,
  ): void {
    const preparedItems: RichInlineItem[] = items.map(item => ({
      break: item.breakMode,
      extraWidth: item.extraWidth,
      font: item.font,
      text: item.text,
    }))
    const prepared = this.richInlineCache.get(preparedItems)
    let emitted = 0

    walkRichInlineLineRanges(prepared, Math.max(40, maxWidth), range => {
      const materialized = materializeRichInlineLineRange(prepared, range)
      const line = document.createElement('div')
      line.className = this.classes.line
      line.style.height = `${lineHeight}px`
      line.style.lineHeight = `${lineHeight}px`
      line.style.width = `${Math.ceil(materialized.width)}px`

      for (const fragment of materialized.fragments) {
        const item = items[fragment.itemIndex]!
        const span = item.link !== null
          ? this.createAnchor(item.link)
          : document.createElement('span')
        if (item.className.length > 0) span.className = item.className
        if (fragment.gapBefore > 0) span.style.marginLeft = `${fragment.gapBefore}px`
        span.style.font = item.font
        if (item.math !== undefined) {
          this.options.renderMath?.(item.math, span, { finalized: this.finalized, snapshot })
          if (span.childNodes.length === 0) span.textContent = fragment.text
        } else {
          span.textContent = fragment.text
        }
        line.append(span)
      }

      parent.append(line)
      emitted++
      this.lineCount++
    })

    if (emitted === 0) {
      const line = document.createElement('div')
      line.className = this.classes.line
      line.style.height = `${lineHeight}px`
      line.style.lineHeight = `${lineHeight}px`
      parent.append(line)
      this.lineCount++
    }
  }

  private createAnchor(link: LinkInline): HTMLAnchorElement {
    const anchor = document.createElement('a')
    anchor.href = link.href
    anchor.rel = 'noreferrer'
    anchor.target = '_blank'
    anchor.addEventListener('click', event => {
      this.options.onLinkClick?.(event, link.href)
    })
    return anchor
  }

  private fontForStyle(style: InlineStyle, variant: string): string {
    if (style.code) return DEFAULT_FONTS.inlineCode
    if (variant in DEFAULT_FONTS && variant !== 'body') return DEFAULT_FONTS[variant as keyof FontSet]
    if (style.strong) return DEFAULT_FONTS.bodyStrong
    if (style.emphasis) return DEFAULT_FONTS.bodyEmphasis
    return DEFAULT_FONTS.body
  }

  private getLineHeight(variant: keyof typeof LINE_HEIGHTS | 'paragraph'): number {
    if (variant === 'paragraph') return LINE_HEIGHTS.body
    return LINE_HEIGHTS[variant] ?? LINE_HEIGHTS.body
  }

  private withBlockClass<T extends HTMLElement>(element: T, className: string): T {
    element.className = `${this.classes.block} ${className}`
    return element
  }

  private applyTableAlign(element: HTMLElement, align: TableAlign): void {
    if (align !== null) element.style.textAlign = align
  }
}

export type { DefaultTheme }
