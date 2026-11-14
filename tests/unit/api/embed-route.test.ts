import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEnsure = vi.fn()
const mockGetCount = vi.fn()
const mockEmbedAndStore = vi.fn()
const mockGetChat = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: mockEnsure, embedAndStore: mockEmbedAndStore }))
  vi.doMock('@/app/actions', () => ({ getEmbeddingCount: mockGetCount, getChatWithContext: mockGetChat }))
  return await import('@/app/api/embed/route')
}

function postRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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

// Audit U3/B13: the embedding's project is the chat's DB project, never the
// client's nav state (a stale activeProjectId used to file a chat's messages
// under another project).
describe('POST /api/embed project scope', () => {
  beforeEach(() => {
    [mockEnsure, mockEmbedAndStore, mockGetChat].forEach(f => f.mockReset())
    mockEnsure.mockResolvedValue({ available: true, provider: 'gemini' })
    mockEmbedAndStore.mockResolvedValue(undefined)
  })

  it('stores the embedding under the chat\'s project, ignoring a body projectId', async () => {
    mockGetChat.mockResolvedValue({ id: 3, projectId: 5 })
    const { POST } = await importRoute()
    const res = await POST(postRequest({ messageId: 900, chatId: 3, projectId: 42, content: 'hello' }))
    expect(res.status).toBe(200)
    expect(mockGetChat).toHaveBeenCalledWith(3)
    expect(mockEmbedAndStore).toHaveBeenCalledExactlyOnceWith(900, 3, 5, 'hello')
  })

  it('stores a standalone chat\'s embedding with no project, even when a body projectId is sent', async () => {
    mockGetChat.mockResolvedValue({ id: 3, projectId: null })
    const { POST } = await importRoute()
    await POST(postRequest({ messageId: 900, chatId: 3, projectId: 42, content: 'hello' }))
    expect(mockEmbedAndStore).toHaveBeenCalledExactlyOnceWith(900, 3, null, 'hello')
  })

  it('accepts a body without projectId', async () => {
    mockGetChat.mockResolvedValue({ id: 3, projectId: 5 })
    const { POST } = await importRoute()
    await POST(postRequest({ messageId: 900, chatId: 3, content: 'hello' }))
    expect(mockEmbedAndStore).toHaveBeenCalledExactlyOnceWith(900, 3, 5, 'hello')
  })

  it('returns 404 and embeds nothing for an unknown chat', async () => {
    mockGetChat.mockResolvedValue(undefined)
    const { POST } = await importRoute()
    const res = await POST(postRequest({ messageId: 900, chatId: 999, projectId: 42, content: 'hello' }))
    expect(res.status).toBe(404)
    expect(mockEmbedAndStore).not.toHaveBeenCalled()
  })
})
