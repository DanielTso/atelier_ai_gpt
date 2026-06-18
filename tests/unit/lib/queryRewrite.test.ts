import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
function setup() {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
}

const turns = [
  { role: 'user', text: 'Tell me about the foundation spec' },
  { role: 'assistant', text: 'It uses 4000 psi concrete.' },
  { role: 'user', text: 'what about the second one?' },
]

describe('rewriteQuery', () => {
  beforeEach(() => { mockGenerateText.mockReset() })

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
})
