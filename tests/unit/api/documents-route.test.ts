import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetProjectDocuments = vi.fn()
const mockGetDocumentById = vi.fn()
const mockDeleteDocument = vi.fn()
const mockCreateSignedDownloadUrl = vi.fn()
const mockRemoveObjects = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    getProjectDocuments: mockGetProjectDocuments,
    getDocumentById: mockGetDocumentById,
    deleteDocument: mockDeleteDocument,
    getDocumentRevisions: vi.fn(async () => []),
  }))
  vi.doMock('@/lib/storage', () => ({
    createSignedDownloadUrl: mockCreateSignedDownloadUrl,
    removeObjects: mockRemoveObjects,
  }))
  return await import('@/app/api/documents/route')
}

describe('GET /api/documents', () => {
  beforeEach(() => {
    [mockGetProjectDocuments, mockGetDocumentById, mockDeleteDocument, mockCreateSignedDownloadUrl, mockRemoveObjects].forEach(f => f.mockReset())
    mockCreateSignedDownloadUrl.mockImplementation((p: string) => Promise.resolve(`signed:${p}`))
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
  })
})

describe('DELETE /api/documents', () => {
  beforeEach(() => {
    [mockGetProjectDocuments, mockGetDocumentById, mockDeleteDocument, mockCreateSignedDownloadUrl, mockRemoveObjects].forEach(f => f.mockReset())
  })

  it('removes storage objects then deletes the row', async () => {
    mockGetDocumentById.mockResolvedValue({ id: 5, storagePath: 'documents/1/5/a.pdf', thumbnailPath: 'documents/1/5/thumb.webp' })
    mockRemoveObjects.mockResolvedValue(undefined)
    mockDeleteDocument.mockResolvedValue([{ id: 5 }])
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request('http://localhost/api/documents?id=5', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    expect(mockRemoveObjects).toHaveBeenCalledWith(['documents/1/5/a.pdf', 'documents/1/5/thumb.webp'])
    expect(mockDeleteDocument).toHaveBeenCalledWith(5)
  })
})
