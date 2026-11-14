import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsConfigured = vi.fn()
const mockCreateSignedUploadUrl = vi.fn()

// Storage is always mocked — these tests never reach Supabase.
async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: mockIsConfigured,
    createSignedUploadUrl: mockCreateSignedUploadUrl,
    storageBucketName: 'atelier-files',
    sanitizeStorageName: (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_'),
  }))
  const { POST } = await import('@/app/api/attachments/upload-url/route')
  return POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/attachments/upload-url', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

describe('POST /api/attachments/upload-url', () => {
  beforeEach(() => {
    mockIsConfigured.mockReset().mockReturnValue(true)
    mockCreateSignedUploadUrl.mockReset().mockImplementation(async (path: string) => ({ path, token: 'tok' }))
  })

  it('503 when storage is not configured (the client falls back to multipart)', async () => {
    mockIsConfigured.mockReturnValue(false)
    const POST = await importRoute()
    const res = await POST(req({ chatId: 4, filename: 'a.pdf', mediaType: 'application/pdf', size: 10 }) as never)
    expect(res.status).toBe(503)
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('upload-url-validates-size-and-type: rejects an oversized file', async () => {
    const { MAX_FILE_SIZE } = await import('@/lib/fileExtraction')
    const POST = await importRoute()
    const res = await POST(req({ chatId: 4, filename: 'a.pdf', mediaType: 'application/pdf', size: MAX_FILE_SIZE + 1 }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('File too large')
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('upload-url-validates-size-and-type: rejects types the text extractor cannot read', async () => {
    const POST = await importRoute()
    for (const [filename, mediaType] of [
      ['a.exe', 'application/octet-stream'],
      ['logo.svg', 'image/svg+xml'],
      // Images go inline with the chat message, never through extraction.
      ['photo.png', 'image/png'],
    ]) {
      const res = await POST(req({ chatId: 4, filename, mediaType, size: 10 }) as never)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('Unsupported file type')
    }
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('400 for a malformed body', async () => {
    const POST = await importRoute()
    const res = await POST(req({ chatId: 'x', filename: '', size: -1 }) as never)
    expect(res.status).toBe(400)
  })

  it('mints a token for a pending path under the chat prefix', async () => {
    const POST = await importRoute()
    const res = await POST(req({ chatId: 4, filename: 'Geotech Report (final).pdf', mediaType: 'application/pdf', size: 20 * 1024 * 1024 }) as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.token).toBe('tok')
    expect(data.bucket).toBe('atelier-files')
    expect(data.path).toMatch(new RegExp(`^attachments/4/pending/${UUID.source}-Geotech_Report__final_\.pdf$`))
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith(data.path)
  })

  it('uses the compose prefix before the chat exists (first message of a new chat)', async () => {
    const POST = await importRoute()
    const res = await POST(req({ chatId: null, filename: 'notes.txt', mediaType: 'text/plain', size: 5 }) as never)
    expect(res.status).toBe(200)
    const { path } = await res.json()
    expect(path).toMatch(new RegExp(`^attachments/compose/pending/${UUID.source}-notes\.txt$`))
  })

  it('a hostile filename cannot climb out of the pending prefix', async () => {
    const POST = await importRoute()
    const res = await POST(req({ chatId: 4, filename: '../../documents/1/2/x.txt', mediaType: 'text/plain', size: 5 }) as never)
    const { path } = await res.json()
    expect(path.startsWith('attachments/4/pending/')).toBe(true)
    expect(path.slice('attachments/4/pending/'.length)).not.toContain('/')
  })
})
