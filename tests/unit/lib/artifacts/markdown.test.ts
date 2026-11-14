// tests/unit/lib/artifacts/markdown.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown, mdToPlainText } from '@/lib/artifacts/markdown'

describe('parseMarkdown', () => {
  it('parses inline bold inside list items without leaking raw markers', () => {
    const [list] = parseMarkdown('- bullet with **strong** text')
    if (list.type !== 'list') throw new Error('expected list')
    const runs = list.items[0]!.inlines
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

describe('nested lists (audit B7)', () => {
  const text = (inls: { text: string }[]) => inls.map(i => i.text).join('')

  it('keeps nested bullets as items with a level, in document order', () => {
    const [list] = parseMarkdown('- parent A\n  - child A1\n  - child A2\n- parent B')
    if (list.type !== 'list') throw new Error('expected list')
    expect(list.items.map(it => [text(it.inlines), it.level])).toEqual([
      ['parent A', 0], ['child A1', 1], ['child A2', 1], ['parent B', 0],
    ])
  })

  it('numbers each ordered list from its own start, including a nested one', () => {
    const [list] = parseMarkdown('3. three\n4. four\n   1. sub one\n   2. sub two')
    if (list.type !== 'list') throw new Error('expected list')
    expect(list.items.map(it => [text(it.inlines), it.level, it.number, it.startsList])).toEqual([
      ['three', 0, 3, true], ['four', 0, 4, false], ['sub one', 1, 1, true], ['sub two', 1, 2, false],
    ])
  })

  it('keeps a list inside a blockquote', () => {
    const blocks = parseMarkdown('> quote line\n> - item in quote')
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'list'])
    const list = blocks[1]!
    if (list.type !== 'list') throw new Error('expected list')
    expect(text(list.items[0]!.inlines)).toBe('item in quote')
  })

  it('keeps nested items in plain text, indented by level', () => {
    expect(mdToPlainText('- parent\n  - child')).toBe('parent\n  child')
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

describe('HTML entity decoding (marked escapes token text)', () => {
  it('decodes apostrophes, ampersands, and quotes back to real characters', () => {
    const [p] = parseMarkdown(`You'll hear GMP & "pay app" a lot`)
    if (p.type !== 'paragraph') throw new Error('expected paragraph')
    const text = p.inlines.map(i => i.text).join('')
    expect(text).toBe(`You'll hear GMP & "pay app" a lot`)
    expect(text).not.toContain('&#39;')
    expect(text).not.toContain('&amp;')
    expect(text).not.toContain('&quot;')
  })
  it('decodes entities inside code spans and plain-text output', () => {
    expect(mdToPlainText('`a && b`')).toBe('a && b')
    expect(mdToPlainText(`it's "quoted" & fine`)).toBe(`it's "quoted" & fine`)
  })
})
