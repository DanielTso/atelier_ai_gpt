import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsConfigured = vi.fn()
const mockCreateSignedUploadUrl = vi.fn()
const mockCreateUploading = vi.fn()
const mockSetPath = vi.fn()

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
    [mockIsConfigured, mockCreateSignedUploadUrl, mockCreateUploading, mockSetPath].forEach(f => f.mockReset())
    mockIsConfigured.mockReturnValue(true)
    mockCreateUploading.mockResolvedValue([{ id: 7, projectId: 1 }])
    mockSetPath.mockResolvedValue([{ id: 7 }])
    mockCreateSignedUploadUrl.mockResolvedValue({ path: 'documents/1/7/plan.pdf', token: 'tok' })
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
})
