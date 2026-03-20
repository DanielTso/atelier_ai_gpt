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
    expect(chunks[0]).toEqual({ index: 0, content: text })
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
})
