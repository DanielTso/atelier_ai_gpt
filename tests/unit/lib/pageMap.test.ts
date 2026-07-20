import { describe, it, expect } from 'vitest'
import { buildPageMap, pageRangeFor } from '@/lib/pageMap'

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
