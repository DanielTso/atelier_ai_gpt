import { describe, it, expect } from 'vitest'
import { chunkText } from '@/lib/chunking'

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   ')).toEqual([])
  })

  it('returns single chunk for text under maxSize', () => {
    const text = 'Hello world'
    const chunks = chunkText(text, 2000, 400)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ index: 0, content: text, start: 0, end: text.length })
  })

  it('splits text into overlapping chunks', () => {
    const text = 'A'.repeat(5000)
    const chunks = chunkText(text, 2000, 400)
    expect(chunks.length).toBeGreaterThan(1)

    // Verify overlap: end of chunk N should overlap with start of chunk N+1
    for (let i = 0; i < chunks.length - 1; i++) {
      const chunkEnd = chunks[i].content.slice(-400)
      const nextStart = chunks[i + 1].content.slice(0, 400)
      expect(chunkEnd).toBe(nextStart)
    }
  })

  it('prefers sentence boundaries when splitting', () => {
    // Place a sentence boundary in the last 20% of the chunk (1600-2000 range)
    const filler1 = 'x'.repeat(1700)
    const boundary = 'End of section. '
    const filler2 = 'y'.repeat(2000)
    const text = filler1 + boundary + filler2
    const chunks = chunkText(text, 2000, 400)
    // First chunk should break at the period, not at exactly 2000 chars
    expect(chunks[0].content).toMatch(/\.\s*$/)
  })

  it('does not infinite loop with overlap equal to chunk size', () => {
    // This would infinite loop if the guard is broken
    const text = 'x'.repeat(100)
    const chunks = chunkText(text, 10, 10)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.length).toBeLessThan(200) // Sanity: not exponential
  })

  it('covers entire text content', () => {
    const text = 'x'.repeat(5000)
    const chunks = chunkText(text, 2000, 400)
    // Last chunk should extend to the end of the text
    const lastChunk = chunks[chunks.length - 1]
    expect(text.endsWith(lastChunk.content)).toBe(true)
  })

  it('assigns sequential chunk indices', () => {
    const text = 'x'.repeat(5000)
    const chunks = chunkText(text, 2000, 400)
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i)
    })
  })

  it('records exact char offsets — slice(start, end) === content', () => {
    // Mixed content with sentence boundaries so bestBreak logic engages
    const text = ('The quick brown fox. ' + 'y'.repeat(1800) + '! ').repeat(6)
    const chunks = chunkText(text, 2000, 400)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(text.slice(c.start, c.end)).toBe(c.content)
    }
  })

  it('single-chunk path carries full-span offsets', () => {
    const text = 'Hello world'
    const chunks = chunkText(text, 2000, 400)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ index: 0, content: text, start: 0, end: text.length })
  })

  it('last chunk end equals text length', () => {
    const text = 'x'.repeat(5000)
    const chunks = chunkText(text, 2000, 400)
    expect(chunks[chunks.length - 1].end).toBe(text.length)
  })

  it('next chunk start is previous end minus overlap (modulo clamp)', () => {
    // Uniform text → no sentence boundary, deterministic offsets
    const text = 'x'.repeat(5000)
    const overlap = 400
    const chunks = chunkText(text, 2000, overlap)
    expect(chunks.length).toBeGreaterThan(1)
    // Second chunk: start = end0 - overlap unless clamped forward
    const expected = chunks[0].end - overlap
    const clamped = Math.max(expected, 0 + 1)
    expect(chunks[1].start).toBe(clamped)
  })
})
