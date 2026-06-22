// src/lib/artifacts/markdown.ts
import { marked, type Token, type Tokens } from 'marked'

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean }
export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; text: string }

// Flatten marked inline tokens into styled runs, tracking bold/italic/code context.
function inlines(tokens: Token[] | undefined, ctx: { bold?: boolean; italic?: boolean } = {}): Inline[] {
  const out: Inline[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong': out.push(...inlines((t as Tokens.Strong).tokens, { ...ctx, bold: true })); break
      case 'em': out.push(...inlines((t as Tokens.Em).tokens, { ...ctx, italic: true })); break
      case 'codespan': out.push({ text: (t as Tokens.Codespan).text, code: true }); break
      case 'link': out.push(...inlines((t as Tokens.Link).tokens, ctx)); break
      case 'br': out.push({ text: '\n' }); break
      case 'escape': out.push({ text: (t as Tokens.Escape).text, ...ctx }); break
      default: {
        const text = 'text' in t ? String((t as { text: unknown }).text) : ''
        if (text) out.push({ text, ...ctx })
      }
    }
  }
  return out.length ? out : [{ text: '' }]
}

function cellInlines(cell: Tokens.TableCell): Inline[] {
  return inlines(cell.tokens)
}

export function parseMarkdown(md: string): Block[] {
  const tokens = marked.lexer(md ?? '')
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
        blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(it => inlines(it.tokens)) })
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
        blocks.push({ type: 'paragraph', inlines: inlines((t as Tokens.Blockquote).tokens) })
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
