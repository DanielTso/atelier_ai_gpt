import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock stubs declared at module scope so vi.doMock closures can reference them ──
const mockExtractTextFromBuffer = vi.fn()
const mockExtractViaVision = vi.fn()
const mockExtractViaVisionImage = vi.fn()
const mockEnsureEmbeddingModel = vi.fn()
const mockGenerateEmbedding = vi.fn()
const mockChunkText = vi.fn()
const mockCreateDocument = vi.fn()
const mockUpdateDocumentStatus = vi.fn()
const mockSaveDocumentChunks = vi.fn()
const mockUpdateChunkEmbedding = vi.fn()
const mockGetProjectDocuments = vi.fn()
const mockDeleteDocument = vi.fn()

// ── Helpers ──────────────────────────────────────────────────────────────────────

function makeFormData(file: File, projectId: number | string = 1): FormData {
  const form = new FormData()
  form.append('file', file)
  form.append('projectId', String(projectId))
  return form
}

function makeRequest(formData: FormData) {
  return new Request('http://localhost/api/documents', {
    method: 'POST',
    body: formData,
  })
}

/** Import the route fresh after calling vi.doMock() */
async function importRoute() {
  vi.resetModules()

  // Real helpers (getExtension, isSupported, isImageExtension, MAX_*) kept real;
  // only extractTextFromBuffer is overridden via the spread.
  vi.doMock('@/lib/fileExtraction', async (origFactory) => {
    const orig = await (origFactory as () => Promise<Record<string, unknown>>)()
    return {
      ...orig,
      extractTextFromBuffer: mockExtractTextFromBuffer,
    }
  })

  vi.doMock('@/lib/visionExtraction', () => ({
    extractViaVision: mockExtractViaVision,
    extractViaVisionImage: mockExtractViaVisionImage,
  }))

  vi.doMock('@/lib/embeddings', () => ({
    ensureEmbeddingModel: mockEnsureEmbeddingModel,
    generateEmbedding: mockGenerateEmbedding,
  }))

  vi.doMock('@/lib/chunking', () => ({
    chunkText: mockChunkText,
  }))

  vi.doMock('@/app/actions', () => ({
    createDocument: mockCreateDocument,
    updateDocumentStatus: mockUpdateDocumentStatus,
    saveDocumentChunks: mockSaveDocumentChunks,
    updateChunkEmbedding: mockUpdateChunkEmbedding,
    getProjectDocuments: mockGetProjectDocuments,
    deleteDocument: mockDeleteDocument,
  }))

  const { POST } = await import('@/app/api/documents/route')
  return POST
}

/** Default happy-path mocks — each test overrides what it needs */
function setHappyPathMocks(textContent: string) {
  mockEnsureEmbeddingModel.mockResolvedValue({ available: true })
  mockExtractTextFromBuffer.mockResolvedValue(textContent)
  mockExtractViaVision.mockResolvedValue('')
  mockExtractViaVisionImage.mockResolvedValue(textContent)
  mockChunkText.mockReturnValue([{ index: 0, content: textContent.slice(0, 50) }])
  mockCreateDocument.mockResolvedValue([{ id: 1, projectId: 1, filename: 'test.pdf', mimeType: 'application/pdf', fileSize: 100, charCount: textContent.length, status: 'processing' }])
  mockSaveDocumentChunks.mockResolvedValue([{ id: 10, content: textContent.slice(0, 50) }])
  mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.1))
  mockUpdateChunkEmbedding.mockResolvedValue(undefined)
  mockUpdateDocumentStatus.mockResolvedValue(undefined)
}

// ── Tests ─────────────────────────────────────────────────────────────────────────

