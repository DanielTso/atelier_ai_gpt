import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  getArtifactById: vi.fn(),
  addArtifactVersion: vi.fn(),
  isStorageConfigured: vi.fn(() => true),
  uploadBuffer: vi.fn(async () => undefined),
  createSignedDownloadUrl: vi.fn(async (p: string) => `signed:${p}`),
  removeObjects: vi.fn(async () => undefined),
  renderArtifact: vi.fn(async () => ({ buffer: Buffer.from('x'), contentType: 'application/pdf', ext: 'pdf' })),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({ getArtifactById: m.getArtifactById, addArtifactVersion: m.addArtifactVersion }))
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: m.isStorageConfigured, uploadBuffer: m.uploadBuffer,
    createSignedDownloadUrl: m.createSignedDownloadUrl, removeObjects: m.removeObjects,
    ARTIFACT_URL_TTL_SECONDS: 86400,
  }))
  vi.doMock('@/lib/artifacts/render', () => ({ renderArtifact: m.renderArtifact }))
  const { POST } = await import('@/app/api/artifacts/[id]/edit/route')
  return POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/artifacts/1/edit', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/artifacts/[id]/edit', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.isStorageConfigured.mockReturnValue(true)
    m.uploadBuffer.mockResolvedValue(undefined)
    m.createSignedDownloadUrl.mockImplementation(async (p: string) => `signed:${p}`)
    m.renderArtifact.mockResolvedValue({ buffer: Buffer.from('x'), contentType: 'application/pdf', ext: 'pdf' })
    m.addArtifactVersion.mockResolvedValue({ version: 2 })
  })

  it('404 when the artifact is missing', async () => {
    m.getArtifactById.mockResolvedValue(null)
    const POST = await importRoute()
    const res = await POST(req({ content: '# x' }), ctx('1'))
    expect(res.status).toBe(404)
  })

  it('renders, uploads, and appends a new version', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, projectId: 5, type: 'pdf', title: 'Report', format: 'markdown', content: '# old' })
    const POST = await importRoute()
    const res = await POST(req({ content: '# new body' }), ctx('1'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.version).toBe(2)
    expect(m.uploadBuffer).toHaveBeenCalled()
    expect(m.addArtifactVersion).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'pdf', format: 'markdown', content: '# new body' }))
  })

  it('edits an html artifact, keeping format html and passing content through', async () => {
    m.getArtifactById.mockResolvedValue({ id: 1, projectId: 5, type: 'html', title: 'Landing', format: 'html', content: '<h1>old</h1>' })
    m.renderArtifact.mockResolvedValue({ buffer: Buffer.from('<h1>new</h1>'), contentType: 'text/html; charset=utf-8', ext: 'html' })
    const POST = await importRoute()
    const res = await POST(req({ content: '<h1>new</h1>' }), ctx('1'))
    expect(res.status).toBe(200)
    expect(m.renderArtifact).toHaveBeenCalledWith('html', 'Landing', '<h1>new</h1>')
    expect(m.addArtifactVersion).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'html', format: 'html', content: '<h1>new</h1>' }))
  })

  it('503 when storage is not configured', async () => {
    m.isStorageConfigured.mockReturnValue(false)
    const POST = await importRoute()
    const res = await POST(req({ content: '# x' }), ctx('1'))
    expect(res.status).toBe(503)
  })
})
