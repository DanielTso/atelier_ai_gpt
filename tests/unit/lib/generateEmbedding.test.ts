import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbed = vi.fn()
function setup() {
  vi.resetModules()
  vi.doMock('ai', () => ({ embed: (...a: unknown[]) => mockEmbed(...a) }))
  vi.doMock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: () => ({ textEmbeddingModel: (m: string) => ({ modelId: m }) }),
  }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
  // embeddings.ts imports the DB and the server actions; neither is touched here.
  vi.doMock('@/db', () => ({ db: {} }))
  vi.doMock('@/app/actions', () => ({ saveMessageEmbedding: vi.fn() }))
}

describe('generateEmbedding', () => {
  beforeEach(() => { mockEmbed.mockReset(); mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] }) })

  it('forwards abortSignal and maxRetries when given (the chat query path)', async () => {
    setup()
    const { generateEmbedding } = await import('@/lib/embeddings')
    const signal = new AbortController().signal
    expect(await generateEmbedding('q', 'query', { abortSignal: signal, maxRetries: 0 })).toEqual([0.1, 0.2])
    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: signal, maxRetries: 0 }))
  })

  it('leaves both unset without options, keeping the SDK retries for ingestion', async () => {
    setup()
    const { generateEmbedding } = await import('@/lib/embeddings')
    await generateEmbedding('chunk text', 'document')
    const args = mockEmbed.mock.calls[0]![0] as Record<string, unknown>
    expect(args).not.toHaveProperty('abortSignal')
    expect(args).not.toHaveProperty('maxRetries')
  })
})
