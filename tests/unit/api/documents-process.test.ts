import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  getDocumentById: vi.fn(), updateDocumentStatus: vi.fn(), saveDocumentChunks: vi.fn(), updateChunkEmbedding: vi.fn(),
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
  }))
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: m.ensureEmbeddingModel, generateEmbedding: m.generateEmbedding }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: m.chunkText }))
  vi.doMock('@/lib/storage', () => ({ downloadToBuffer: m.downloadToBuffer, uploadBuffer: m.uploadBuffer }))
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
    m.extractViaVision.mockResolvedValue('')
    m.extractViaVisionImage.mockResolvedValue('')
  })

  it('404 when the document or its storagePath is missing', async () => {
    m.getDocumentById.mockResolvedValue(null)
    const POST = await importRoute()
    expect((await POST(req(1) as never)).status).toBe(404)
  })

  it('text PDF: downloads, extracts text, uploads thumbnail, embeds, status ready', async () => {
    m.getDocumentById.mockResolvedValue({ id: 7, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'documents/1/7/doc.pdf' })
    m.extractTextFromBuffer.mockResolvedValue('A'.repeat(300))
    const POST = await importRoute()
    const res = await POST(req(7) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ready')
    expect(m.downloadToBuffer).toHaveBeenCalledWith('documents/1/7/doc.pdf')
    expect(m.extractViaVision).not.toHaveBeenCalled()
    expect(m.uploadBuffer).toHaveBeenCalled()
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ chunkCount: 1, thumbnailPath: expect.stringContaining('thumb.webp') }))
  })

  it('thin-text PDF falls back to vision', async () => {
    m.getDocumentById.mockResolvedValue({ id: 8, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('')
    m.extractViaVision.mockResolvedValue('V'.repeat(300))
    const POST = await importRoute()
    const res = await POST(req(8) as never)
    expect(res.status).toBe(200)
    expect(m.extractViaVision).toHaveBeenCalled()
    expect(m.chunkText).toHaveBeenCalledWith('V'.repeat(300))
  })

  it('image upload uses extractViaVisionImage + image thumbnail', async () => {
    m.getDocumentById.mockResolvedValue({ id: 9, projectId: 1, filename: 'p.png', mimeType: 'image/png', storagePath: 'p' })
    m.extractViaVisionImage.mockResolvedValue('image text here')
    const POST = await importRoute()
    const res = await POST(req(9) as never)
    expect(res.status).toBe(200)
    expect(m.extractViaVisionImage).toHaveBeenCalled()
    expect(m.generateImageThumbnail).toHaveBeenCalled()
    expect(m.extractTextFromBuffer).not.toHaveBeenCalled()
  })

  it('thumbnail failure is non-fatal (still ready, no thumbnailPath)', async () => {
    m.getDocumentById.mockResolvedValue({ id: 10, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('A'.repeat(300))
    m.generatePdfThumbnail.mockRejectedValue(new Error('render boom'))
    const POST = await importRoute()
    const res = await POST(req(10) as never)
    expect(res.status).toBe(200)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(10, 'ready', expect.objectContaining({ thumbnailPath: undefined }))
  })

  it('empty extraction → error status + 400', async () => {
    m.getDocumentById.mockResolvedValue({ id: 12, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('')
    m.extractViaVision.mockResolvedValue('')
    const POST = await importRoute()
    const res = await POST(req(12) as never)
    expect(res.status).toBe(400)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(12, 'error', expect.objectContaining({ errorMessage: expect.any(String) }))
  })
})
