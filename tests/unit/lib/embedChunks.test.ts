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
    expect(res).toEqual({ embedded: 20, failed: 0 })
    expect(mockUpdateChunkEmbedding).toHaveBeenCalledTimes(20)
  })

  it('retries a chunk that rejects once then resolves, and counts it embedded', async () => {
    mockGenerateEmbedding
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockResolvedValueOnce(vec())
    const { embedChunks } = await load()
    const res = await embedChunks([{ id: 1, content: 'a' }], { concurrency: 1, retries: 3 })
    expect(res).toEqual({ embedded: 1, failed: 0 })
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(mockUpdateChunkEmbedding).toHaveBeenCalledWith(1, expect.any(Array))
  })

  it('counts a permanently-failing chunk as failed and does not throw', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('boom'))
    const { embedChunks } = await load()
    const res = await embedChunks([{ id: 1, content: 'a' }, { id: 2, content: 'b' }], { concurrency: 2, retries: 1 })
    expect(res).toEqual({ embedded: 0, failed: 2 })
    expect(mockUpdateChunkEmbedding).not.toHaveBeenCalled()
  })
})

describe('embedContents', () => {
  beforeEach(() => { mockGenerateEmbedding.mockReset() })

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
