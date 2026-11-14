import { describe, it, expect, vi, beforeEach } from 'vitest'

// Realistic AI SDK v6 usage shape: inputTokens is the SDK's INCLUSIVE total.
const FAKE_TOTAL_USAGE = {
  inputTokens: 900,
  inputTokenDetails: { noCacheTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 250,
  totalTokens: 1150,
}

const m = {
  getArtifactById: vi.fn(),
  addArtifactVersion: vi.fn(),
  isStorageConfigured: vi.fn(() => true),
  uploadBuffer: vi.fn(async () => undefined),
  signedArtifactUrl: vi.fn(async (p: string) => `signed:${p}`),
  removeObjects: vi.fn(async () => undefined),
  renderArtifact: vi.fn(async () => ({ buffer: Buffer.from('x'), contentType: 'application/pdf', ext: 'pdf' })),
  generateText: vi.fn<(...args: unknown[]) => Promise<{ text: string; finishReason: string; totalUsage: typeof FAKE_TOTAL_USAGE }>>(
    async () => ({ text: '# revised', finishReason: 'stop', totalUsage: FAKE_TOTAL_USAGE })
  ),
  // Prior C8: the model comes from the live registry, never a hardcoded id.
  resolveRequestedModel: vi.fn<(requested?: string) => Promise<{ modelId: string; usedFallback: boolean }>>(
    async () => ({ modelId: 'claude-sonnet-5', usedFallback: false })
  ),
  // Usage capture (Task 10) — mocked so this file asserts the wiring;
  // recordUsage itself is covered against PGlite in tests/unit/lib/usage.test.ts.
  recordUsage: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({ getArtifactById: m.getArtifactById, addArtifactVersion: m.addArtifactVersion }))
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: m.isStorageConfigured, uploadBuffer: m.uploadBuffer,
    signedArtifactUrl: m.signedArtifactUrl, removeObjects: m.removeObjects,
  }))
  vi.doMock('@/lib/artifacts/render', () => ({ renderArtifact: m.renderArtifact }))
  vi.doMock('@/lib/settings', () => ({ getAnthropicApiKey: () => Promise.resolve('test-anthropic-key') }))
  vi.doMock('ai', () => ({ generateText: (...args: unknown[]) => m.generateText(...args) }))
  vi.doMock('@ai-sdk/anthropic', () => ({
    createAnthropic: () => vi.fn((model: string) => ({ modelId: model })),
  }))
  vi.doMock('@/lib/usage', () => ({ recordUsage: (...args: unknown[]) => m.recordUsage(...args) }))
  vi.doMock('@/lib/models/registry', () => ({ resolveRequestedModel: (r?: string) => m.resolveRequestedModel(r) }))
  const { POST } = await import('@/app/api/artifacts/[id]/regenerate/route')
  return POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/artifacts/1/regenerate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/artifacts/[id]/regenerate', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.isStorageConfigured.mockReturnValue(true)
    m.uploadBuffer.mockResolvedValue(undefined)
    m.signedArtifactUrl.mockImplementation(async (p: string) => `signed:${p}`)
    m.renderArtifact.mockResolvedValue({ buffer: Buffer.from('x'), contentType: 'application/pdf', ext: 'pdf' })
    m.addArtifactVersion.mockResolvedValue({ version: 2 })
    m.generateText.mockResolvedValue({ text: '# revised', finishReason: 'stop', totalUsage: FAKE_TOTAL_USAGE })
    m.recordUsage.mockResolvedValue(undefined)
    m.resolveRequestedModel.mockResolvedValue({ modelId: 'claude-sonnet-5', usedFallback: false })
  })

  it('regenerates and records Claude usage against the artifact chat/project', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, chatId: 42, projectId: 5, type: 'pdf', title: 'Report', format: 'markdown', content: '# old' })
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'shorten it' }), ctx('1'))
    expect(res.status).toBe(200)
    expect((await res.json()).version).toBe(2)
    expect(m.recordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: 42,
      projectId: 5,
      purpose: 'artifact-regenerate',
      model: 'claude-sonnet-5',
      usage: FAKE_TOTAL_USAGE,
    })
  })

  it('still records usage when the regenerated content fails to parse (tokens were spent)', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, chatId: 42, projectId: null, type: 'xlsx', title: 'Sheet', format: 'sheets', content: '[]' })
    m.generateText.mockResolvedValue({ text: 'not json at all', finishReason: 'stop', totalUsage: FAKE_TOTAL_USAGE })
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'add a row' }), ctx('1'))
    expect(res.status).toBe(422)
    expect(m.addArtifactVersion).not.toHaveBeenCalled()
    expect(m.recordUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ purpose: 'artifact-regenerate', projectId: null, usage: FAKE_TOTAL_USAGE })
    )
  })

  it('resolves the model through the registry (Sonnet tier) and records the resolved id (prior C8)', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, chatId: 42, projectId: 5, type: 'pdf', title: 'Report', format: 'markdown', content: '# old' })
    m.resolveRequestedModel.mockResolvedValue({ modelId: 'claude-sonnet-6-20270101', usedFallback: false })
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'shorten it' }), ctx('1'))
    expect(res.status).toBe(200)
    expect(m.resolveRequestedModel).toHaveBeenCalledWith('sonnet')
    const args = m.generateText.mock.calls[0]![0] as { model: { modelId: string }; maxOutputTokens: number }
    expect(args.model.modelId).toBe('claude-sonnet-6-20270101')
    expect(m.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-6-20270101' }))
  })

  it("uses the chat route's output cap (audit B6)", async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, chatId: 42, projectId: 5, type: 'html', title: 'Page', format: 'html', content: '<html></html>' })
    const POST = await importRoute()
    await POST(req({ instruction: 'make the header blue' }), ctx('1'))
    const { ARTIFACT_MAX_OUTPUT_TOKENS } = await import('@/lib/artifacts/limits')
    const args = m.generateText.mock.calls[0]![0] as { maxOutputTokens: number }
    expect(ARTIFACT_MAX_OUTPUT_TOKENS).toBe(32000)
    expect(args.maxOutputTokens).toBe(ARTIFACT_MAX_OUTPUT_TOKENS)
  })

  it('returns 422 and writes no version when the output hit the token cap (audit B6)', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, chatId: 42, projectId: 5, type: 'html', title: 'Page', format: 'html', content: '<html></html>' })
    m.generateText.mockResolvedValue({ text: '<html><body><h1>Cut o', finishReason: 'length', totalUsage: FAKE_TOTAL_USAGE })
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'make the header blue' }), ctx('1'))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/cut off|too long/i)
    expect(m.renderArtifact).not.toHaveBeenCalled()
    expect(m.uploadBuffer).not.toHaveBeenCalled()
    expect(m.addArtifactVersion).not.toHaveBeenCalled()
    // The tokens were still spent.
    expect(m.recordUsage).toHaveBeenCalledOnce()
  })

  it('returns 422 when regenerated sheets are not {name, rows} objects (audit B14)', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, chatId: 42, projectId: null, type: 'xlsx', title: 'Sheet', format: 'sheets', content: '[]' })
    m.generateText.mockResolvedValue({ text: '[{"title":"T","cells":[1,2]}]', finishReason: 'stop', totalUsage: FAKE_TOTAL_USAGE })
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'add a row' }), ctx('1'))
    expect(res.status).toBe(422)
    expect(m.renderArtifact).not.toHaveBeenCalled()
    expect(m.addArtifactVersion).not.toHaveBeenCalled()
  })

  it('does not call Claude or record usage when the artifact is missing', async () => {
    m.getArtifactById.mockResolvedValue(null)
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'x' }), ctx('1'))
    expect(res.status).toBe(404)
    expect(m.generateText).not.toHaveBeenCalled()
    expect(m.recordUsage).not.toHaveBeenCalled()
  })
})
