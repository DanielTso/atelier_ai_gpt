import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
function setup(key: string | null = 'k') {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
}

const cands = [
  { content: 'irrelevant chunk' },
  { content: 'the answer is here' },
  { content: 'somewhat related' },
]

describe('rerankCandidates', () => {
  beforeEach(() => mockGenerateText.mockReset())

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
})
