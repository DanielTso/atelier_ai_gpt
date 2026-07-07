import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  getDocumentById: vi.fn(), updateDocumentStatus: vi.fn(), saveDocumentChunks: vi.fn(), updateChunkEmbedding: vi.fn(),
  createDocumentRevision: vi.fn(), commitDocumentReplacement: vi.fn(),
  ensureEmbeddingModel: vi.fn(), generateEmbedding: vi.fn(), chunkText: vi.fn(),
  downloadToBuffer: vi.fn(), uploadBuffer: vi.fn(),
  generatePdfThumbnail: vi.fn(), generateImageThumbnail: vi.fn(),
  extractTextFromBuffer: vi.fn(), extractViaVision: vi.fn(), extractViaVisionImage: vi.fn(),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    getDocumentById: m.getDocumentById, updateDocumentStatus: m.updateDocumentStatus,
    saveDocumentChunks: m.saveDocumentChunks, updateChunkEmbedding: m.updateChunkEmbedding,
    createDocumentRevision: m.createDocumentRevision, commitDocumentReplacement: m.commitDocumentReplacement,
  }))
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: m.ensureEmbeddingModel, generateEmbedding: m.generateEmbedding }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: m.chunkText }))
  vi.doMock('@/lib/storage', () => ({ downloadToBuffer: m.downloadToBuffer, uploadBuffer: m.uploadBuffer, sanitizeStorageName: (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_') }))
  vi.doMock('@/lib/thumbnails', () => ({ generatePdfThumbnail: m.generatePdfThumbnail, generateImageThumbnail: m.generateImageThumbnail }))
  vi.doMock('@/lib/visionExtraction', () => ({ extractViaVision: m.extractViaVision, extractViaVisionImage: m.extractViaVisionImage }))
  vi.doMock('@/lib/fileExtraction', async (orig) => ({ ...(await (orig as () => Promise<Record<string, unknown>>)()), extractTextFromBuffer: m.extractTextFromBuffer }))
  const { POST } = await import('@/app/api/documents/process/route')
  return POST
}

function req(documentId: number) {
  return new Request('http://localhost/api/documents/process', {
    method: 'POST', body: JSON.stringify({ documentId }), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/process', () => {
  const extRes = (text: string, extra: Partial<{ pageCount: number | null; pagesExtracted: number | null; partial: boolean }> = {}) =>
    ({ text, pageCount: null, pagesExtracted: null, partial: false, ...extra })

  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.ensureEmbeddingModel.mockResolvedValue({ available: true })
    m.downloadToBuffer.mockResolvedValue(Buffer.from('bytes'))
    m.chunkText.mockReturnValue([{ index: 0, content: 'chunk' }])
    m.saveDocumentChunks.mockResolvedValue([{ id: 11, content: 'chunk' }])
    m.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1))
    m.updateChunkEmbedding.mockResolvedValue(undefined)
    m.updateDocumentStatus.mockResolvedValue(undefined)
    m.uploadBuffer.mockResolvedValue(undefined)
    m.generatePdfThumbnail.mockResolvedValue(Buffer.from('thumb'))
    m.generateImageThumbnail.mockResolvedValue(Buffer.from('thumb'))
    m.extractViaVision.mockResolvedValue(extRes(''))
    m.extractViaVisionImage.mockResolvedValue(extRes(''))
  })

  it('404 when the document or its storagePath is missing', async () => {
    m.getDocumentById.mockResolvedValue(null)
    const POST = await importRoute()
    expect((await POST(req(1) as never)).status).toBe(404)
  })

  it('text PDF: downloads, extracts text, uploads thumbnail, embeds, status ready', async () => {
    m.getDocumentById.mockResolvedValue({ id: 7, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'documents/1/7/doc.pdf' })
    m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300)))
    const POST = await importRoute()
    const res = await POST(req(7) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ready')
    expect(m.downloadToBuffer).toHaveBeenCalledWith('documents/1/7/doc.pdf')
    expect(m.extractViaVision).not.toHaveBeenCalled()
    expect(m.uploadBuffer).toHaveBeenCalled()
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ chunkCount: 1, thumbnailPath: expect.stringContaining('thumb.webp') }))
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ extractionMethod: 'text' }))
  })

  it('thin-text PDF falls back to vision', async () => {
    m.getDocumentById.mockResolvedValue({ id: 8, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue(extRes(''))
    m.extractViaVision.mockResolvedValue(extRes('V'.repeat(300)))
    const POST = await importRoute()
    const res = await POST(req(8) as never)
    expect(res.status).toBe(200)
    expect(m.extractViaVision).toHaveBeenCalled()
    expect(m.chunkText).toHaveBeenCalledWith('V'.repeat(300))
  })

  it('image upload uses extractViaVisionImage + image thumbnail', async () => {
    m.getDocumentById.mockResolvedValue({ id: 9, projectId: 1, filename: 'p.png', mimeType: 'image/png', storagePath: 'p' })
    m.extractViaVisionImage.mockResolvedValue(extRes('image text here'))
    const POST = await importRoute()
    const res = await POST(req(9) as never)
    expect(res.status).toBe(200)
    expect(m.extractViaVisionImage).toHaveBeenCalled()
    expect(m.generateImageThumbnail).toHaveBeenCalled()
    expect(m.extractTextFromBuffer).not.toHaveBeenCalled()
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(9, 'ready', expect.objectContaining({ extractionMethod: 'vision' }))
  })

  it('thumbnail failure is non-fatal (still ready, no thumbnailPath)', async () => {
    m.getDocumentById.mockResolvedValue({ id: 10, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300)))
    m.generatePdfThumbnail.mockRejectedValue(new Error('render boom'))
    const POST = await importRoute()
    const res = await POST(req(10) as never)
    expect(res.status).toBe(200)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(10, 'ready', expect.objectContaining({ thumbnailPath: undefined }))
  })

  it('empty extraction → error status + 400', async () => {
    m.getDocumentById.mockResolvedValue({ id: 12, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue(extRes(''))
    m.extractViaVision.mockResolvedValue(extRes(''))
    const POST = await importRoute()
    const res = await POST(req(12) as never)
    expect(res.status).toBe(400)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(12, 'error', expect.objectContaining({ errorMessage: expect.any(String) }))
  })

  it('thin-text PDF that falls back to vision records extractionMethod vision', async () => {
    m.getDocumentById.mockResolvedValue({ id: 14, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue(extRes(''))
    m.extractViaVision.mockResolvedValue(extRes('V'.repeat(300)))
    const POST = await importRoute()
    await POST(req(14) as never)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(14, 'ready', expect.objectContaining({ extractionMethod: 'vision' }))
  })

  it('replace path: embeds first, then atomically commits (no pre-delete of old chunks)', async () => {
    m.getDocumentById.mockResolvedValue({ id: 20, projectId: 1, revision: 1, filename: 'old.pdf', mimeType: 'application/pdf', fileSize: 5, storagePath: 'documents/1/20/old.pdf', thumbnailPath: null, charCount: 10, chunkCount: 1, extractionMethod: 'text' })
    m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300)))
    m.createDocumentRevision.mockResolvedValue([{ id: 1 }])
    m.commitDocumentReplacement.mockResolvedValue(undefined)
    const POST = await importRoute()
    const res = await POST(new Request('http://localhost/api/documents/process', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 20, filename: 'new.pdf', mimeType: 'application/pdf', fileSize: 9 }),
    }) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ready')
    expect(data.revision).toBe(2)
    // snapshot of the old revision is taken, and the swap is the transactional commit
    expect(m.createDocumentRevision).toHaveBeenCalled()
    expect(m.commitDocumentReplacement).toHaveBeenCalledWith(20, 1, expect.any(Array), expect.objectContaining({
      revision: 2, status: 'ready', storagePath: 'documents/1/20/rev2/new.pdf',
    }))
    // new-upload helpers are NOT used on the replace path
    expect(m.saveDocumentChunks).not.toHaveBeenCalled()
  })

  it('replace path: all embeddings fail → committed with status error (old revision not lost mid-flight)', async () => {
    m.getDocumentById.mockResolvedValue({ id: 21, projectId: 1, revision: 3, filename: 'old.pdf', mimeType: 'application/pdf', fileSize: 5, storagePath: 'p', thumbnailPath: null, charCount: 10, chunkCount: 1, extractionMethod: 'text' })
    m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300)))
    m.generateEmbedding.mockRejectedValue(new Error('embed down'))
    m.createDocumentRevision.mockResolvedValue([{ id: 1 }])
    m.commitDocumentReplacement.mockResolvedValue(undefined)
    const POST = await importRoute()
    const res = await POST(new Request('http://localhost/api/documents/process', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 21, filename: 'new.pdf', mimeType: 'application/pdf', fileSize: 9 }),
    }) as never)
    const data = await res.json()
    expect(data.status).toBe('error')
    expect(m.commitDocumentReplacement).toHaveBeenCalledWith(21, 1, expect.any(Array), expect.objectContaining({ status: 'error' }))
  })

  it('replace path: rejects an unsupported declared file type before downloading', async () => {
    m.getDocumentById.mockResolvedValue({ id: 22, projectId: 1, revision: 1, filename: 'old.pdf', mimeType: 'application/pdf', fileSize: 5, storagePath: 'documents/1/22/old.pdf', thumbnailPath: null, charCount: 10, chunkCount: 1, extractionMethod: 'text' })
    const POST = await importRoute()
    const res = await POST(new Request('http://localhost/api/documents/process', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 22, filename: 'malware.exe', mimeType: 'application/octet-stream', fileSize: 9 }),
    }) as never)
    expect(res.status).toBe(400)
    expect(m.downloadToBuffer).not.toHaveBeenCalled()
  })

  it('replace path: rejects an oversize declared file before downloading', async () => {
    m.getDocumentById.mockResolvedValue({ id: 23, projectId: 1, revision: 1, filename: 'old.pdf', mimeType: 'application/pdf', fileSize: 5, storagePath: 'p', thumbnailPath: null, charCount: 10, chunkCount: 1, extractionMethod: 'text' })
    const POST = await importRoute()
    const res = await POST(new Request('http://localhost/api/documents/process', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 23, filename: 'big.pdf', mimeType: 'application/pdf', fileSize: 300 * 1024 * 1024 }),
    }) as never)
    expect(res.status).toBe(400)
    expect(m.downloadToBuffer).not.toHaveBeenCalled()
  })

  it('extractor throwing (corrupt file) → error status + 500, not stuck processing', async () => {
    m.getDocumentById.mockResolvedValue({ id: 13, projectId: 1, filename: 'corrupt.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockRejectedValue(new Error('pdfjs worker crashed'))
    const POST = await importRoute()
    const res = await POST(req(13) as never)
    expect(res.status).toBe(500)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(13, 'error', expect.objectContaining({ errorMessage: expect.any(String) }))
  })
})
