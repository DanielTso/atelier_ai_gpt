import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'
import { documents } from '@/db/schema'

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
  stepCountIs: (n: number) => ({ type: 'step-count', count: n }),
  tool: (config: unknown) => config,
}))

const mockRetrieveContext = vi.fn()

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

// Ids the fake registry treats as "known" — mirrors the model set the picker
// used to hardcode. Anything else falls back, matching production
// resolveRequestedModel() behavior, without hitting the network via the real
// registry (which would call fetchAllAnthropicModels over a fake key).
const KNOWN_MODEL_IDS = new Set([
  'claude-opus-4-8',
  'claude-fable-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gemini-3.1-flash-image',
  'gemini-3.5-flash',
])

describe('POST /api/chat', () => {
  beforeEach(async () => {
    await createTestDb()
    vi.clearAllMocks()
    mockRetrieveContext.mockResolvedValue({ semanticContext: null, documentContext: null })
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
      stepCountIs: (n: number) => ({ type: 'step-count', count: n }),
      tool: (config: unknown) => config,
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
    vi.doMock('@/lib/retrieval', () => ({
      retrieveContext: (...args: unknown[]) => mockRetrieveContext(...args),
    }))
    vi.doMock('@/lib/models/registry', () => ({
      resolveRequestedModel: async (requested?: string) => {
        if (!requested) return { modelId: 'claude-opus-4-8', usedFallback: false }
        if (KNOWN_MODEL_IDS.has(requested)) return { modelId: requested, usedFallback: false }
        console.warn(`[models] unknown model id "${requested}" requested, falling back to "claude-opus-4-8"`)
        return { modelId: 'claude-opus-4-8', usedFallback: true }
      },
      getModelCapabilities: async () => ({
        supportsEffort: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        supportsThinking: true,
        supportsImageInput: false,
        supportsStructuredOutputs: true,
      }),
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

  it('falls back to the default model and returns 200 for a stale/unknown model id (not a 400)', async () => {
    // Locked bug fix: a stale projects.default_model (or any tampered/retired id)
    // must degrade to the current default instead of 400ing the chat permanently.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const response = await postChat({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        model: 'llama3',
      })
      expect(response.status).toBe(200)
      expect(mockAnthropicFn).toHaveBeenCalledWith('claude-opus-4-8')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown model id "llama3"'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still rejects a malformed model id at the shape-guard level (400)', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'not a valid id!',
    })
    expect(response.status).toBe(400)
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

  it('wires read_document + a document manifest for a Claude project chat with ready documents', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    try {
      const [project] = await createProject('P')
      const [chat] = await createChat(project.id, 'Chat')
      await testDb.insert(documents).values({
        projectId: project.id,
        filename: 'plans.pdf',
        mimeType: 'application/pdf',
        fileSize: 1000,
        status: 'ready',
        storagePath: 'p',
        pageCount: 4,
        charCount: 100,
        extractionMethod: 'hybrid',
        extractionPartial: false,
        failedPages: null,
      })

      const response = await postChat({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        model: 'claude-opus-4-8',
        chatId: chat.id,
      })
      expect(response.status).toBe(200)
      expect(mockStreamText.mock.calls[0][0].tools).toHaveProperty('read_document')
      expect(mockStreamText.mock.calls[0][0].system).toContain('[Project documents]')
      expect(mockStreamText.mock.calls[0][0].system).toContain('id=1 "plans.pdf"')
    } finally {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  })

  it('appends CITATION_GUIDANCE when document context is injected (no GROUNDED without the flag)', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    mockRetrieveContext.mockResolvedValue({
      semanticContext: null,
      documentContext: '[Source: doc 1 "plans.pdf" p.2 §c5]\nRetainage is 10%.',
    })

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
    })
    expect(response.status).toBe(200)
    const system = mockStreamText.mock.calls[0][0].system as string
    expect(system).toContain('CITATIONS:')
    expect(system).not.toContain('GROUNDED MODE:')
  })

  it('appends GROUNDED_GUIDANCE additionally when grounded is true', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    mockRetrieveContext.mockResolvedValue({
      semanticContext: null,
      documentContext: '[Source: doc 1 "plans.pdf" p.2 §c5]\nRetainage is 10%.',
    })

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
      grounded: true,
    })
    expect(response.status).toBe(200)
    const system = mockStreamText.mock.calls[0][0].system as string
    expect(system).toContain('CITATIONS:')
    expect(system).toContain('GROUNDED MODE:')
  })

  it('appends GROUNDED_GUIDANCE when grounded even without document context (exclude-all case)', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
      grounded: true,
    })
    expect(response.status).toBe(200)
    const system = mockStreamText.mock.calls[0][0].system as string
    expect(system).toContain('GROUNDED MODE:')
    expect(system).not.toContain('CITATIONS:')
  })

  it('omits both guidance strings when no document context and no read_document tool', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    await updateChatSystemPrompt(chat.id, 'Be helpful')

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
    })
    expect(response.status).toBe(200)
    const system = mockStreamText.mock.calls[0][0].system as string
    expect(system).not.toContain('CITATIONS:')
    expect(system).not.toContain('GROUNDED MODE:')
  })

  it('appends CITATION_GUIDANCE when read_document is wired (manifest path)', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    try {
      const [project] = await createProject('P')
      const [chat] = await createChat(project.id, 'Chat')
      await testDb.insert(documents).values({
        projectId: project.id,
        filename: 'plans.pdf',
        mimeType: 'application/pdf',
        fileSize: 1000,
        status: 'ready',
        storagePath: 'p',
        pageCount: 4,
        charCount: 100,
        extractionMethod: 'hybrid',
        extractionPartial: false,
        failedPages: null,
      })

      const response = await postChat({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        model: 'claude-opus-4-8',
        chatId: chat.id,
      })
      expect(response.status).toBe(200)
      const system = mockStreamText.mock.calls[0][0].system as string
      expect(system).toContain('CITATIONS:')
    } finally {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  })

  it('filters excluded documents out of the manifest and passes exclusions to retrieveContext', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    try {
      const [project] = await createProject('P')
      const [chat] = await createChat(project.id, 'Chat')
      const shared = {
        projectId: project.id,
        mimeType: 'application/pdf',
        fileSize: 1000,
        status: 'ready',
        storagePath: 'p',
        pageCount: 4,
        charCount: 100,
        extractionMethod: 'text',
        extractionPartial: false,
        failedPages: null,
      }
      await testDb.insert(documents).values({ ...shared, filename: 'plans.pdf' })
      await testDb.insert(documents).values({ ...shared, filename: 'specs.pdf' })

      const response = await postChat({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        model: 'claude-opus-4-8',
        chatId: chat.id,
        excludedDocumentIds: [2],
      })
      expect(response.status).toBe(200)
      const system = mockStreamText.mock.calls[0][0].system as string
      expect(system).toContain('id=1 "plans.pdf"')
      expect(system).not.toContain('specs.pdf')
      expect(mockRetrieveContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ excludeDocumentIds: [2] })
      )
    } finally {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  })

  it('accepts grounded and excludedDocumentIds in the request body', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      grounded: false,
      excludedDocumentIds: [1, 2, 3],
    })
    expect(response.status).toBe(200)
  })

  it('rejects excludedDocumentIds with more than 200 entries', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      excludedDocumentIds: Array.from({ length: 201 }, (_, i) => i + 1),
    })
    expect(response.status).toBe(400)
  })

  it('rejects non-integer and non-positive excludedDocumentIds', async () => {
    const nonInt = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      excludedDocumentIds: [1.5],
    })
    expect(nonInt.status).toBe(400)

    const nonPositive = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      excludedDocumentIds: [0],
    })
    expect(nonPositive.status).toBe(400)
  })

  it('logs a [cite-compliance] line from streamText onFinish', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    mockRetrieveContext.mockResolvedValue({
      semanticContext: null,
      documentContext: '[Source: doc 1 "plans.pdf" p.2 §c5]\nRetainage is 10%.',
    })

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'gemini-3.5-flash',
      chatId: chat.id,
      grounded: true,
    })
    expect(response.status).toBe(200)
    const onFinish = mockStreamText.mock.calls[0][0].onFinish as (r: { text: string }) => void
    expect(typeof onFinish).toBe('function')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      // Two parseable markers + one near-miss (p-dot) → markers=2, loose=1.
      onFinish({ text: 'Retainage is 10% [cite:1 p2]. General fact. [cite:1 c5] Near-miss [cite:1 p.3].' })
      expect(logSpy).toHaveBeenCalledWith(
        '[cite-compliance]',
        JSON.stringify({ chatId: chat.id, grounded: true, docCtx: true, markers: 2, loose: 1 })
      )
    } finally {
      logSpy.mockRestore()
    }
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
