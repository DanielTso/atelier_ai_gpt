// tests/unit/lib/artifacts/markdown.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '@/lib/artifacts/markdown'

describe('parseMarkdown', () => {
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
})
