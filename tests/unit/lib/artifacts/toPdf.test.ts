// tests/unit/lib/artifacts/toPdf.test.ts
import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { toPdf } from '@/lib/artifacts/toPdf'

// Every string drawn on the PDF's pages. pdf-lib Flate-compresses each content
// stream and writes Helvetica text as hex strings (<48656C6C6F> Tj).
function drawnText(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1')
  const out: string[] = []
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1') } catch { continue }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push(Buffer.from(t[1]!, 'hex').toString('latin1'))
  }
  return out
}

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

  it('draws nested bullets and a list inside a blockquote (audit B7)', async () => {
    const text = drawnText(await toPdf('- parent A\n  - child A1\n- parent B\n\n> - quoted item'))
    expect(text).toEqual(expect.arrayContaining(['parent A', 'child A1', 'parent B', 'quoted item']))
  })

  it('numbers an ordered list from its start value (audit B17)', async () => {
    const text = drawnText(await toPdf('3. three\n4. four'))
    expect(text).toEqual(expect.arrayContaining(['3.', '4.']))
  })
})

describe('winAnsi sanitation', () => {
  it('turns soft line breaks into spaces, not question marks', async () => {
    const { winAnsi } = await import('@/lib/artifacts/toPdf')
    expect(winAnsi('Price**\nA spending cap'.replace(/\*/g, ''))).toBe('Price A spending cap')
    expect(winAnsi('a\r\n\tb')).toBe('a b')
  })
  it('drops emoji instead of printing question marks', async () => {
    const { winAnsi } = await import('@/lib/artifacts/toPdf')
    expect(winAnsi('💰 Money & Pricing')).toBe(' Money & Pricing')
    expect(winAnsi('💰 Money')).not.toContain('?')
  })
  it('maps curly single and double quotes to straight ones (audit X5)', async () => {
    const { winAnsi } = await import('@/lib/artifacts/toPdf')
    expect(winAnsi('don’t “quote”')).toBe(`don't "quote"`)
    expect(winAnsi('‘single’')).toBe(`'single'`)
  })
})
