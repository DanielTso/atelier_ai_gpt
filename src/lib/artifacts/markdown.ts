// src/lib/artifacts/markdown.ts
import { marked, type Token, type Tokens } from 'marked'

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }

// marked's lexer HTML-escapes the .text of inline text/codespan tokens (& < > " ')
// — decode here, at the single choke point, so every binary renderer (pdf/docx/
// pptx/xlsx plain text) emits real characters instead of &#39;/&amp;/&quot;.
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** One list entry, flattened in document order. `level` is the nesting depth
 *  (0 = top level; a sub-bullet is 1, and so on) so every renderer can indent
 *  it. `ordered`/`number` describe the item's OWN list (a nested list can
 *  differ from its parent); `number` honours the list's start value, and
 *  `startsList` marks the first item of each list or sublist (DOCX gives
 *  every ordered list its own numbering instance from it). */
export type ListItem = { inlines: Inline[]; level: number; ordered: boolean; number: number; startsList: boolean }

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; text: string }

// Flatten marked inline tokens into styled runs, tracking bold/italic/code context.
function inlines(tokens: Token[] | undefined, ctx: { bold?: boolean; italic?: boolean } = {}): Inline[] {
  const out: Inline[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong': out.push(...inlines((t as Tokens.Strong).tokens, { ...ctx, bold: true })); break
      case 'em': out.push(...inlines((t as Tokens.Em).tokens, { ...ctx, italic: true })); break
      case 'codespan': out.push({ text: decodeEntities((t as Tokens.Codespan).text), code: true }); break
      case 'link': {
        // Keep the destination on each emitted run so binary renderers (docx/pdf/pptx)
        // can surface it — previously href was dropped and links became bare text.
        const link = t as Tokens.Link
        for (const child of inlines(link.tokens, ctx)) out.push({ ...child, href: child.href ?? link.href })
        break
      }
      case 'br': out.push({ text: '\n' }); break
      case 'escape': out.push({ text: (t as Tokens.Escape).text, ...ctx }); break
      default: {
        // marked nests inline content of list items (and some loose text) under a
        // `text` token that carries its own `.tokens` — recurse so bold/italic inside
        // list items is parsed instead of leaking raw `**`/`*` markers.
        const nested = (t as { tokens?: Token[] }).tokens
        if (Array.isArray(nested) && nested.length) { out.push(...inlines(nested, ctx)); break }
        const text = 'text' in t ? decodeEntities(String((t as { text: unknown }).text)) : ''
        if (text) out.push({ text, ...ctx })
      }
    }
  }
  return out.length ? out : [{ text: '' }]
}

/** Strip Markdown to plain text — for surfaces that can't render it (e.g. Excel cells). */
export function mdToPlainText(md: string): string {
  const flat = (inls: Inline[]) => inls.map(i => i.text).join('')
  const out = parseMarkdown(md).map(b => {
    if (b.type === 'heading' || b.type === 'paragraph') return flat(b.inlines)
    if (b.type === 'list') return b.items.map(it => '  '.repeat(it.level) + flat(it.inlines)).join('\n')
    if (b.type === 'table') return [b.header, ...b.rows].map(r => r.map(flat).join(' ')).join('\n')
    return b.text
  }).join('\n').trim()
  return out || md
}

function cellInlines(cell: Tokens.TableCell): Inline[] {
  return inlines(cell.tokens)
}

// Flatten a list and every list nested inside its items. marked puts a nested
// list as a `list` token among the item's tokens; inlines() would drop it (it
// has neither .tokens nor .text), so split it out and recurse one level deeper.
function listItems(list: Tokens.List, level: number): ListItem[] {
  const start = list.ordered && typeof list.start === 'number' ? list.start : 1
  const out: ListItem[] = []
  list.items.forEach((it, i) => {
    const own = it.tokens.filter(t => t.type !== 'list')
    out.push({ inlines: inlines(own), level, ordered: list.ordered, number: start + i, startsList: i === 0 })
    for (const t of it.tokens) if (t.type === 'list') out.push(...listItems(t as Tokens.List, level + 1))
  })
  return out
}

export function parseMarkdown(md: string): Block[] {
  return parseTokens(marked.lexer(md ?? ''))
}

function parseTokens(tokens: Token[]): Block[] {
  const blocks: Block[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        blocks.push({ type: 'heading', level: (t as Tokens.Heading).depth, inlines: inlines((t as Tokens.Heading).tokens) })
        break
      case 'paragraph':
        blocks.push({ type: 'paragraph', inlines: inlines((t as Tokens.Paragraph).tokens) })
        break
      case 'list': {
        const list = t as Tokens.List
        blocks.push({ type: 'list', ordered: list.ordered, items: listItems(list, 0) })
        break
      }
      case 'table': {
        const table = t as Tokens.Table
        blocks.push({
          type: 'table',
          header: table.header.map(cellInlines),
          rows: table.rows.map(row => row.map(cellInlines)),
        })
        break
      }
      case 'code':
        blocks.push({ type: 'code', text: (t as Tokens.Code).text })
        break
      case 'space':
      case 'hr':
        break
      case 'blockquote': {
        // A quote holds block tokens (paragraphs, lists, tables…): parse them as
        // blocks so a list inside a quote keeps its items.
        blocks.push(...parseTokens((t as Tokens.Blockquote).tokens))
        break
      }
      default: {
        const text = 'text' in t ? String((t as { text: unknown }).text) : ''
        if (text.trim()) blocks.push({ type: 'paragraph', inlines: [{ text }] })
      }
    }
  }
  return blocks
}
