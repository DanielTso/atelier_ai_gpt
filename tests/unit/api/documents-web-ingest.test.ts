import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  isTavilyConfigured: vi.fn(), extractUrl: vi.fn(), ingestText: vi.fn(),
  createUploadingDocument: vi.fn(), updateDocumentStatus: vi.fn(), updateDocumentStoragePath: vi.fn(), getDocumentById: vi.fn(),
  ensureEmbeddingModel: vi.fn(), isStorageConfigured: vi.fn(), uploadBuffer: vi.fn(), createSignedDownloadUrl: vi.fn(),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/tavily', () => ({ isTavilyConfigured: m.isTavilyConfigured, extractUrl: m.extractUrl }))
  vi.doMock('@/lib/ingest', () => ({ ingestText: m.ingestText }))
  vi.doMock('@/app/actions', () => ({
    createUploadingDocument: m.createUploadingDocument, updateDocumentStatus: m.updateDocumentStatus,
    updateDocumentStoragePath: m.updateDocumentStoragePath, getDocumentById: m.getDocumentById,
  }))
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: m.ensureEmbeddingModel }))
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: m.isStorageConfigured, uploadBuffer: m.uploadBuffer,
    createSignedDownloadUrl: m.createSignedDownloadUrl, DOCUMENT_URL_TTL_SECONDS: 3600,
  }))
  vi.doMock('@/lib/fileExtraction', () => ({ MAX_TEXT_LENGTH: 100_000 }))
  return (await import('@/app/api/documents/web-ingest/route')).POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/documents/web-ingest', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/web-ingest', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.isTavilyConfigured.mockResolvedValue(true)
    m.isStorageConfigured.mockReturnValue(true)
    m.ensureEmbeddingModel.mockResolvedValue({ available: true })
    m.extractUrl.mockResolvedValue({ url: 'https://x.com/a', title: 'Page A', markdown: '# Page A\n\nbody' })
    m.createUploadingDocument.mockResolvedValue([{ id: 42, projectId: 1 }])
    m.updateDocumentStatus.mockResolvedValue(undefined)
    m.updateDocumentStoragePath.mockResolvedValue(undefined)
    m.uploadBuffer.mockResolvedValue(undefined)
    m.ingestText.mockResolvedValue({ status: 'ready', chunkCount: 2 })
    m.getDocumentById.mockResolvedValue({ id: 42, projectId: 1, filename: 'Page A', mimeType: 'text/markdown', status: 'ready', chunkCount: 2, extractionMethod: 'text' })
    m.createSignedDownloadUrl.mockResolvedValue('https://signed/source.md')
  })

  it('503 with no Tavily key', async () => {
    m.isTavilyConfigured.mockResolvedValue(false)
    const POST = await importRoute()
    expect((await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)).status).toBe(503)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('503 when storage is not configured', async () => {
    m.isStorageConfigured.mockReturnValue(false)
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(503)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('503 when embedding provider is unavailable', async () => {
    m.ensureEmbeddingModel.mockResolvedValue({ available: false })
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(503)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('422 when extraction is empty (no row created)', async () => {
    m.extractUrl.mockRejectedValue(new Error('No content extracted'))
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(422)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('502 when extractUrl throws a non-empty error', async () => {
    m.extractUrl.mockRejectedValue(new Error('network down'))
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(502)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('happy path: creates a markdown doc, stores source.md, ingests, returns the document', async () => {
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ready')
    expect(data.document).toMatchObject({ id: 42, mimeType: 'text/markdown', url: 'https://signed/source.md' })
    expect(m.createUploadingDocument).toHaveBeenCalledWith(expect.objectContaining({ projectId: 1, mimeType: 'text/markdown', filename: 'Page A' }))
    expect(m.uploadBuffer).toHaveBeenCalledWith('documents/1/42/source.md', expect.any(Buffer), 'text/markdown')
    expect(m.ingestText).toHaveBeenCalledWith({ id: 42, projectId: 1 }, expect.stringContaining('Source: https://x.com/a'), { extractionMethod: 'text' })
    // secret-handling: the key never appears in the response body
    expect(JSON.stringify(data)).not.toMatch(/tvly-/)
  })

  it('marks the row error and returns 500 when ingestion throws', async () => {
    m.ingestText.mockRejectedValue(new Error('db down'))
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(500)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(42, 'error', expect.objectContaining({ errorMessage: expect.any(String) }))
  })
})
