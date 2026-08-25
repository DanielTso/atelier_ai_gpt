import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

const mockGenerateText = vi.fn()

// Realistic AI SDK v6 usage shape: inputTokens is the SDK's INCLUSIVE total.
const FAKE_TOTAL_USAGE = {
  inputTokens: 300,
  inputTokenDetails: { noCacheTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 30,
  totalTokens: 330,
}

// Usage capture (Task 10) — mocked so this file asserts the wiring; recordUsage
// itself is covered against PGlite in tests/unit/lib/usage.test.ts.
const mockRecordUsage = vi.fn().mockResolvedValue(undefined)

import { createProject } from '@/app/actions'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/memory/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function importRoute(geminiKey: string | null = 'test-key') {
  vi.resetModules()
  vi.doMock('@/db', () => ({ get db() { return testDb } }))
  vi.doMock('ai', () => ({ generateText: (...args: unknown[]) => mockGenerateText(...args) }))
  vi.doMock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: () => vi.fn((model: string) => ({ modelId: model })),
  }))
  vi.doMock('@/lib/settings', () => ({
    getGeminiApiKey: () => Promise.resolve(geminiKey),
  }))
  vi.doMock('@/lib/usage', () => ({
    recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  }))
  const mod = await import('@/app/api/memory/suggest/route')
  return mod.POST
}

describe('POST /api/memory/suggest', () => {
  beforeEach(async () => {
    await createTestDb()
    vi.clearAllMocks()
    mockGenerateText.mockResolvedValue({ text: '["PE of record is Jane Doe"]', totalUsage: FAKE_TOTAL_USAGE })
  })

  it('returns 400 on invalid body', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest({ projectId: 1 }))
    expect(res.status).toBe(400)
  })

  it('returns created:0 when no Gemini key (silent degrade)', async () => {
    const [p] = await createProject('P')
    const POST = await importRoute(null)
    const res = await POST(makeRequest({ projectId: p.id, messages: [{ role: 'user', content: 'hi' }] }))
    expect(res.status).toBe(200)
    expect((await res.json()).created).toBe(0)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('parses facts and persists pending suggestions', async () => {
    const { getPendingSuggestions } = await import('@/app/actions')
    const [p] = await createProject('P')
    const POST = await importRoute()
    const res = await POST(makeRequest({ projectId: p.id, messages: [{ role: 'user', content: 'The PE of record is Jane Doe' }] }))
    const data = await res.json()
    expect(data.created).toBe(1)
    expect(await getPendingSuggestions(p.id)).toHaveLength(1)

    // Usage capture (Task 10): pinned housekeeping model + the project id
    // (no chatId in the request -> recorded as null).
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: null,
      projectId: p.id,
      purpose: 'memory-suggest',
      model: 'gemini-3.5-flash',
      usage: FAKE_TOTAL_USAGE,
    })
  })

  it('dedups facts already present in memory', async () => {
    const { createProject: cp, updateProjectContext } = await import('@/app/actions')
    const [p] = await cp('P2')
    await updateProjectContext(p.id, { memory: 'PE of record is Jane Doe' })
    const POST = await importRoute()
    const res = await POST(makeRequest({ projectId: p.id, messages: [{ role: 'user', content: 'x' }] }))
    expect((await res.json()).created).toBe(0)
  })

  it('returns capped when pending is at the cap, without calling the model', async () => {
    const { createProject: cp, createMemorySuggestions } = await import('@/app/actions')
    const [p] = await cp('P3')
    await createMemorySuggestions(p.id, null, Array.from({ length: 10 }, (_, i) => `fact ${i}`))
    const POST = await importRoute()
    const res = await POST(makeRequest({ projectId: p.id, messages: [{ role: 'user', content: 'x' }] }))
    const data = await res.json()
    expect(data).toEqual({ created: 0, capped: true })
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('never throws — malformed model output yields created:0', async () => {
    const [p] = await createProject('P4')
    mockGenerateText.mockResolvedValue({ text: 'not json at all' })
    const POST = await importRoute()
    const res = await POST(makeRequest({ projectId: p.id, messages: [{ role: 'user', content: 'x' }] }))
    expect(res.status).toBe(200)
    expect((await res.json()).created).toBe(0)
  })
})
