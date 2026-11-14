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

// Audit X11: a window cut at a raw offset ended mid-page, and the next window
// started with the tail of that page while reporting the following page.
describe('sliceWindow page boundaries (audit X11)', () => {
  // Three 40-char pages: anchors at 0, 40, 80.
  const doc = ['# Page 1\n' + 'a'.repeat(30), '# Page 2\n' + 'b'.repeat(30), '# Page 3\n' + 'c'.repeat(30)].join('\n')

  it('ends window 1 at a page boundary and starts window 2 with its anchor', () => {
    const w1 = sliceWindow(doc, { maxChars: 100 })
    expect(w1.endOffset).toBe(80)
    expect(w1.text.endsWith('b'.repeat(30) + '\n')).toBe(true)
    expect(w1.nextOffset).toBe(80)
    expect(w1.firstPage).toBe(1)
    expect(w1.lastPage).toBe(2)
    const w2 = sliceWindow(doc, { offset: w1.nextOffset!, maxChars: 100 })
    expect(w2.text.startsWith('# Page 3')).toBe(true)
    expect(w2.firstPage).toBe(3)
    expect(w2.nextOffset).toBeNull()
  })

  it('backs off from a fromPage start too', () => {
    const w = sliceWindow(doc, { fromPage: 2, maxChars: 60 })
    expect(w.text).toBe('# Page 2\n' + 'b'.repeat(30) + '\n')
    expect(w.nextOffset).toBe(80)
  })

  it('cuts at the raw cap when one page alone exceeds it', () => {
    const w = sliceWindow(doc, { maxChars: 20 })
    expect(w.endOffset).toBe(20)
    expect(w.firstPage).toBe(1)
    expect(w.lastPage).toBe(1)
  })

  it('a continuation inside an oversize page ends at the next anchor and reports its own page', () => {
    const w = sliceWindow(doc, { offset: 20, maxChars: 50 })
    expect(w.startOffset).toBe(20)
    expect(w.endOffset).toBe(40)
    expect(w.firstPage).toBe(1)
    expect(w.lastPage).toBe(1)
    const mid = sliceWindow(doc, { offset: 50, maxChars: 10 })
    expect(mid.firstPage).toBe(2)
    expect(mid.lastPage).toBe(2)
  })

  it('does not shrink a window to a preamble before the first anchor', () => {
    const pre = '[pages 1–2 · vision]\n# Page 1\n' + 'a'.repeat(200) + '\n# Page 2\nbbb'
    const w = sliceWindow(pre, { maxChars: 100 })
    expect(w.endOffset).toBe(100)
  })
})
