import type {
  BlockquoteBlock,
  CodeBlock,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  ListBlock,
  ListItem,
  MarkdownBlock,
  MarkdownDiagnostic,
  MarkdownInline,
  MarkdownSnapshot,
  MermaidBlock,
  ParseMarkdownOptions,
  PlaceholderBlock,
  RuleBlock,
  TableAlign,
  TableBlock,
} from './types.js'

type ParseContext = Required<Pick<ParseMarkdownOptions, 'allowHtml' | 'finalized'>> & {
  diagnostics: MarkdownDiagnostic[]
  lineOffset: number
}

type ListMarker = {
  checked?: boolean
  content: string
  indent: number
  marker: string
  ordered: boolean
  task: boolean
}

const CODE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_-]+)?[^\n]*$/
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const HTML_BLOCK_START_RE = /^ {0,3}<([A-Za-z][\w:-]*)(?:\s|>|\/>)/
const HTML_BLOCK_END_RE = /<\/([A-Za-z][\w:-]*)>\s*$/
const HR_RE = /^ {0,3}((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const IMAGE_ONLY_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)\s*$/
const LIST_RE = /^(\s*)([-+*]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/

export function parseMarkdown(source: string, options: ParseMarkdownOptions = {}): MarkdownSnapshot {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const diagnostics: MarkdownDiagnostic[] = []
  const context: ParseContext = {
    allowHtml: options.allowHtml ?? false,
    diagnostics,
    finalized: options.finalized ?? false,
    lineOffset: 0,
  }
  const blocks = parseBlocks(lines, 0, lines.length, context)

  return {
    blocks,
    diagnostics,
    finalized: context.finalized,
    source: normalized,
  }
}

function parseBlocks(
  lines: string[],
  start: number,
  end: number,
  context: ParseContext,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let index = start

  while (index < end) {
    const line = lines[index] ?? ''

    if (isBlank(line)) {
      index++
      continue
    }

    const codeFence = line.match(CODE_FENCE_RE)
    if (codeFence !== null) {
      const parsed = parseCodeFence(lines, index, end, codeFence, context)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    if (isMathBlockStart(line)) {
      const parsed = parseMathBlock(lines, index, end, context)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    if (isBlockquoteStart(line)) {
      const parsed = parseBlockquote(lines, index, end, context)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    const listMarker = parseListMarker(line)
    if (listMarker !== null) {
      const parsed = parseList(lines, index, end, listMarker, context)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    if (isTableStart(lines, index, end)) {
      const parsed = parseTable(lines, index, end, context)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading !== null) {
      blocks.push(createHeadingBlock(line, index, heading, context))
      index++
      continue
    }

    if (HR_RE.test(line.trim())) {
      blocks.push(createRuleBlock(line, index, context))
      index++
      continue
    }

    const image = line.trim().match(IMAGE_ONLY_RE)
    if (image !== null) {
      blocks.push(createImageBlock(line, index, image, context))
      index++
      continue
    }

    if (context.allowHtml && HTML_BLOCK_START_RE.test(line)) {
      const parsed = parseHtmlBlock(lines, index, end, context)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    const parsed = parseParagraph(lines, index, end, context)
    blocks.push(parsed.block)
    index = parsed.next
  }

  return blocks
}

function parseCodeFence(
  lines: string[],
  start: number,
  end: number,
  opener: RegExpMatchArray,
  context: ParseContext,
): { block: CodeBlock | MermaidBlock | PlaceholderBlock; next: number } {
  const fence = opener[1]!
  const fenceChar = fence[0]!
  const language = opener[2] ?? ''
  const closeRe = new RegExp(`^ {0,3}${escapeRegExp(fenceChar.repeat(fence.length))}${fenceChar}*\\s*$`)
  const body: string[] = []
  let cursor = start + 1
  let closed = false

  while (cursor < end) {
    const line = lines[cursor] ?? ''
    if (closeRe.test(line)) {
      closed = true
      break
    }
    body.push(line)
    cursor++
  }

  const raw = lines.slice(start, closed ? cursor + 1 : cursor).join('\n')
  const code = body.join('\n')
  const next = closed ? cursor + 1 : cursor

  if (language.toLowerCase() === 'mermaid') {
    if (!closed && !context.finalized) {
      return {
        block: createPlaceholderBlock('mermaid', 'Rendering diagram when the fence closes', raw, start, cursor, false, context),
        next,
      }
    }

    return {
      block: {
        closed,
        code,
        endLine: toAbsoluteLine(closed ? cursor : Math.max(start, cursor - 1), context),
        id: blockId('mermaid', start, raw, context),
        raw,
        startLine: toAbsoluteLine(start, context),
        type: 'mermaid',
      },
      next,
    }
  }

  return {
    block: {
      closed: closed || context.finalized,
      code,
      endLine: toAbsoluteLine(closed ? cursor : Math.max(start, cursor - 1), context),
      id: blockId('code', start, raw, context),
      language,
      raw,
      startLine: toAbsoluteLine(start, context),
      type: 'code',
    },
    next,
  }
}

function parseMathBlock(
  lines: string[],
  start: number,
  end: number,
  context: ParseContext,
): { block: MarkdownBlock; next: number } {
  const first = lines[start] ?? ''
  const afterOpen = first.trim().slice(2)
  const body: string[] = []
  let cursor = start + 1

  if (afterOpen.endsWith('$$') && afterOpen.length > 2) {
    const raw = first
    return {
      block: {
        closed: true,
        endLine: toAbsoluteLine(start, context),
        id: blockId('math', start, raw, context),
        raw,
        startLine: toAbsoluteLine(start, context),
        type: 'math',
        value: afterOpen.slice(0, -2).trim(),
      },
      next: start + 1,
    }
  }

  if (afterOpen.length > 0) body.push(afterOpen)

  while (cursor < end) {
    const line = lines[cursor] ?? ''
    const close = line.trim().indexOf('$$')
    if (close >= 0) {
      body.push(line.slice(0, line.indexOf('$$')))
      const raw = lines.slice(start, cursor + 1).join('\n')
      return {
        block: {
          closed: true,
          endLine: toAbsoluteLine(cursor, context),
          id: blockId('math', start, raw, context),
          raw,
          startLine: toAbsoluteLine(start, context),
          type: 'math',
          value: body.join('\n').trim(),
        },
        next: cursor + 1,
      }
    }
    body.push(line)
    cursor++
  }

  const raw = lines.slice(start, cursor).join('\n')
  if (context.finalized) {
    return {
      block: createParagraphFromText(raw, start, Math.max(start, cursor - 1), context),
      next: cursor,
    }
  }

  return {
    block: createPlaceholderBlock('math', 'Waiting for formula closure', raw, start, Math.max(start, cursor - 1), false, context),
    next: cursor,
  }
}

function parseBlockquote(
  lines: string[],
  start: number,
  end: number,
  context: ParseContext,
): { block: BlockquoteBlock; next: number } {
  const quoteLines: string[] = []
  let cursor = start

  while (cursor < end) {
    const line = lines[cursor] ?? ''
    if (isBlockquoteStart(line)) {
      quoteLines.push(line.replace(/^ {0,3}>\s?/, ''))
      cursor++
      continue
    }
    if (isBlank(line)) {
      quoteLines.push('')
      cursor++
      continue
    }
    break
  }

  const raw = lines.slice(start, cursor).join('\n')
  const nestedContext = {
    ...context,
    lineOffset: context.lineOffset + start,
  }

  return {
    block: {
      children: parseBlocks(quoteLines, 0, quoteLines.length, nestedContext),
      closed: true,
      endLine: toAbsoluteLine(Math.max(start, cursor - 1), context),
      id: blockId('blockquote', start, raw, context),
      raw,
      startLine: toAbsoluteLine(start, context),
      type: 'blockquote',
    },
    next: cursor,
  }
}

function parseList(
  lines: string[],
  start: number,
  end: number,
  firstMarker: ListMarker,
  context: ParseContext,
): { block: ListBlock; next: number } {
  const items: ListItem[] = []
  const rawLines: string[] = []
  let cursor = start
  const ordered = firstMarker.ordered
  const listIndent = firstMarker.indent

  while (cursor < end) {
    const marker = parseListMarker(lines[cursor] ?? '')
    if (marker === null || marker.ordered !== ordered || marker.indent !== listIndent) break

    const itemLines: string[] = [marker.content]
    const itemRaw: string[] = [lines[cursor] ?? '']
    cursor++

    while (cursor < end) {
      const line = lines[cursor] ?? ''
      const nextMarker = parseListMarker(line)
      if (nextMarker !== null && nextMarker.indent === listIndent && nextMarker.ordered === ordered) break
      if (isBlank(line) && shouldEndListItemAfterBlank(lines, cursor + 1, end, listIndent)) break
      if (!isBlank(line) && countLeadingSpaces(line) <= listIndent && isBlockStart(lines, cursor, end, context)) break

      itemRaw.push(line)
      itemLines.push(stripContinuationIndent(line, listIndent + 2))
      cursor++
    }

    rawLines.push(...itemRaw)
    const nestedLines = trimOuterBlankLines(itemLines.slice(1))
    const nestedContext = {
      ...context,
      lineOffset: context.lineOffset + cursor - itemLines.length + 1,
    }

    items.push({
      checked: marker.checked,
      children: nestedLines.length > 0 ? parseBlocks(nestedLines, 0, nestedLines.length, nestedContext) : [],
      raw: itemRaw.join('\n'),
      task: marker.task,
      text: parseInlines(marker.content, context),
    })
  }

  const raw = rawLines.join('\n')

  return {
    block: {
      closed: true,
      endLine: toAbsoluteLine(Math.max(start, cursor - 1), context),
      id: blockId('list', start, raw, context),
      items,
      ordered,
      raw,
      start: ordered ? parseInt(firstMarker.marker, 10) : 1,
      startLine: toAbsoluteLine(start, context),
      type: 'list',
    },
    next: cursor,
  }
}

function parseTable(
  lines: string[],
  start: number,
  end: number,
  context: ParseContext,
): { block: TableBlock; next: number } {
  const headerCells = splitTableRow(lines[start] ?? '')
  const delimiterCells = splitTableRow(lines[start + 1] ?? '')
  const align = delimiterCells.map(parseTableAlign)
  const rows: MarkdownInline[][][] = []
  let cursor = start + 2

  while (cursor < end) {
    const line = lines[cursor] ?? ''
    if (isBlank(line) || isBlockStart(lines, cursor, end, context)) break
    const cells = splitTableRow(line)
    if (cells.length < 2) break
    rows.push(normalizeTableCells(cells, headerCells.length).map(cell => parseInlines(cell, context)))
    cursor++
  }

  const raw = lines.slice(start, cursor).join('\n')

  return {
    block: {
      align: normalizeArray(align, headerCells.length, null),
      closed: true,
      endLine: toAbsoluteLine(Math.max(start, cursor - 1), context),
      headers: normalizeTableCells(headerCells, headerCells.length).map(cell => parseInlines(cell, context)),
      id: blockId('table', start, raw, context),
      raw,
      rows,
      startLine: toAbsoluteLine(start, context),
      type: 'table',
    },
    next: cursor,
  }
}

function parseHtmlBlock(
  lines: string[],
  start: number,
  end: number,
  context: ParseContext,
): { block: HtmlBlock; next: number } {
  const first = lines[start] ?? ''
  const tag = first.match(HTML_BLOCK_START_RE)?.[1]?.toLowerCase()
  let cursor = start + 1
  let closed = first.endsWith('/>') || (tag !== undefined && new RegExp(`</${escapeRegExp(tag)}>`, 'i').test(first))

  while (!closed && cursor < end) {
    const line = lines[cursor] ?? ''
    if (HTML_BLOCK_END_RE.test(line)) closed = true
    cursor++
  }

  const raw = lines.slice(start, closed ? cursor : cursor).join('\n')

  return {
    block: {
      closed,
      endLine: toAbsoluteLine(Math.max(start, cursor - 1), context),
      id: blockId('html', start, raw, context),
      raw,
      startLine: toAbsoluteLine(start, context),
      type: 'html',
      value: raw,
    },
    next: cursor,
  }
}

function parseParagraph(
  lines: string[],
  start: number,
  end: number,
  context: ParseContext,
): { block: MarkdownBlock; next: number } {
  const paragraphLines: string[] = []
  let cursor = start

  while (cursor < end) {
    const line = lines[cursor] ?? ''
    if (isBlank(line)) break
    if (cursor !== start && isBlockStart(lines, cursor, end, context)) break
    paragraphLines.push(line)
    cursor++
  }

  return {
    block: createParagraphFromText(paragraphLines.join('\n'), start, Math.max(start, cursor - 1), context),
    next: cursor,
  }
}

export function parseInlines(input: string, options: ParseMarkdownOptions = {}): MarkdownInline[] {
  const context: ParseContext = {
    allowHtml: options.allowHtml ?? false,
    diagnostics: [],
    finalized: options.finalized ?? false,
    lineOffset: 0,
  }
  return mergeTextNodes(parseInlineRange(input.replace(/\n+/g, ' '), context))
}

function parseInlineRange(input: string, context: ParseContext): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let index = 0
  let textBuffer = ''

  const flushText = (): void => {
    if (textBuffer.length === 0) return
    nodes.push({ type: 'text', value: textBuffer })
    textBuffer = ''
  }

  while (index < input.length) {
    const char = input[index]!
    const rest = input.slice(index)

    if (char === '\\' && index + 1 < input.length) {
      textBuffer += input[index + 1]!
      index += 2
      continue
    }

    if (char === '`') {
      const close = findNext(input, '`', index + 1)
      if (close > index) {
        flushText()
        nodes.push({ type: 'code', value: input.slice(index + 1, close) })
        index = close + 1
        continue
      }
    }

    if (rest.startsWith('![')) {
      const image = readMarkdownLink(input, index + 1)
      if (image !== null) {
        flushText()
        nodes.push({
          alt: image.label,
          src: image.href,
          title: image.title,
          type: 'image',
        })
        index = image.end
        continue
      }
    }

    if (char === '[') {
      const link = readMarkdownLink(input, index)
      if (link !== null) {
        const href = sanitizeHref(link.href)
        if (href !== null) {
          flushText()
          nodes.push({
            children: parseInlineRange(link.label, context),
            href,
            title: link.title,
            type: 'link',
          })
          index = link.end
          continue
        }
      }
    }

    if (rest.startsWith('**')) {
      const close = findNext(input, '**', index + 2)
      if (close > index) {
        flushText()
        nodes.push({ children: parseInlineRange(input.slice(index + 2, close), context), type: 'strong' })
        index = close + 2
        continue
      }
    }

    if (rest.startsWith('~~')) {
      const close = findNext(input, '~~', index + 2)
      if (close > index) {
        flushText()
        nodes.push({ children: parseInlineRange(input.slice(index + 2, close), context), type: 'strike' })
        index = close + 2
        continue
      }
    }

    if (char === '*') {
      const close = findNext(input, '*', index + 1)
      if (close > index) {
        flushText()
        nodes.push({ children: parseInlineRange(input.slice(index + 1, close), context), type: 'emphasis' })
        index = close + 1
        continue
      }
    }

    if (char === '$' && !rest.startsWith('$$')) {
      const close = findNext(input, '$', index + 1)
      if (close > index) {
        flushText()
        nodes.push({ closed: true, type: 'math', value: input.slice(index + 1, close).trim() })
        index = close + 1
        continue
      }
      if (!context.finalized && index >= input.length - 2) {
        flushText()
        nodes.push({ kind: 'math', label: 'formula pending', type: 'placeholder' })
        index = input.length
        continue
      }
    }

    if (char === '<') {
      const close = input.indexOf('>', index + 1)
      if (close > index && context.allowHtml) {
        flushText()
        nodes.push({ type: 'html', value: input.slice(index, close + 1) })
        index = close + 1
        continue
      }
    }

    textBuffer += char
    index++
  }

  flushText()
  return nodes
}

function createHeadingBlock(
  raw: string,
  index: number,
  match: RegExpMatchArray,
  context: ParseContext,
): HeadingBlock {
  const depth = match[1]!.length as 1 | 2 | 3 | 4 | 5 | 6
  const text = match[2] ?? ''
  return {
    children: parseInlines(text, context),
    closed: true,
    depth,
    endLine: toAbsoluteLine(index, context),
    id: blockId('heading', index, raw, context),
    raw,
    startLine: toAbsoluteLine(index, context),
    type: 'heading',
  }
}

function createRuleBlock(raw: string, index: number, context: ParseContext): RuleBlock {
  return {
    closed: true,
    endLine: toAbsoluteLine(index, context),
    id: blockId('rule', index, raw, context),
    raw,
    startLine: toAbsoluteLine(index, context),
    type: 'rule',
  }
}

function createImageBlock(
  raw: string,
  index: number,
  match: RegExpMatchArray,
  context: ParseContext,
): ImageBlock {
  return {
    alt: match[1] ?? '',
    closed: true,
    endLine: toAbsoluteLine(index, context),
    id: blockId('image', index, raw, context),
    raw,
    src: match[2] ?? '',
    startLine: toAbsoluteLine(index, context),
    title: match[3],
    type: 'image',
  }
}

function createParagraphFromText(
  raw: string,
  start: number,
  end: number,
  context: ParseContext,
): { block: MarkdownBlock; next: number }['block'] {
  return {
    children: parseInlines(raw.trim(), context),
    closed: true,
    endLine: toAbsoluteLine(end, context),
    id: blockId('paragraph', start, raw, context),
    raw,
    startLine: toAbsoluteLine(start, context),
    type: 'paragraph',
  }
}

function createPlaceholderBlock(
  kind: 'math' | 'mermaid',
  label: string,
  raw: string,
  start: number,
  end: number,
  closed: boolean,
  context: ParseContext,
): PlaceholderBlock {
  return {
    closed,
    endLine: toAbsoluteLine(end, context),
    id: blockId(`placeholder-${kind}`, start, raw, context),
    kind,
    label,
    raw,
    startLine: toAbsoluteLine(start, context),
    type: 'placeholder',
  }
}

function isBlockStart(lines: string[], index: number, end: number, context: ParseContext): boolean {
  const line = lines[index] ?? ''
  return CODE_FENCE_RE.test(line)
    || isMathBlockStart(line)
    || isBlockquoteStart(line)
    || parseListMarker(line) !== null
    || isTableStart(lines, index, end)
    || HEADING_RE.test(line)
    || HR_RE.test(line.trim())
    || IMAGE_ONLY_RE.test(line.trim())
    || (context.allowHtml && HTML_BLOCK_START_RE.test(line))
}

function parseListMarker(line: string): ListMarker | null {
  const match = line.match(LIST_RE)
  if (match === null) return null
  const marker = match[2]!
  const taskRaw = match[3]
  const task = taskRaw !== undefined
  const checked = task ? /x/i.test(taskRaw) : undefined

  return {
    checked,
    content: match[4] ?? '',
    indent: match[1]!.length,
    marker,
    ordered: /^\d/.test(marker),
    task,
  }
}

function isTableStart(lines: string[], index: number, end: number): boolean {
  if (index + 1 >= end) return false
  const first = lines[index] ?? ''
  const second = lines[index + 1] ?? ''
  return first.includes('|') && TABLE_DELIMITER_RE.test(second)
}

function splitTableRow(line: string): string[] {
  let content = line.trim()
  if (content.startsWith('|')) content = content.slice(1)
  if (content.endsWith('|')) content = content.slice(0, -1)

  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const char of content) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function normalizeTableCells(cells: string[], size: number): string[] {
  return normalizeArray(cells, size, '')
}

function normalizeArray<T>(value: T[], size: number, fill: T): T[] {
  const normalized = value.slice(0, size)
  while (normalized.length < size) normalized.push(fill)
  return normalized
}

function parseTableAlign(cell: string): TableAlign {
  const trimmed = cell.trim()
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

function readMarkdownLink(input: string, start: number): {
  end: number
  href: string
  label: string
  title?: string
} | null {
  const closeLabel = findMatchingBracket(input, start)
  if (closeLabel <= start || input[closeLabel + 1] !== '(') return null
  const closeDest = input.indexOf(')', closeLabel + 2)
  if (closeDest < 0) return null
  const destination = input.slice(closeLabel + 2, closeDest).trim()
  const parsed = parseDestination(destination)
  if (parsed === null) return null

  return {
    end: closeDest + 1,
    href: parsed.href,
    label: input.slice(start + 1, closeLabel),
    title: parsed.title,
  }
}

function parseDestination(value: string): { href: string; title?: string } | null {
  if (value.length === 0) return null
  const titleMatch = value.match(/^(\S+)\s+"([^"]*)"$/)
  if (titleMatch !== null) return { href: titleMatch[1]!, title: titleMatch[2] }
  return { href: value }
}

function sanitizeHref(value: string): string | null {
  const trimmed = value.trim()
  if (/^(#|\/|\.\/|\.\.\/)/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function mergeTextNodes(nodes: MarkdownInline[]): MarkdownInline[] {
  const merged: MarkdownInline[] = []
  for (const node of nodes) {
    const previous = merged[merged.length - 1]
    if (node.type === 'text' && previous?.type === 'text') {
      previous.value += node.value
      continue
    }
    merged.push(node)
  }
  return merged
}

function findMatchingBracket(input: string, start: number): number {
  let escaped = false
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === ']') return index
  }
  return -1
}

function findNext(input: string, needle: string, from: number): number {
  let cursor = from
  while (cursor < input.length) {
    const found = input.indexOf(needle, cursor)
    if (found < 0) return -1
    if (input[found - 1] !== '\\') return found
    cursor = found + needle.length
  }
  return -1
}

function isMathBlockStart(line: string): boolean {
  return line.trim().startsWith('$$')
}

function isBlockquoteStart(line: string): boolean {
  return /^ {0,3}>/.test(line)
}

function stripContinuationIndent(line: string, width: number): string {
  if (isBlank(line)) return ''
  let cursor = 0
  while (cursor < line.length && cursor < width && line[cursor] === ' ') cursor++
  return line.slice(cursor)
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && isBlank(lines[start] ?? '')) start++
  while (end > start && isBlank(lines[end - 1] ?? '')) end--
  return lines.slice(start, end)
}

function countLeadingSpaces(line: string): number {
  let count = 0
  while (count < line.length && line[count] === ' ') count++
  return count
}

function shouldEndListItemAfterBlank(
  lines: string[],
  start: number,
  end: number,
  listIndent: number,
): boolean {
  for (let index = start; index < end; index++) {
    const line = lines[index] ?? ''
    if (isBlank(line)) continue
    return countLeadingSpaces(line) <= listIndent
  }
  return true
}

function blockId(type: string, start: number, raw: string, context: ParseContext): string {
  return `${type}:${toAbsoluteLine(start, context)}:${hashString(raw)}`
}

function toAbsoluteLine(index: number, context: ParseContext): number {
  return context.lineOffset + index + 1
}

function isBlank(line: string): boolean {
  return line.trim().length === 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
