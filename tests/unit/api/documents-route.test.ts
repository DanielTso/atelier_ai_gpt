import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetProjectDocuments = vi.fn()
const mockGetDocumentById = vi.fn()
const mockDeleteDocument = vi.fn()
const mockCreateSignedDownloadUrls = vi.fn()
const mockRemoveObjects = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    getProjectDocuments: mockGetProjectDocuments,
    getDocumentById: mockGetDocumentById,
    deleteDocument: mockDeleteDocument,
    getDocumentRevisions: vi.fn(async () => []),
    reapStaleProcessing: vi.fn(async () => []),
  }))
  vi.doMock('@/lib/storage', () => ({
    createSignedDownloadUrls: mockCreateSignedDownloadUrls,
    removeObjects: mockRemoveObjects,
    DOCUMENT_URL_TTL_SECONDS: 3600,
  }))
  return await import('@/app/api/documents/route')
}

describe('GET /api/documents', () => {
  beforeEach(() => {
    [mockGetProjectDocuments, mockGetDocumentById, mockDeleteDocument, mockCreateSignedDownloadUrls, mockRemoveObjects].forEach(f => f.mockReset())
    mockCreateSignedDownloadUrls.mockImplementation(async (paths: string[]) =>
      new Map(paths.map((p: string) => [`${p}`, `signed:${p}`]))
    )
  })

  it('returns docs with signed original + thumbnail URLs', async () => {
    mockGetProjectDocuments.mockResolvedValue([
      { id: 1, projectId: 1, filename: 'a.pdf', storagePath: 'documents/1/1/a.pdf', thumbnailPath: 'documents/1/1/thumb.webp', status: 'ready' },
      { id: 2, projectId: 1, filename: 'b.pdf', storagePath: null, thumbnailPath: null, status: 'uploading' },
    ])
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/documents?projectId=1') as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.documents[0].url).toBe('signed:documents/1/1/a.pdf')
    expect(data.documents[0].thumbnailUrl).toBe('signed:documents/1/1/thumb.webp')
    expect(data.documents[1].url).toBeNull()
    // originals/thumbnails get the generous document TTL (not the 300s default that expires before a click)
    expect(mockCreateSignedDownloadUrls).toHaveBeenCalledWith(['documents/1/1/a.pdf'], 3600)
    expect(mockCreateSignedDownloadUrls).toHaveBeenCalledWith(['documents/1/1/thumb.webp'], 3600)
  })

  it('passes through fidelity fields (pageCount/pagesExtracted/extractionPartial)', async () => {
    mockGetProjectDocuments.mockResolvedValue([
      { id: 1, projectId: 1, filename: 'a.pdf', storagePath: null, thumbnailPath: null, status: 'ready', pageCount: 80, pagesExtracted: 60, extractionPartial: true },
    ])
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/documents?projectId=1') as never)
    const data = await res.json()
    expect(data.documents[0].extractionPartial).toBe(true)
    expect(data.documents[0].pageCount).toBe(80)
    expect(data.documents[0].pagesExtracted).toBe(60)
  })
})

describe('DELETE /api/documents', () => {
  beforeEach(() => {
    [mockGetProjectDocuments, mockGetDocumentById, mockDeleteDocument, mockCreateSignedDownloadUrls, mockRemoveObjects].forEach(f => f.mockReset())
  })

  it('removes storage objects then deletes the row', async () => {
    mockGetDocumentById.mockResolvedValue({ id: 5, projectId: 1, storagePath: 'documents/1/5/a.pdf', thumbnailPath: 'documents/1/5/thumb.webp' })
    mockRemoveObjects.mockResolvedValue(undefined)
    mockDeleteDocument.mockResolvedValue([{ id: 5 }])
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request('http://localhost/api/documents?id=5', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    // the current file's extracted.txt is swept alongside the original + thumbnail
    expect(mockRemoveObjects).toHaveBeenCalledWith(['documents/1/5/a.pdf', 'documents/1/5/thumb.webp', 'documents/1/5/extracted.txt'])
    expect(mockDeleteDocument).toHaveBeenCalledWith(5)
  })
})
