import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockRecordUsage = vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined)
function setup(key: string | null = 'k') {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@/lib/usage', () => ({ recordUsage: (...a: unknown[]) => mockRecordUsage(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
}

const cands = [
  { content: 'irrelevant chunk' },
  { content: 'the answer is here' },
  { content: 'somewhat related' },
]

describe('rerankCandidates', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockRecordUsage.mockClear() })

  // Audit C5: every LLM call writes one usage_events row, tied to the chat.
  it('records one usage row with purpose rerank, attributed to the chat — even when the output is unparseable', async () => {
    setup()
    const usage = { inputTokens: 120, inputTokenDetails: { noCacheTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokens: 30, outputTokenDetails: { textTokens: 30, reasoningTokens: 0 }, totalTokens: 150 }
    mockGenerateText.mockResolvedValue({ text: 'no json here', totalUsage: usage })
    const { rerankCandidates } = await import('@/lib/rerank')
    await rerankCandidates('q', cands, 2, { usage: { chatId: 5, projectId: null } })
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: 5, projectId: null, purpose: 'rerank', model: 'gemini-3.5-flash', usage,
    })
  })

  it('records nothing when no model call is made (one candidate, or no key)', async () => {
    setup(null)
    const { rerankCandidates } = await import('@/lib/rerank')
    await rerankCandidates('q', cands, 2)
    await rerankCandidates('q', cands.slice(0, 1), 2)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('reorders by model score and respects topK', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: '[{"index":1,"score":95},{"index":2,"score":60},{"index":0,"score":10}]' })
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 2)
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe('the answer is here')
    expect(out[1].content).toBe('somewhat related')
  })

  it('falls back to input order on unparseable output', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: 'no json here' })
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 2)
    expect(out.map(c => c.content)).toEqual(['irrelevant chunk', 'the answer is here'])
  })

  it('falls back to input order with no API key', async () => {
    setup(null)
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 3)
    expect(out).toEqual(cands)
  })

  it('dedups a repeated model index so one candidate never fills two slots', async () => {
    setup()
    // The LLM returns index 1 twice — must collapse to a single occurrence.
    mockGenerateText.mockResolvedValue({ text: '[{"index":1,"score":95},{"index":1,"score":90},{"index":0,"score":50}]' })
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 3)
    const contents = out.map(c => c.content)
    expect(contents.filter(c => c === 'the answer is here')).toHaveLength(1)
    expect(new Set(contents).size).toBe(contents.length) // all unique
    expect(out).toHaveLength(3)
  })

  it('fails fast: no SDK retries and the caller abort signal is passed through', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: '[]' })
    const { rerankCandidates } = await import('@/lib/rerank')
    const signal = new AbortController().signal
    await rerankCandidates('q', cands, 2, { abortSignal: signal })
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, abortSignal: signal }))
  })
})