describe('POST /api/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('text PDF path does NOT call vision when text is long enough', async () => {
    const richText = 'A'.repeat(200) // well above MIN_TEXT (100)
    setHappyPathMocks(richText)
    mockExtractViaVisionImage.mockResolvedValue('')

    const POST = await importRoute()
    const file = new File([new Uint8Array(10)], 'plan.pdf', { type: 'application/pdf' })
    const res = await POST(makeRequest(makeFormData(file)) as never)

    expect(res.status).toBe(200)
    expect(mockExtractTextFromBuffer).toHaveBeenCalledOnce()
    expect(mockExtractViaVision).not.toHaveBeenCalled()
    expect(mockExtractViaVisionImage).not.toHaveBeenCalled()
  })

  it('empty/thin-text PDF falls back to vision and uses vision transcript', async () => {
    const visionTranscript = 'V'.repeat(300) // long vision result
    mockEnsureEmbeddingModel.mockResolvedValue({ available: true })
    mockExtractTextFromBuffer.mockResolvedValue('') // empty text layer
    mockExtractViaVision.mockResolvedValue(visionTranscript)
    mockExtractViaVisionImage.mockResolvedValue('')
    mockChunkText.mockReturnValue([{ index: 0, content: visionTranscript.slice(0, 50) }])
    mockCreateDocument.mockResolvedValue([{ id: 2, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', fileSize: 50, charCount: visionTranscript.length, status: 'processing' }])
    mockSaveDocumentChunks.mockResolvedValue([{ id: 20, content: visionTranscript.slice(0, 50) }])
    mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.2))
    mockUpdateChunkEmbedding.mockResolvedValue(undefined)
    mockUpdateDocumentStatus.mockResolvedValue(undefined)

    const POST = await importRoute()
    const file = new File([new Uint8Array(10)], 'scan.pdf', { type: 'application/pdf' })
    const res = await POST(makeRequest(makeFormData(file)) as never)

    expect(res.status).toBe(200)
    expect(mockExtractViaVision).toHaveBeenCalledOnce()
    // chunkText should have received the vision transcript
    expect(mockChunkText).toHaveBeenCalledWith(visionTranscript)
  })

  it('keeps the native text layer when vision returns a shorter result', async () => {
    // Thin (< MIN_TEXT) but non-empty text layer triggers the vision fallback,
    // yet vision yields fewer chars — the correctness gate must keep native text.
    const thinText = 'T'.repeat(80) // < MIN_TEXT (100), so vision is attempted
    const shortVision = 'V'.repeat(40) // shorter than the native text layer
    mockEnsureEmbeddingModel.mockResolvedValue({ available: true })
    mockExtractTextFromBuffer.mockResolvedValue(thinText)
    mockExtractViaVision.mockResolvedValue(shortVision)
    mockExtractViaVisionImage.mockResolvedValue('')
    mockChunkText.mockReturnValue([{ index: 0, content: thinText.slice(0, 50) }])
    mockCreateDocument.mockResolvedValue([{ id: 4, projectId: 1, filename: 'thin.pdf', mimeType: 'application/pdf', fileSize: 50, charCount: thinText.length, status: 'processing' }])
    mockSaveDocumentChunks.mockResolvedValue([{ id: 40, content: thinText.slice(0, 50) }])
    mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.4))
    mockUpdateChunkEmbedding.mockResolvedValue(undefined)
    mockUpdateDocumentStatus.mockResolvedValue(undefined)

    const POST = await importRoute()
    const file = new File([new Uint8Array(10)], 'thin.pdf', { type: 'application/pdf' })
    const res = await POST(makeRequest(makeFormData(file)) as never)

    expect(res.status).toBe(200)
    expect(mockExtractViaVision).toHaveBeenCalledOnce() // fallback was attempted
    expect(mockChunkText).toHaveBeenCalledWith(thinText) // but native text was kept
  })

  it('image upload uses extractViaVisionImage and skips text extraction + vision PDF path', async () => {
    const imageText = 'Floor plan text from image'
    mockEnsureEmbeddingModel.mockResolvedValue({ available: true })
    mockExtractViaVisionImage.mockResolvedValue(imageText)
    mockExtractTextFromBuffer.mockResolvedValue('')
    mockExtractViaVision.mockResolvedValue('')
    mockChunkText.mockReturnValue([{ index: 0, content: imageText }])
    mockCreateDocument.mockResolvedValue([{ id: 3, projectId: 1, filename: 'image.png', mimeType: 'image/png', fileSize: 200, charCount: imageText.length, status: 'processing' }])
    mockSaveDocumentChunks.mockResolvedValue([{ id: 30, content: imageText }])
    mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.3))
    mockUpdateChunkEmbedding.mockResolvedValue(undefined)
    mockUpdateDocumentStatus.mockResolvedValue(undefined)

    const POST = await importRoute()
    const file = new File([new Uint8Array(50)], 'image.png', { type: 'image/png' })
    const res = await POST(makeRequest(makeFormData(file)) as never)

    expect(res.status).toBe(200)
    expect(mockExtractViaVisionImage).toHaveBeenCalledOnce()
    expect(mockExtractTextFromBuffer).not.toHaveBeenCalled()
    expect(mockExtractViaVision).not.toHaveBeenCalled()
  })
})
