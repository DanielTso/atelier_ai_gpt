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

// Audit B13: a failed embed used to answer 200 `{ error }`, which the client
// ignores — the message was left with no vector and no trail. A failure is now a
// sanitized 502, and the text is capped before it reaches the embedding model.
describe('POST /api/embed failures and length cap', () => {
  beforeEach(() => {
    [mockEnsure, mockEmbedAndStore, mockGetChat].forEach(f => f.mockReset())
    mockEnsure.mockResolvedValue({ available: true, provider: 'gemini' })
    mockGetChat.mockResolvedValue({ id: 3, projectId: 5 })
  })

  it('returns 502 with a sanitized error when embedding fails', async () => {
    mockEmbedAndStore.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota key=AIza-secret'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { POST } = await importRoute()
      const res = await POST(postRequest({ messageId: 900, chatId: 3, content: 'hello' }))
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body).toEqual({ error: 'Embedding failed' })
      expect(JSON.stringify(body)).not.toContain('AIza')
    } finally {
      errSpy.mockRestore()
    }
  })

  it('embeds only the first EMBED_MAX_CHARS (8000) characters of a long message', async () => {
    mockEmbedAndStore.mockResolvedValue(undefined)
    const { POST } = await importRoute()
    const long = 'a'.repeat(8000) + 'b'.repeat(4000)
    const res = await POST(postRequest({ messageId: 900, chatId: 3, content: long }))
    expect(res.status).toBe(200)
    expect(mockEmbedAndStore).toHaveBeenCalledExactlyOnceWith(900, 3, 5, 'a'.repeat(8000))
  })

  it('returns 400, not 502, for a body that is not JSON', async () => {
    const { POST } = await importRoute()
    const res = await POST(new Request('http://localhost/api/embed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    }))
    expect(res.status).toBe(400)
    expect(mockEmbedAndStore).not.toHaveBeenCalled()
  })

  it('returns 503 { success: false } when no embedding model is available', async () => {
    mockEnsure.mockResolvedValue({ available: false, provider: null })
    const { POST } = await importRoute()
    const res = await POST(postRequest({ messageId: 900, chatId: 3, content: 'hello' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ success: false })
    expect(mockEmbedAndStore).not.toHaveBeenCalled()
  })

  it('rejects an absurdly large body with 400 instead of sending it to the provider', async () => {
    const { POST } = await importRoute()
    const res = await POST(postRequest({ messageId: 900, chatId: 3, content: 'x'.repeat(500_001) }))
    expect(res.status).toBe(400)
    expect(mockEmbedAndStore).not.toHaveBeenCalled()
  })
})
