// tests/unit/lib/artifacts/toPdf.test.ts
import { describe, it, expect } from 'vitest'
import { toPdf } from '@/lib/artifacts/toPdf'

describe('toPdf', () => {
  it('produces a valid multi-block PDF', async () => {
    const md = ['# Report', 'Para with **bold**.', '## Section', '- a', '- b'].join('\n\n')
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(400)
  })

  it('handles long content across pages without throwing', async () => {
    const md = Array.from({ length: 120 }, (_, i) => `Line ${i} with some wrapped text content here.`).join('\n\n')
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  it('does not throw on smart quotes, dashes, and emoji', async () => {
    const md = '# “Smart” quotes — en–dash, ellipsis…, emoji 🚀\n\nBody with ‘curly’ text.'
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  it('renders an ordered list without throwing', async () => {
    const buf = await toPdf('1. first\n2. second\n3. third')
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  it('renders a markdown link without throwing (URL surfaced as "text (url)")', async () => {
    // The href→"text (url)" transform is asserted deterministically in markdown.test.ts
    // (href capture). pdf-lib FlateDecode-compresses streams, so we can't grep the URL
    // from raw bytes here; assert the renderer consumes the link and produces a valid PDF.
    const buf = await toPdf('See the [docs](https://example.com/guide).')
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(400)
  })

  it('renders a wide table with long cells and many rows (wrap + page-break header repeat)', async () => {
    const header = '| Item | Description | Owner |'
    const sep = '| --- | --- | --- |'
    const rows = Array.from({ length: 60 }, (_, i) =>
      `| ITEM-${i} | A fairly long cell description that should wrap within its column rather than being truncated at forty characters | Responsible Party ${i} |`)
    const buf = await toPdf([header, sep, ...rows].join('\n'))
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })
})
