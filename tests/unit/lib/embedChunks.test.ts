import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateEmbedding = vi.fn()
const mockUpdateChunkEmbedding = vi.fn()

async function load() {
  vi.resetModules()
  vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: mockGenerateEmbedding }))
  vi.doMock('@/app/actions', () => ({ updateChunkEmbedding: mockUpdateChunkEmbedding }))
  return await import('@/lib/embedChunks')
}

const vec = () => new Array(768).fill(0.1)

describe('embedChunks', () => {
  beforeEach(() => { mockGenerateEmbedding.mockReset(); mockUpdateChunkEmbedding.mockReset(); mockUpdateChunkEmbedding.mockResolvedValue(undefined) })

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0, maxInFlight = 0
    mockGenerateEmbedding.mockImplementation(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--; return vec()
    })
    const { embedChunks } = await load()
    const chunks = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, content: `c${i}` }))
    const res = await embedChunks(chunks, { concurrency: 5 })
    expect(maxInFlight).toBeLessThanOrEqual(5)
    expect(res).toEqual({ embedded: 20, failed: 0, aborted: false })
    expect(mockUpdateChunkEmbedding).toHaveBeenCalledTimes(20)
  })

  it('retries a chunk that rejects once then resolves, and counts it embedded', async () => {
    mockGenerateEmbedding
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockResolvedValueOnce(vec())
    const { embedChunks } = await load()
    const res = await embedChunks([{ id: 1, content: 'a' }], { concurrency: 1, retries: 3 })
    expect(res).toEqual({ embedded: 1, failed: 0, aborted: false })
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(mockUpdateChunkEmbedding).toHaveBeenCalledWith(1, expect.any(Array))
  })

  it('counts a permanently-failing chunk as failed and does not throw', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('boom'))
    const { embedChunks } = await load()
    const res = await embedChunks([{ id: 1, content: 'a' }, { id: 2, content: 'b' }], { concurrency: 2, retries: 1 })
    expect(res).toEqual({ embedded: 0, failed: 2, aborted: false })
    expect(mockUpdateChunkEmbedding).not.toHaveBeenCalled()
  })

  it('counts a persist failure as failed and does not throw (never crashes the ingest)', async () => {
    mockGenerateEmbedding.mockResolvedValue(vec())
    mockUpdateChunkEmbedding.mockRejectedValueOnce(new Error('db write failed')).mockResolvedValue(undefined)
    const { embedChunks } = await load()
    const res = await embedChunks([{ id: 1, content: 'a' }, { id: 2, content: 'b' }], { concurrency: 1, retries: 0 })
    expect(res).toEqual({ embedded: 1, failed: 1, aborted: false })
  })
})

// Audit B11 (ingest half): under a full provider outage every chunk used to run its
// whole retry ladder, so a 1,000-chunk document outlived maxDuration and ended as
// "Processing timed out". The pool now stops after N consecutive failures.
describe('embedChunks fail-fast', () => {
  beforeEach(() => { mockGenerateEmbedding.mockReset(); mockUpdateChunkEmbedding.mockReset(); mockUpdateChunkEmbedding.mockResolvedValue(undefined) })

  it('stops calling the provider after failFastAfter consecutive failures and counts the rest as failed', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('503 unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { embedChunks } = await load()
      const chunks = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `c${i}` }))
      const res = await embedChunks(chunks, { concurrency: 1, retries: 0, failFastAfter: 5 })
      expect(res).toEqual({ embedded: 0, failed: 100, aborted: true })
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(5)
      expect(mockUpdateChunkEmbedding).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('defaults to 5 consecutive failures', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { embedChunks } = await load()
      const chunks = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, content: `c${i}` }))
      const res = await embedChunks(chunks, { concurrency: 1, retries: 0 })
      expect(res.aborted).toBe(true)
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(5)
    } finally {
      warn.mockRestore()
    }
  })

  it('a success resets the streak, so scattered failures never trip the breaker', async () => {
    let call = 0
    // fail ×4, succeed, repeated: never 5 in a row
    mockGenerateEmbedding.mockImplementation(async () => {
      call++
      if (call % 5 === 0) return vec()
      throw new Error('flaky')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { embedChunks } = await load()
      const chunks = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, content: `c${i}` }))
      const res = await embedChunks(chunks, { concurrency: 1, retries: 0, failFastAfter: 5 })
      expect(res).toEqual({ embedded: 4, failed: 16, aborted: false })
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(20)
    } finally {
      warn.mockRestore()
    }
  })

  it('embedContents also fails fast, leaving null for every skipped item', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { embedContents } = await load()
      const res = await embedContents(Array.from({ length: 12 }, (_, i) => `c${i}`), { concurrency: 1, retries: 0, failFastAfter: 3 })
      expect(res.aborted).toBe(true)
      expect(res.embedded).toBe(0)
      expect(res.failed).toBe(12)
      expect(res.embeddings).toEqual(new Array(12).fill(null))
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(3)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('capEmbedText', () => {
  it('passes short text through and caps long text at EMBED_MAX_CHARS (8000)', async () => {
    const { capEmbedText, EMBED_MAX_CHARS } = await load()
    expect(EMBED_MAX_CHARS).toBe(8000)
    expect(capEmbedText('short')).toBe('short')
    expect(capEmbedText('z'.repeat(9000))).toBe('z'.repeat(8000))
  })

  it('never ends on half of a surrogate pair', async () => {
    const { capEmbedText } = await load()
    // The emoji's two UTF-16 units straddle the 8000 boundary.
    const capped = capEmbedText('a'.repeat(7999) + '\u{1F600}' + 'tail')
    expect(capped).toBe('a'.repeat(7999))
  })
})

describe('embedContents', () => {
  beforeEach(() => { mockGenerateEmbedding.mockReset(); mockUpdateChunkEmbedding.mockReset() })

  it('returns embeddings in order with null for failures, and does not persist', async () => {
    mockGenerateEmbedding
      .mockResolvedValueOnce(vec())
      .mockRejectedValue(new Error('down'))
    const { embedContents } = await load()
    const res = await embedContents(['a', 'b'], { concurrency: 1, retries: 0 })
    expect(res.embedded).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.embeddings[0]).toEqual(expect.any(Array))
    expect(res.embeddings[1]).toBeNull()
    expect(mockUpdateChunkEmbedding).not.toHaveBeenCalled()
  })
})
