import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockGenerateText = vi.fn().mockResolvedValue({
  text: '[{"topic": "coding", "confidence": 85}]',
})

import { createProject, createChat } from '@/app/actions'

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => vi.fn((model: string) => ({ modelId: model })),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/classify', {
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
    createGoogleGenerativeAI: () => vi.fn((model: string) => ({ modelId: model })),
  }))
  vi.doMock('@/lib/settings', () => ({
    getGeminiApiKey: () => Promise.resolve('test-key'),
  }))
  const mod = await import('@/app/api/classify/route')
  return mod.POST
}

describe('POST /api/classify', () => {
  beforeEach(async () => {
    await createTestDb()
    vi.clearAllMocks()
  })

  it('returns 400 when chatId or messages is missing', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: 1 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid request body')
  })

  it('extracts text from SDK v6 parts format', async () => {
    const POST = await importRoute()
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'Hello world' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] },
    ]
    const res = await POST(makeRequest({ chatId: 1, messages }))
    expect(res.status).toBe(200)

    // Verify generateText was called with conversation text containing message content
    const callArgs = mockGenerateText.mock.calls[0][0]
    expect(callArgs.prompt).toContain('Hello world')
    expect(callArgs.prompt).toContain('Hi there')
  })

  it('falls back to content field for legacy format', async () => {
    const POST = await importRoute()
    const messages = [
      { role: 'user', content: 'Legacy message' },
    ]
    const res = await POST(makeRequest({ chatId: 1, messages }))
    expect(res.status).toBe(200)

    const callArgs = mockGenerateText.mock.calls[0][0]
    expect(callArgs.prompt).toContain('Legacy message')
  })

  it('uses gemini-3.5-flash as default model', async () => {
    const POST = await importRoute()
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'test' }] },
    ]
    await POST(makeRequest({ chatId: 1, messages }))

    const callArgs = mockGenerateText.mock.calls[0][0]
    expect(callArgs.model.modelId).toBe('gemini-3.5-flash')
  })

  it('pins to gemini-3.5-flash even when the body requests the image model', async () => {
    const POST = await importRoute()
    const messages = [{ role: 'user', parts: [{ type: 'text', text: 'test' }] }]
    // The image model (and any non-flash model) must be coerced to Flash, not passed through.
    await POST(makeRequest({ chatId: 1, messages, model: 'gemini-3.1-flash-image' }))
    const callArgs = mockGenerateText.mock.calls[0][0]
    expect(callArgs.model.modelId).toBe('gemini-3.5-flash')
  })

  it('parses topics from LLM response and saves to DB', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    const POST = await importRoute()
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'Help me debug' }] },
    ]
    const res = await POST(makeRequest({ chatId: chat.id, messages }))
    const data = await res.json()

    expect(data.topics).toEqual([{ topic: 'coding', confidence: 85 }])
    expect(data.cached).toBe(false)
  })
})
