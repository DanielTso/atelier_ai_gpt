import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockGenerateText = vi.fn().mockResolvedValue({ text: 'Generated summary' })

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

import {
  createProject,
  createChat,
  saveMessage,
  getChatWithContext,
  updateChatSummary,
} from '@/app/actions'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function importRoute() {
  // Ensure env var is set before the module evaluates its module-level const
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'
  vi.resetModules()
  // Re-register mocks after resetModules
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
  const mod = await import('@/app/api/summarize/route')
  return mod.POST
}

describe('POST /api/summarize', () => {
  beforeEach(async () => {
    await createTestDb()
    vi.clearAllMocks()
  })

  it('returns 400 when chatId or cutoffMessageId is missing', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: 1 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid request body')
  })

  it('returns 404 when chat does not exist', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: 99999, cutoffMessageId: 1 }))
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('not found')
  })

  it('returns a 200 no-op when the window is empty (already up to date)', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: chat.id, cutoffMessageId: 999 }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.summarizedMessageCount).toBe(0)
  })

  it('folds only messages after summaryUpToMessageId', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    await saveMessage(chat.id, 'user', 'One')
    const [m2] = await saveMessage(chat.id, 'assistant', 'Two')
    await saveMessage(chat.id, 'user', 'Three')
    const [m4] = await saveMessage(chat.id, 'assistant', 'Four')
    // Pretend we already summarized through m2.
    await updateChatSummary(chat.id, 'Earlier summary', m2.id)

    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: chat.id, cutoffMessageId: m4.id }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // Only m3 and m4 are in (m2, m4]; m1/m2 excluded by the lower bound.
    expect(data.summarizedMessageCount).toBe(2)

    const updated = await getChatWithContext(chat.id)
    expect(updated!.summaryUpToMessageId).toBe(m4.id)
  })

  it('successfully summarizes messages and updates chat', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    const [m1] = await saveMessage(chat.id, 'user', 'Hello')
    const [m2] = await saveMessage(chat.id, 'assistant', 'Hi there')
    await saveMessage(chat.id, 'user', 'How are you?')

    const POST = await importRoute()
    const res = await POST(
      makeRequest({ chatId: chat.id, cutoffMessageId: m2.id })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.summary).toBe('Generated summary')
    expect(data.summarizedMessageCount).toBe(2) // m1 and m2

    // Verify DB was updated
    const updatedChat = await getChatWithContext(chat.id)
    expect(updatedChat!.summary).toBe('Generated summary')
    expect(updatedChat!.summaryUpToMessageId).toBe(m2.id)
  })
})
