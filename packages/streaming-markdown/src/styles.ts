import type { DefaultTheme, StreamingMarkdownClassNames } from './types.js'

export function getDefaultClassNames(prefix = 'sm'): StreamingMarkdownClassNames {
  return {
    block: `${prefix}-block`,
    blockquote: `${prefix}-blockquote`,
    code: `${prefix}-code`,
    codeLine: `${prefix}-code-line`,
    codeMeta: `${prefix}-code-meta`,
    heading: `${prefix}-heading`,
    html: `${prefix}-html`,
    image: `${prefix}-image`,
    imageError: `${prefix}-image-error`,
    imagePending: `${prefix}-image-pending`,
    inlineCode: `${prefix}-inline-code`,
    inlineHtml: `${prefix}-inline-html`,
    line: `${prefix}-line`,
    link: `${prefix}-link`,
    list: `${prefix}-list`,
    listItem: `${prefix}-list-item`,
    listMarker: `${prefix}-list-marker`,
    math: `${prefix}-math`,
    mermaid: `${prefix}-mermaid`,
    paragraph: `${prefix}-paragraph`,
    placeholder: `${prefix}-placeholder`,
    root: `${prefix}-root`,
    rule: `${prefix}-rule`,
    table: `${prefix}-table`,
    tableCell: `${prefix}-table-cell`,
  }
}

export function getDefaultThemeVars(theme: DefaultTheme = 'light'): Record<string, string> {
  const isDark = theme === 'dark'
  return {
    '--sm-bg': isDark ? '#111318' : '#ffffff',
    '--sm-border': isDark ? '#303640' : '#d9dde4',
    '--sm-code-bg': isDark ? '#181c22' : '#f5f7fa',
    '--sm-code-text': isDark ? '#e8edf5' : '#242a31',
    '--sm-faint': isDark ? '#8d97a8' : '#697386',
    '--sm-link': isDark ? '#8ab4ff' : '#2459d6',
    '--sm-placeholder': isDark ? '#2b313a' : '#eef1f5',
    '--sm-placeholder-glint': isDark ? '#3b4350' : '#f8fafc',
    '--sm-quote': isDark ? '#39414d' : '#d4dbe6',
    '--sm-table-stripe': isDark ? '#151922' : '#f8fafc',
    '--sm-text': isDark ? '#e9edf3' : '#171a1f',
  }
}

export function getDefaultStyleSheet(prefix = 'sm'): string {
  const c = getDefaultClassNames(prefix)

  return `
.${c.root} {
  background: var(--sm-bg, transparent);
  color: var(--sm-text, inherit);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.45;
}

.${c.block} {
  box-sizing: border-box;
  margin: 0 0 12px;
}

.${c.paragraph} {
  margin-block-end: 10px;
}

.${c.heading} {
  font-weight: 700;
  margin-block: 18px 10px;
}

.${c.line}, .${c.codeLine} {
  box-sizing: border-box;
  min-width: 0;
  overflow: visible;
  white-space: pre;
}

.${c.link} {
  color: var(--sm-link, currentColor);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.${prefix}-strike {
  text-decoration: line-through;
}

.${c.inlineCode}, .${c.math} {
  background: var(--sm-code-bg, rgba(127, 127, 127, 0.12));
  border: 1px solid var(--sm-border, rgba(127, 127, 127, 0.18));
  border-radius: 5px;
  color: var(--sm-code-text, currentColor);
  padding: 1px 5px;
}

.${c.inlineHtml} {
  color: var(--sm-faint, currentColor);
  font-family: "SF Mono", ui-monospace, Menlo, Monaco, monospace;
}

.${c.code} {
  background: var(--sm-code-bg, rgba(127, 127, 127, 0.12));
  border: 1px solid var(--sm-border, rgba(127, 127, 127, 0.18));
  border-radius: 8px;
  color: var(--sm-code-text, currentColor);
  overflow-x: auto;
  padding: 10px 12px;
}

.${c.codeMeta} {
  color: var(--sm-faint, currentColor);
  font: 600 11px "SF Mono", ui-monospace, Menlo, Monaco, monospace;
  margin-block-end: 8px;
  text-transform: uppercase;
}

.${c.blockquote} {
  border-inline-start: 3px solid var(--sm-quote, rgba(127, 127, 127, 0.25));
  color: var(--sm-text, inherit);
  padding-inline-start: 14px;
}

.${c.list} {
  margin-block-end: 10px;
}

.${c.listItem} {
  column-gap: 8px;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  margin-block-end: 6px;
}

.${c.listMarker} {
  color: var(--sm-faint, currentColor);
  font: 600 13px "SF Mono", ui-monospace, Menlo, Monaco, monospace;
  min-width: 2ch;
  padding-block-start: 2px;
  text-align: end;
}

.${c.rule} {
  border: 0;
  border-block-start: 1px solid var(--sm-border, rgba(127, 127, 127, 0.2));
  height: 1px;
  margin-block: 18px;
}

.${c.table} {
  border-collapse: collapse;
  display: block;
  margin-block-end: 12px;
  max-width: 100%;
  overflow-x: auto;
}

.${c.table} table {
  border-collapse: collapse;
  min-width: 100%;
}

.${c.tableCell} {
  border: 1px solid var(--sm-border, rgba(127, 127, 127, 0.18));
  padding: 7px 9px;
  vertical-align: top;
}

.${c.table} tbody tr:nth-child(odd) {
  background: var(--sm-table-stripe, rgba(127, 127, 127, 0.06));
}

.${c.image} {
  margin-block-end: 12px;
}

.${c.image} img {
  display: block;
  height: auto;
  max-width: 100%;
}

.${c.imagePending}, .${c.placeholder} {
  background:
    linear-gradient(
      90deg,
      var(--sm-placeholder, rgba(127, 127, 127, 0.12)) 0%,
      var(--sm-placeholder-glint, rgba(255, 255, 255, 0.52)) 46%,
      var(--sm-placeholder, rgba(127, 127, 127, 0.12)) 100%
    );
  background-size: 220% 100%;
  border: 1px solid var(--sm-border, rgba(127, 127, 127, 0.16));
  border-radius: 8px;
  color: var(--sm-faint, currentColor);
  min-height: 44px;
  animation: ${prefix}-placeholder-sweep 1.35s ease-in-out infinite;
}

.${c.placeholder} {
  align-items: center;
  display: flex;
  font-size: 13px;
  padding-inline: 12px;
}

.${c.imageError} {
  border: 1px solid var(--sm-border, rgba(127, 127, 127, 0.18));
  border-radius: 8px;
  color: var(--sm-faint, currentColor);
  padding: 10px 12px;
}

.${c.mermaid}, .${c.html} {
  border: 1px solid var(--sm-border, rgba(127, 127, 127, 0.18));
  border-radius: 8px;
  padding: 12px;
}

@keyframes ${prefix}-placeholder-sweep {
  0% { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}
`.trim()
}
