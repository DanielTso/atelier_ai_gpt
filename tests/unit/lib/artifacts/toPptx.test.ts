// tests/unit/lib/artifacts/toPptx.test.ts
import { describe, it, expect } from 'vitest'
import { toPptx, paginate, MAX_LINES_PER_SLIDE } from '@/lib/artifacts/toPptx'

describe('paginate', () => {
  it('returns one group when within the cap', () => {
    expect(paginate([1, 2, 3], 5)).toEqual([[1, 2, 3]])
  })
  it('splits into ceil(n/size) groups at the boundary', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('returns a single empty group for empty input', () => {
    expect(paginate([], 5)).toEqual([[]])
  })
  it('exposes a positive default line cap', () => {
    expect(MAX_LINES_PER_SLIDE).toBeGreaterThan(0)
  })
})

describe('toPptx', () => {
  it('paginates an overflowing slide into continuation slides', async () => {
    const items = Array.from({ length: MAX_LINES_PER_SLIDE * 2 + 3 }, (_, i) => `- item ${i}`).join('\n')
    const buf = await toPptx(`# Big Slide\n\n${items}`)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('splits slides on H1 and produces a valid pptx', async () => {
    const md = ['# Title One', 'body a', '# Title Two', '- bullet'].join('\n\n')
    const buf = await toPptx(md)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('produces a deck for content with no H1', async () => {
    const buf = await toPptx('just a paragraph')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('renders an ordered list without throwing', async () => {
    const buf = await toPptx('# Steps\n\n1. one\n2. two')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
