import { describe, it, expect } from 'vitest'
import { sliceWindow } from '@/lib/documents/windowing'

const paged = ['# Page 1', 'alpha'.repeat(10), '# Page 2', 'bravo'.repeat(10), '# Page 3', 'charlie'.repeat(10)].join('\n')

describe('sliceWindow', () => {
  it('reads from the start by default and reports anchors', () => {
    const w = sliceWindow(paged, { maxChars: 10_000 })
    expect(w.startOffset).toBe(0)
    expect(w.nextOffset).toBeNull()
    expect(w.firstPage).toBe(1)
    expect(w.lastPage).toBe(3)
    expect(w.totalAnchors).toBe(3)
  })
  it('starts at a requested page anchor', () => {
    const w = sliceWindow(paged, { fromPage: 2, maxChars: 10_000 })
    expect(w.text.startsWith('# Page 2')).toBe(true)
    expect(w.firstPage).toBe(2)
    expect(w.pageFound).toBe(true)
  })
  it('flags a missing page instead of guessing', () => {
    const w = sliceWindow(paged, { fromPage: 99, maxChars: 10_000 })
    expect(w.pageFound).toBe(false)
    expect(w.text).toBe('')
  })
  it('caps at maxChars and hands back a continuation offset', () => {
    const w = sliceWindow(paged, { maxChars: 20 })
    expect(w.text.length).toBe(20)
    expect(w.nextOffset).toBe(20)
    const w2 = sliceWindow(paged, { offset: w.nextOffset!, maxChars: 20 })
    expect(w2.startOffset).toBe(20)
  })
  it('handles anchor-less documents in pure offset mode', () => {
    const flat = 'x'.repeat(100)
    const w = sliceWindow(flat, { offset: 40, maxChars: 30 })
    expect(w.text).toBe('x'.repeat(30))
    expect(w.totalAnchors).toBe(0)
    expect(w.firstPage).toBeNull()
    expect(w.nextOffset).toBe(70)
  })
})
