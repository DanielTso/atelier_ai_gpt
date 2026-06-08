import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

// Mock db
vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

// Mock AI SDK
const mockStreamText = vi.fn().mockReturnValue({
  toUIMessageStreamResponse: () => new Response('streamed', { status: 200 }),
})
const mockConvertToModelMessages = vi.fn().mockResolvedValue([
  { role: 'user', content: 'Hello' },
])

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  convertToModelMessages: (...args: unknown[]) => mockConvertToModelMessages(...args),
}))

const mockGoogleSearch = vi.fn(() => ({ type: 'provider-defined', id: 'google_search' }))
const mockGoogleFn = Object.assign(
  vi.fn((model: string) => ({ modelId: model, provider: 'google' })),
  { tools: { googleSearch: mockGoogleSearch } }
)
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => mockGoogleFn,
}))

const mockWebSearch = vi.fn(() => ({ type: 'provider-defined', id: 'web_search' }))
const mockAnthropicFn = Object.assign(
  vi.fn((model: string) => ({ modelId: model, provider: 'anthropic' })),
  { tools: { webSearch_20250305: mockWebSearch } }
)
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => mockAnthropicFn,
}))

import { createProject, createChat, updateChatSystemPrompt, updateChatSummary } from '@/app/actions'

describe('POST /api/chat', () => {
  beforeEach(async () => {
    await createTestDb()
    vi.clearAllMocks()
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'
  })

  async function postChat(body: Record<string, unknown>) {
    vi.resetModules()

    vi.doMock('@/db', () => ({
      get db() { return testDb },
    }))
    vi.doMock('ai', () => ({
      streamText: (...args: unknown[]) => mockStreamText(...args),
      convertToModelMessages: (...args: unknown[]) => mockConvertToModelMessages(...args),
    }))
    vi.doMock('@ai-sdk/google', () => ({
      createGoogleGenerativeAI: () => Object.assign(
        (model: string) => mockGoogleFn(model),
        { tools: { googleSearch: mockGoogleSearch } }
      ),
    }))
    vi.doMock('@ai-sdk/anthropic', () => ({
      createAnthropic: () => Object.assign(
        (model: string) => mockAnthropicFn(model),
        { tools: { webSearch_20250305: mockWebSearch } }
      ),
    }))
    vi.doMock('@/lib/settings', () => ({
      getGeminiApiKey: () => Promise.resolve('test-key'),
      getAnthropicApiKey: () => Promise.resolve('test-anthropic-key'),
    }))
    vi.doMock('@/lib/embeddings', () => ({
      generateEmbedding: () => Promise.reject(new Error('test: embeddings unavailable')),
      findSimilarMessages: () => Promise.resolve([]),
    }))

    const { POST } = await import('@/app/api/chat/route')
    return POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  }

  it('routes gemini models to Google provider', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
    })
    expect(response.status).toBe(200)
    expect(mockGoogleFn).toHaveBeenCalledWith('gemini-3.5-flash')
  })

  it('routes claude models to the Anthropic provider', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'claude-opus-4-8',
    })
    expect(response.status).toBe(200)
    expect(mockAnthropicFn).toHaveBeenCalledWith('claude-opus-4-8')
  })

  it('returns 500 for unknown model provider', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'llama3',
    })
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toContain('Unknown model provider')
  })

  it('injects summary context when chat has summary', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    await updateChatSummary(chat.id, 'Previous context summary', 1)

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
    })
    expect(response.status).toBe(200)
    expect(mockConvertToModelMessages).toHaveBeenCalled()
    const passedMessages = mockConvertToModelMessages.mock.calls[0][0]
    expect(passedMessages[0].id).toBe('summary-context')
    expect(passedMessages[1].id).toBe('summary-ack')
  })

  it('passes system prompt when chat has one', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    await updateChatSystemPrompt(chat.id, 'Be helpful')

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
    })
    expect(response.status).toBe(200)
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'Be helpful' })
    )
  })

  it('returns 500 on error', async () => {
    mockStreamText.mockImplementationOnce(() => {
      throw new Error('Model error')
    })

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
    })
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toContain('An error occurred during text generation.')
  })
})
