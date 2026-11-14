// tests/unit/lib/artifacts/toDocx.test.ts
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { toDocx } from '@/lib/artifacts/toDocx'

async function documentXml(md: string): Promise<string> {
  const zip = await JSZip.loadAsync(await toDocx(md))
  return zip.file('word/document.xml')!.async('string')
}

// The <w:p> paragraph that contains `needle`, so a test can read its numbering.
function paragraphWith(xml: string, needle: string): string {
  const p = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).find(para => para.includes(`>${needle}<`))
  if (!p) throw new Error(`no paragraph contains "${needle}"`)
  return p
}
const numId = (para: string) => para.match(/<w:numId w:val="(\d+)"/)?.[1]
const ilvl = (para: string) => para.match(/<w:ilvl w:val="(\d+)"/)?.[1]

describe('toDocx', () => {
  it('renders headings, bold, lists, and tables without throwing', async () => {
    const md = [
      '# Scope of Work',
      '',
      'Intro with **bold** text.',
      '',
      '## Items',
      '- first',
      '- second',
      '',
      '| Task | Days |',
      '| - | - |',
      '| Mobilize | 3 |',
    ].join('\n')
    const buf = await toDocx(md)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('produces a valid file for empty input', async () => {
    const buf = await toDocx('')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('renders a markdown link as a hyperlink without throwing', async () => {
    const buf = await toDocx('See the [docs](https://example.com) for details.')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders an ordered list without throwing', async () => {
    const buf = await toDocx('1. first\n2. second\n3. third')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('keeps nested bullets and a list inside a blockquote, indented by level (audit B7)', async () => {
    const xml = await documentXml('- parent A\n  - child A1\n- parent B\n\n> - quoted item')
    expect(ilvl(paragraphWith(xml, 'parent A'))).toBe('0')
    expect(ilvl(paragraphWith(xml, 'child A1'))).toBe('1')
    expect(xml).toContain('>quoted item<')
  })

  it('gives each ordered list its own numbering so both start at 1 (audit B17)', async () => {
    const xml = await documentXml('1. first a\n2. first b\n\nBetween.\n\n1. second a\n2. second b')
    const a = numId(paragraphWith(xml, 'first a'))
    expect(a).toBeDefined()
    expect(numId(paragraphWith(xml, 'first b'))).toBe(a)
    expect(numId(paragraphWith(xml, 'second a'))).toBeDefined()
    expect(numId(paragraphWith(xml, 'second a'))).not.toBe(a)
  })

  it('gives every ordered list its own abstract numbering, and the parent keeps its numId after a sublist', async () => {
    const zip = await JSZip.loadAsync(await toDocx('1. one\n2. two\n   1. sub a\n   2. sub b\n3. three\n\nBetween.\n\n1. again'))
    const xml = await zip.file('word/document.xml')!.async('string')
    const numbering = await zip.file('word/numbering.xml')!.async('string')
    // numId -> abstractNumId, from each <w:num> in numbering.xml
    const abstractOf = new Map([...numbering.matchAll(/<w:num w:numId="(\d+)"><w:abstractNumId w:val="(\d+)"\/>/g)].map(m => [m[1]!, m[2]!]))
    const parent = numId(paragraphWith(xml, 'one'))!
    const sub = numId(paragraphWith(xml, 'sub a'))!
    const later = numId(paragraphWith(xml, 'again'))!
    expect(numId(paragraphWith(xml, 'three'))).toBe(parent)
    expect(numId(paragraphWith(xml, 'sub b'))).toBe(sub)
    const abstracts = [parent, sub, later].map(id => abstractOf.get(id))
    expect(abstracts.every(Boolean)).toBe(true)
    expect(new Set(abstracts).size).toBe(3)
  })

  it('keeps every line of a code block (audit B17)', async () => {
    const xml = await documentXml('```\nline one\nline two\nline three\n```')
    for (const line of ['line one', 'line two', 'line three']) expect(xml).toContain(`>${line}<`)
    expect(xml.match(/<w:br\/>/g)?.length).toBe(2)
  })
})
