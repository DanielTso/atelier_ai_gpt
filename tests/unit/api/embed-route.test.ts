import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEnsure = vi.fn()
const mockGetCount = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: mockEnsure, embedAndStore: vi.fn() }))
  vi.doMock('@/app/actions', () => ({ getEmbeddingCount: mockGetCount }))
  return await import('@/app/api/embed/route')
}

describe('GET /api/embed scope validation', () => {
  beforeEach(() => {
    [mockEnsure, mockGetCount].forEach(f => f.mockReset())
    mockEnsure.mockResolvedValue({ available: true, provider: 'gemini' })
    mockGetCount.mockResolvedValue(3)
  })

  it('passes a valid projectId through as scope', async () => {
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/embed?projectId=7'))
    expect(res.status).toBe(200)
    expect(mockGetCount).toHaveBeenCalledWith({ projectId: 7 })
  })

  it('ignores a non-numeric projectId (no NaN scope)', async () => {
    const { GET } = await importRoute()
    await GET(new Request('http://localhost/api/embed?projectId=abc'))
    expect(mockGetCount).toHaveBeenCalledWith({}) // not { projectId: NaN }
  })

  it('ignores an empty projectId param', async () => {
    const { GET } = await importRoute()
    await GET(new Request('http://localhost/api/embed?projectId='))
    expect(mockGetCount).toHaveBeenCalledWith({})
  })

  it('falls back to chatId when projectId is absent', async () => {
    const { GET } = await importRoute()
    await GET(new Request('http://localhost/api/embed?chatId=5'))
    expect(mockGetCount).toHaveBeenCalledWith({ chatId: 5 })
  })
})
