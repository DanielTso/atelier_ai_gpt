import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockCreateProvider = vi.fn()
const mockRecordUsage = vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined)

async function importRoute() {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@/lib/providers', () => ({ createProvider: (...a: unknown[]) => mockCreateProvider(...a) }))
  vi.doMock('@/lib/usage', () => ({ recordUsage: (...a: unknown[]) => mockRecordUsage(...a) }))
  const { POST } = await import('@/app/api/suggest-followups/route')
  return POST
}

const req = (body: unknown) => new Request('http://localhost/api/suggest-followups', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})

const VALID_BODY = {
  messages: [
    { role: 'user', content: 'why is the US the top destination?' },
    { role: 'assistant', content: 'Because of economics, family, freedom…' },
  ],
}

describe('POST /api/suggest-followups', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
    mockCreateProvider.mockReset()
    mockCreateProvider.mockResolvedValue({ model: { modelId: 'gemini-3.5-flash' } })
    mockRecordUsage.mockClear()
  })

  // Audit C5: every LLM call writes one usage_events row.
  it('records one usage row with purpose suggest-followups', async () => {
    const usage = { inputTokens: 120, inputTokenDetails: { noCacheTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokens: 30, outputTokenDetails: { textTokens: 30, reasoningTokens: 0 }, totalTokens: 150 }
    mockGenerateText.mockResolvedValue({ text: '["a", "b", "c"]', totalUsage: usage })
    const POST = await importRoute()
    await POST(req(VALID_BODY))
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: null, projectId: null, purpose: 'suggest-followups', model: 'gemini-3.5-flash', usage,
    })
  })

  it('a usage-write failure never fails the request', async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error('db down'))
    mockGenerateText.mockResolvedValue({ text: '["a"]', totalUsage: undefined })
    const POST = await importRoute()
    const res = await POST(req(VALID_BODY))
    expect(await res.json()).toEqual({ suggestions: ['a'] })
  })

  it('parses a JSON array from the model into up to 3 trimmed suggestions', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Here you go: ["Compare the US with Canada", " Build a visual timeline ", "Draft a summary doc", "extra one"]' })
    const POST = await importRoute()
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      suggestions: ['Compare the US with Canada', 'Build a visual timeline', 'Draft a summary doc'],
    })
  })

  it('malformed model output degrades to empty suggestions, still 200', async () => {
    mockGenerateText.mockResolvedValue({ text: 'sorry, no list today' })
    const POST = await importRoute()
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ suggestions: [] })
  })

  it('provider failure (no Gemini key) degrades to empty suggestions, still 200', async () => {
    mockCreateProvider.mockRejectedValue(new Error('Gemini API Key missing'))
    const POST = await importRoute()
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ suggestions: [] })
  })

  it('rejects an invalid body with 400', async () => {
    const POST = await importRoute()
    expect((await POST(req({ messages: [] }))).status).toBe(400)
    expect((await POST(req({ messages: [{ role: 'system', content: 'x' }] }))).status).toBe(400)
  })
})
