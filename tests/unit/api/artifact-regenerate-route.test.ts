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
  generateText: vi.fn<(...args: unknown[]) => Promise<{ text: string; totalUsage: typeof FAKE_TOTAL_USAGE }>>(
    async () => ({ text: '# revised', totalUsage: FAKE_TOTAL_USAGE })
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
    m.generateText.mockResolvedValue({ text: '# revised', totalUsage: FAKE_TOTAL_USAGE })
    m.recordUsage.mockResolvedValue(undefined)
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
    m.generateText.mockResolvedValue({ text: 'not json at all', totalUsage: FAKE_TOTAL_USAGE })
    const POST = await importRoute()
    const res = await POST(req({ instruction: 'add a row' }), ctx('1'))
    expect(res.status).toBe(422)
    expect(m.addArtifactVersion).not.toHaveBeenCalled()
    expect(m.recordUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ purpose: 'artifact-regenerate', projectId: null, usage: FAKE_TOTAL_USAGE })
    )
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
