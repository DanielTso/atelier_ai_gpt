import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Hello World Chat' })

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

const mockGoogleSearch = vi.fn(() => ({ type: 'provider-defined', id: 'google_search' }))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => Object.assign(
    vi.fn((model: string) => ({ modelId: model })),
    { tools: { googleSearch: mockGoogleSearch } }
  ),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/generate-title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function importRoute() {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'
  vi.resetModules()
  vi.doMock('@/db', () => ({ get db() { return testDb } }))
  vi.doMock('ai', () => ({ generateText: (...args: unknown[]) => mockGenerateText(...args) }))
  vi.doMock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: () => Object.assign(
      vi.fn((model: string) => ({ modelId: model })),
      { tools: { googleSearch: mockGoogleSearch } }
    ),
  }))
  vi.doMock('@/lib/settings', () => ({
    getGeminiApiKey: () => Promise.resolve('test-key'),
  }))
  const mod = await import('@/app/api/generate-title/route')
  return mod.POST
}

describe('POST /api/generate-title', () => {
  beforeEach(async () => {
    await createTestDb()
    vi.clearAllMocks()
    mockGenerateText.mockResolvedValue({ text: 'Hello World Chat' })
  })

  it('returns title for valid request', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({
      chatId: 1,
      messages: [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi! How can I help?' },
      ],
      model: 'gemini-3.5-flash',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.title).toBe('Hello World Chat')
  })

  it('returns 400 when messages are missing', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: 1 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid request body')
  })

  it('returns 400 when messages array is empty', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: 1, messages: [] }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid request body')
  })

  it('returns 500 on generation error', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('LLM unavailable'))
    const POST = await importRoute()
    const res = await POST(makeRequest({
      chatId: 1,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
      model: 'gemini-3.5-flash',
    }))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('Title generation failed')
  })

  it('strips surrounding quotes from generated title', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '"Discussing Weather Patterns"' })
    const POST = await importRoute()
    const res = await POST(makeRequest({
      chatId: 1,
      messages: [
        { role: 'user', content: 'What is the weather like?' },
        { role: 'assistant', content: 'It depends on your location.' },
      ],
      model: 'gemini-3.5-flash',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.title).toBe('Discussing Weather Patterns')
  })

  it('truncates title longer than 50 characters', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'This Is An Extremely Long Title That Should Be Truncated Because It Exceeds Fifty Characters',
    })
    const POST = await importRoute()
    const res = await POST(makeRequest({
      chatId: 1,
      messages: [
        { role: 'user', content: 'Tell me everything' },
        { role: 'assistant', content: 'Sure, here is everything...' },
      ],
      model: 'gemini-3.5-flash',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.title.length).toBeLessThanOrEqual(50)
  })
})
