import { describe, it, expect } from 'vitest'
import { buildPageMap, pageRangeFor, spliceHybridPages, visionRunText } from '@/lib/pageMap'
import { chunkText } from '@/lib/chunking'

describe('buildPageMap', () => {
  it('returns empty array for anchor-less text', () => {
    expect(buildPageMap('just some plain body text with no anchors')).toEqual([])
  })

  it('collects anchors ascending by start offset', () => {
    const text = '# Page 1\nalpha\n# Page 2\nbravo\n# Page 3\ncharlie'
    const map = buildPageMap(text)
    expect(map).toEqual([
      { page: 1, start: text.indexOf('# Page 1') },
      { page: 2, start: text.indexOf('# Page 2') },
      { page: 3, start: text.indexOf('# Page 3') },
    ])
  })

  it('preserves non-contiguous absolute page numbers (real vision docs)', () => {
    const text = '# Page 12\nfoo\n# Page 47\nbar\n# Page 103\nbaz'
    const map = buildPageMap(text)
    expect(map.map(a => a.page)).toEqual([12, 47, 103])
  })
})

describe('pageRangeFor', () => {
  const text = '# Page 1\nalpha body\n# Page 2\nbravo body\n# Page 3\ncharlie body'
  const map = buildPageMap(text)
  const p2 = text.indexOf('# Page 2')
  const p3 = text.indexOf('# Page 3')

  it('returns null when the map is empty', () => {
    expect(pageRangeFor([], 0, 10)).toBeNull()
  })

  it('resolves a chunk fully inside page 2 to {2, 2}', () => {
    const start = p2 + 2
    const end = p3 - 1
    expect(pageRangeFor(map, start, end)).toEqual({ pageStart: 2, pageEnd: 2 })
  })

  it('resolves a chunk spanning pages 2 and 3 to {2, 3}', () => {
    const start = p2 + 2
    const end = p3 + 5
    expect(pageRangeFor(map, start, end)).toEqual({ pageStart: 2, pageEnd: 3 })
  })

  it('clamps a chunk before the first anchor to the first page', () => {
    // The first anchor is not at offset 0 here, so start<first is possible
    const shifted = 'preamble text before any anchor\n' + text
    const smap = buildPageMap(shifted)
    const firstStart = shifted.indexOf('# Page 1')
    expect(firstStart).toBeGreaterThan(0)
    expect(pageRangeFor(smap, 0, 5)).toEqual({ pageStart: 1, pageEnd: 1 })
  })

  it('handles non-contiguous page numbers', () => {
    const doc = '# Page 12\nfoo body\n# Page 47\nbar body'
    const dmap = buildPageMap(doc)
    const p47 = doc.indexOf('# Page 47')
    expect(pageRangeFor(dmap, p47 + 2, doc.length)).toEqual({ pageStart: 47, pageEnd: 47 })
    expect(pageRangeFor(dmap, 0, doc.length)).toEqual({ pageStart: 12, pageEnd: 47 })
  })
})

// Audit X1: the hybrid splice used to emit anchors only inside vision runs, so a
// 40-page set with one vision run on p4 stamped every chunk {4,4}.
describe('spliceHybridPages + pageRangeFor (audit X1)', () => {
  const pageTexts = Array.from({ length: 40 }, (_, i) =>
    i === 3 ? 'thin' : `Sheet ${i + 1} body text. `.repeat(150))

  it('stamps the first chunk {1,1} and the last {40,40} when one vision run sits on p4', () => {
    const text = spliceHybridPages(pageTexts, [{ firstPage: 4, lastPage: 4, text: '# Page 4\nVISION NOTES' }])
    const map = buildPageMap(text)
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(10)
    expect(pageRangeFor(map, chunks[0].start, chunks[0].end)).toEqual({ pageStart: 1, pageEnd: 1 })
    const last = chunks[chunks.length - 1]
    expect(pageRangeFor(map, last.start, last.end)).toEqual({ pageStart: 40, pageEnd: 40 })
    expect(map.map(a => a.page)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('keeps the vision run in page order with its provenance header after its anchor', () => {
    const text = spliceHybridPages(['one', 'two', 'three'], [{ firstPage: 2, lastPage: 2, text: '# Page 2\nVISION' }])
    expect(text).toBe('# Page 1\none\n# Page 2\n[page 2 · vision]\nVISION\n# Page 3\nthree')
  })

  it('anchors a vision run whose text came back without a page heading', () => {
    const text = spliceHybridPages(['one', 'two', 'three'], [{ firstPage: 2, lastPage: 3, text: 'NO HEADING' }])
    expect(text).toBe('# Page 1\none\n# Page 2\n[pages 2–3 · vision]\nNO HEADING')
  })
})

describe('visionRunText', () => {
  it('puts the page anchor before the provenance header', () => {
    expect(visionRunText(3, 4, '# Page 3\nbody\n# Page 4\nmore')).toBe('# Page 3\n[pages 3–4 · vision]\nbody\n# Page 4\nmore')
  })
  it('adds the first page anchor when the model omitted it', () => {
    expect(visionRunText(7, 7, 'body')).toBe('# Page 7\n[page 7 · vision]\nbody')
  })
  it('does not duplicate the first page anchor when a preamble line precedes it', () => {
    const out = visionRunText(4, 5, 'Intro\n# Page 4\nbody\n# Page 5\nmore')
    expect(out).toBe('[pages 4–5 · vision]\nIntro\n# Page 4\nbody\n# Page 5\nmore')
    expect(buildPageMap(out).map(a => a.page)).toEqual([4, 5])
  })
})
