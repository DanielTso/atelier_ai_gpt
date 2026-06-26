// tests/unit/lib/artifacts/markdown.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown, mdToPlainText } from '@/lib/artifacts/markdown'

describe('parseMarkdown', () => {
  it('parses inline bold inside list items without leaking raw markers', () => {
    const [list] = parseMarkdown('- bullet with **strong** text')
    if (list.type !== 'list') throw new Error('expected list')
    const runs = list.items[0]!
    expect(runs.some(r => r.bold && r.text === 'strong')).toBe(true)
    expect(runs.map(r => r.text).join('')).not.toContain('*')
  })

  it('parses headings with level', () => {
    const [b] = parseMarkdown('## Scope')
    expect(b).toMatchObject({ type: 'heading', level: 2 })
    expect(b.type === 'heading' && b.inlines[0]!.text).toBe('Scope')
  })

  it('captures inline bold and italic', () => {
    const [b] = parseMarkdown('Plain **bold** and *em* text')
    if (b.type !== 'paragraph') throw new Error('expected paragraph')
    const bold = b.inlines.find(i => i.bold)
    const em = b.inlines.find(i => i.italic)
    expect(bold?.text).toBe('bold')
    expect(em?.text).toBe('em')
  })

  it('parses unordered and ordered lists', () => {
    const [ul] = parseMarkdown('- one\n- two')
    expect(ul).toMatchObject({ type: 'list', ordered: false })
    expect(ul.type === 'list' && ul.items.length).toBe(2)
    const [ol] = parseMarkdown('1. a\n2. b')
    expect(ol).toMatchObject({ type: 'list', ordered: true })
  })

  it('parses a GFM table', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |'
    const [t] = parseMarkdown(md)
    if (t.type !== 'table') throw new Error('expected table')
    expect(t.header.map(c => c[0]!.text)).toEqual(['A', 'B'])
    expect(t.rows[0]!.map(c => c[0]!.text)).toEqual(['1', '2'])
  })

  it('degrades unsupported tokens and never throws', () => {
    expect(() => parseMarkdown('> quote\n\n---\n\n![x](y)')).not.toThrow()
    expect(parseMarkdown('')).toEqual([])
  })

  it('keeps the href on link runs so renderers can surface the destination', () => {
    const [p] = parseMarkdown('See the [docs](https://example.com/guide) here')
    if (p.type !== 'paragraph') throw new Error('expected paragraph')
    const link = p.inlines.find(i => i.href)
    expect(link?.text).toBe('docs')
    expect(link?.href).toBe('https://example.com/guide')
  })

  it('keeps href through inline formatting inside the link', () => {
    const [p] = parseMarkdown('[**bold link**](https://x.test)')
    if (p.type !== 'paragraph') throw new Error('expected paragraph')
    const link = p.inlines.find(i => i.href)
    expect(link?.href).toBe('https://x.test')
    expect(link?.bold).toBe(true)
  })
})

describe('mdToPlainText', () => {
  it('strips heading, bold, italic, and code markers', () => {
    expect(mdToPlainText('## Section A')).toBe('Section A')
    expect(mdToPlainText('This is **bold** and *italic* and `code`')).toBe('This is bold and italic and code')
  })
  it('returns plain strings unchanged', () => {
    expect(mdToPlainText('Total')).toBe('Total')
  })
})
