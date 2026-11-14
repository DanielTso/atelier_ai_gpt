import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsConfigured = vi.fn()
const mockCreateSignedUploadUrl = vi.fn()
const mockCreateUploading = vi.fn()
const mockSetPath = vi.fn()
const mockGetDocumentById = vi.fn()
const mockUpdateDocumentStatus = vi.fn()
const mockDeleteDocument = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: mockIsConfigured,
    createSignedUploadUrl: mockCreateSignedUploadUrl,
    storageBucketName: 'atelier-files',
    sanitizeStorageName: (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_'),
  }))
  vi.doMock('@/app/actions', () => ({
    createUploadingDocument: mockCreateUploading,
    updateDocumentStoragePath: mockSetPath,
    getDocumentById: mockGetDocumentById,
    updateDocumentStatus: mockUpdateDocumentStatus,
    deleteDocument: mockDeleteDocument,
  }))
  const { POST } = await import('@/app/api/documents/upload-url/route')
  return POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/documents/upload-url', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/upload-url', () => {
  beforeEach(() => {
    [mockIsConfigured, mockCreateSignedUploadUrl, mockCreateUploading, mockSetPath,
      mockGetDocumentById, mockUpdateDocumentStatus, mockDeleteDocument].forEach(f => f.mockReset())
    mockIsConfigured.mockReturnValue(true)
    mockCreateUploading.mockResolvedValue([{ id: 7, projectId: 1 }])
    mockSetPath.mockResolvedValue([{ id: 7 }])
    mockCreateSignedUploadUrl.mockResolvedValue({ path: 'documents/1/7/plan.pdf', token: 'tok' })
    mockDeleteDocument.mockResolvedValue([])
    mockGetDocumentById.mockResolvedValue({ id: 20, projectId: 1, revision: 2, status: 'ready', chunkCount: 4 })
  })

  it('503 when storage not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const POST = await importRoute()
    const res = await POST(req({ projectId: 1, filename: 'a.pdf', contentType: 'application/pdf', size: 10 }) as never)
    expect(res.status).toBe(503)
  })

  it('400 for oversize', async () => {
    const { MAX_FILE_SIZE } = await import('@/lib/fileExtraction')
    const POST = await importRoute()
    const res = await POST(req({ projectId: 1, filename: 'a.pdf', contentType: 'application/pdf', size: MAX_FILE_SIZE + 1 }) as never)
    expect(res.status).toBe(400)
  })

  it('400 for unsupported type', async () => {
    const POST = await importRoute()
    const res = await POST(req({ projectId: 1, filename: 'a.exe', contentType: 'application/octet-stream', size: 10 }) as never)
    expect(res.status).toBe(400)
  })

  it('400 for svg smuggled via an image/* MIME (scriptable format, not in the raster allow-list)', async () => {
    const POST = await importRoute()
    const res = await POST(req({ projectId: 1, filename: 'logo.svg', contentType: 'image/svg+xml', size: 10 }) as never)
    expect(res.status).toBe(400)
  })

  it('creates row, sets path, returns documentId + token (image allowed)', async () => {
    const POST = await importRoute()
    const res = await POST(req({ projectId: 1, filename: 'plan.png', contentType: 'image/png', size: 10 }) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.documentId).toBe(7)
    expect(data.token).toBe('tok')
    expect(data.path).toBe('documents/1/7/plan.png')
    expect(mockSetPath).toHaveBeenCalled()
  })

  // Audit B25: the row is inserted before the URL is signed (the path needs the
  // row id), so a signing failure must delete the row instead of leaving an
  // 'uploading' orphan for the 60-minute reaper.
  it('signing failure on a new upload deletes the row it just created', async () => {
    mockCreateSignedUploadUrl.mockRejectedValue(new Error('storage down'))
    const POST = await importRoute()
    const res = await POST(req({ projectId: 1, filename: 'plan.pdf', contentType: 'application/pdf', size: 10 }) as never)
    expect(res.status).toBe(500)
    expect(mockDeleteDocument).toHaveBeenCalledWith(7)
  })

  // Audit X7: a replace used to flip the document to 'uploading' before any byte
  // moved, so an abandoned replace hid a healthy document and the reaper later
  // marked it 'error'. The previous revision stays active until /process claims it.
  it('replace: returns the next revision path without touching the document status', async () => {
    const POST = await importRoute()
    const res = await POST(req({ filename: 'new.pdf', contentType: 'application/pdf', size: 10, replaceDocumentId: 20 }) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.path).toBe('documents/1/20/rev3/new.pdf')
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith('documents/1/20/rev3/new.pdf', { upsert: true })
    expect(mockUpdateDocumentStatus).not.toHaveBeenCalled()
  })

  it('replace: signing failure leaves the document as it was', async () => {
    mockCreateSignedUploadUrl.mockRejectedValue(new Error('storage down'))
    const POST = await importRoute()
    const res = await POST(req({ filename: 'new.pdf', contentType: 'application/pdf', size: 10, replaceDocumentId: 20 }) as never)
    expect(res.status).toBe(500)
    expect(mockUpdateDocumentStatus).not.toHaveBeenCalled()
    expect(mockDeleteDocument).not.toHaveBeenCalled()
  })
})
