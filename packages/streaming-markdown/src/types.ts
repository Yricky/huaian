export type MarkdownInline =
  | TextInline
  | EmphasisInline
  | StrongInline
  | StrikeInline
  | CodeInline
  | LinkInline
  | ImageInline
  | MathInline
  | HtmlInline
  | PlaceholderInline

export type TextInline = {
  type: 'text'
  value: string
}

export type EmphasisInline = {
  children: MarkdownInline[]
  type: 'emphasis'
}

export type StrongInline = {
  children: MarkdownInline[]
  type: 'strong'
}

export type StrikeInline = {
  children: MarkdownInline[]
  type: 'strike'
}

export type CodeInline = {
  type: 'code'
  value: string
}

export type LinkInline = {
  children: MarkdownInline[]
  href: string
  title?: string
  type: 'link'
}

export type ImageInline = {
  alt: string
  src: string
  title?: string
  type: 'image'
}

export type MathInline = {
  closed: boolean
  type: 'math'
  value: string
}

export type HtmlInline = {
  type: 'html'
  value: string
}

export type PlaceholderInline = {
  kind: 'math'
  label: string
  type: 'placeholder'
}

export type MarkdownBlock =
  | ParagraphBlock
  | HeadingBlock
  | CodeBlock
  | MermaidBlock
  | MathBlock
  | HtmlBlock
  | BlockquoteBlock
  | ListBlock
  | RuleBlock
  | TableBlock
  | ImageBlock
  | PlaceholderBlock

export type MarkdownBlockBase = {
  closed: boolean
  endLine: number
  id: string
  raw: string
  startLine: number
}

export type ParagraphBlock = MarkdownBlockBase & {
  children: MarkdownInline[]
  type: 'paragraph'
}

export type HeadingBlock = MarkdownBlockBase & {
  children: MarkdownInline[]
  depth: 1 | 2 | 3 | 4 | 5 | 6
  type: 'heading'
}

export type CodeBlock = MarkdownBlockBase & {
  code: string
  language: string
  type: 'code'
}

export type MermaidBlock = MarkdownBlockBase & {
  code: string
  type: 'mermaid'
}

export type MathBlock = MarkdownBlockBase & {
  type: 'math'
  value: string
}

export type HtmlBlock = MarkdownBlockBase & {
  type: 'html'
  value: string
}

export type BlockquoteBlock = MarkdownBlockBase & {
  children: MarkdownBlock[]
  type: 'blockquote'
}

export type ListBlock = MarkdownBlockBase & {
  items: ListItem[]
  ordered: boolean
  start: number
  type: 'list'
}

export type ListItem = {
  checked?: boolean
  children: MarkdownBlock[]
  raw: string
  task: boolean
  text: MarkdownInline[]
}

export type RuleBlock = MarkdownBlockBase & {
  type: 'rule'
}

export type TableAlign = 'left' | 'center' | 'right' | null

export type TableBlock = MarkdownBlockBase & {
  align: TableAlign[]
  headers: MarkdownInline[][]
  rows: MarkdownInline[][][]
  type: 'table'
}

export type ImageBlock = MarkdownBlockBase & {
  alt: string
  src: string
  title?: string
  type: 'image'
}

export type PlaceholderBlock = MarkdownBlockBase & {
  kind: 'math' | 'mermaid'
  label: string
  type: 'placeholder'
}

export type MarkdownDiagnostic = {
  code: string
  line: number
  message: string
  severity: 'info' | 'warning'
}

export type MarkdownSnapshot = {
  blocks: MarkdownBlock[]
  diagnostics: MarkdownDiagnostic[]
  finalized: boolean
  source: string
}

export type ParseMarkdownOptions = {
  allowHtml?: boolean
  finalized?: boolean
}

export type StreamingMarkdownClassNames = {
  block: string
  blockquote: string
  code: string
  codeLine: string
  codeMeta: string
  heading: string
  html: string
  image: string
  imageError: string
  imagePending: string
  inlineCode: string
  inlineHtml: string
  line: string
  link: string
  list: string
  listItem: string
  listMarker: string
  math: string
  mermaid: string
  paragraph: string
  placeholder: string
  root: string
  rule: string
  table: string
  tableCell: string
}

export type DefaultTheme = 'light' | 'dark'

export type ResolvedImage = {
  alt?: string
  attrs?: Record<string, string>
  className?: string
  decoding?: 'sync' | 'async' | 'auto'
  height: number
  loading?: 'eager' | 'lazy'
  src: string
  title?: string
  width: number
}

export type ResolveImageRequest = {
  alt: string
  index: number
  src: string
  title?: string
}

export type ResolveImage = (
  request: ResolveImageRequest,
) => Promise<ResolvedImage | null> | ResolvedImage | null

export type StreamingMarkdownRenderStats = {
  blockCount: number
  lastRenderDurationMs: number
  lineCount: number
  sourceLength: number
}

export type PreparedTextCacheStats = {
  entries: number
  maxEntries: number
}

export type RichInlineCacheStats = {
  entries: number
  maxEntries: number
}

export type StreamingMarkdownEvent =
  | {
      snapshot: MarkdownSnapshot
      stats: StreamingMarkdownRenderStats
      type: 'render'
    }
  | {
      error: unknown
      src: string
      type: 'image-error'
    }

export type StreamingMarkdownSubscriber = (event: StreamingMarkdownEvent) => void

export type RenderHookContext = {
  finalized: boolean
  snapshot: MarkdownSnapshot
}

export type StreamingMarkdownOptions = {
  allowHtml?: boolean
  classPrefix?: string
  defaultWidth?: number
  imagePlaceholderRatio?: number
  lineGap?: number
  onImageResolveError?: (event: { error: unknown; src: string }) => void
  onLinkClick?: (event: MouseEvent, href: string) => void
  renderHtml?: (html: string, element: HTMLElement, context: RenderHookContext) => void
  renderMath?: (
    math: { display: boolean; value: string },
    element: HTMLElement,
    context: RenderHookContext,
  ) => void
  renderMermaid?: (code: string, element: HTMLElement, context: RenderHookContext) => void
  preparedTextCacheMaxEntries?: number
  richInlineCacheMaxEntries?: number
  resolveImage?: ResolveImage
  width?: number
}

export type StreamingMarkdownRenderer = {
  append(chunk: string): void
  clearPreparedTextCache(): void
  clearRichInlineCache(): void
  configurePreparedTextCache(maxEntries: number): void
  configureRichInlineCache(maxEntries: number): void
  destroy(): void
  finalize(): void
  flush(): void
  getPreparedTextCacheStats(): PreparedTextCacheStats
  getRichInlineCacheStats(): RichInlineCacheStats
  getSnapshot(): MarkdownSnapshot
  getStats(): StreamingMarkdownRenderStats
  replace(markdown: string): void
  reset(): void
  subscribe(subscriber: StreamingMarkdownSubscriber): () => void
}
