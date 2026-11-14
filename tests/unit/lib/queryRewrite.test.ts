import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockRecordUsage = vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined)
function setup() {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@/lib/usage', () => ({ recordUsage: (...a: unknown[]) => mockRecordUsage(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
}

const turns = [
  { role: 'user', text: 'Tell me about the foundation spec' },
  { role: 'assistant', text: 'It uses 4000 psi concrete.' },
  { role: 'user', text: 'what about the second one?' },
]

describe('rewriteQuery', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockRecordUsage.mockClear() })

  // Audit C5: every LLM call writes one usage_events row, tied to the chat.
  it('records one usage row with purpose query-rewrite, attributed to the chat', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    const usage = { inputTokens: 120, inputTokenDetails: { noCacheTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokens: 30, outputTokenDetails: { textTokens: 30, reasoningTokens: 0 }, totalTokens: 150 }
    mockGenerateText.mockResolvedValue({ text: 'q', totalUsage: usage })
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    await rewriteQuery(turns, { usage: { chatId: 3, projectId: 4 } })
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: 3, projectId: 4, purpose: 'query-rewrite', model: 'gemini-3.5-flash', usage,
    })
  })

  it('records nothing when the call fails (no tokens to bill)', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    mockGenerateText.mockRejectedValue(new Error('boom'))
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    await rewriteQuery(turns)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('returns the model-rewritten standalone query', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    mockGenerateText.mockResolvedValue({ text: 'second foundation specification details' })
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    expect(await rewriteQuery(turns)).toBe('second foundation specification details')
  })

  it('falls back to the last user message when no API key', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(null) }))
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    expect(await rewriteQuery(turns)).toBe('what about the second one?')
  })

  it('falls back to the last user message on model error', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    mockGenerateText.mockRejectedValue(new Error('boom'))
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    expect(await rewriteQuery(turns)).toBe('what about the second one?')
  })

  it('fails fast: no SDK retries and the caller abort signal is passed through', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    mockGenerateText.mockResolvedValue({ text: 'q' })
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    const signal = new AbortController().signal
    await rewriteQuery(turns, { abortSignal: signal })
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, abortSignal: signal }))
  })
})
