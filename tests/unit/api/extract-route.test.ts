import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('POST /api/extract', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function importRoute() {
    const { POST } = await import('@/app/api/extract/route')
    return POST
  }

  function createFormData(file: File): FormData {
    const form = new FormData()
    form.append('file', file)
    return form
  }

  function createRequest(formData: FormData) {
    return new Request('http://localhost/api/extract', {
      method: 'POST',
      body: formData,
    })
  }

  it('returns 400 for no file', async () => {
    const POST = await importRoute()
    const form = new FormData()
    const request = createRequest(form)

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('No file provided')
  })

  it('returns 400 for unsupported file type', async () => {
    const POST = await importRoute()
    const file = new File(['data'], 'image.png', { type: 'image/png' })
    const form = createFormData(file)
    const request = createRequest(form)

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Unsupported file type')
  })

  it('returns 400 for oversized file', async () => {
    const { MAX_FILE_SIZE } = await import('@/lib/fileExtraction')
    const POST = await importRoute()
    // Just over the limit (derived from the constant so it tracks future changes).
    const file = new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'large.txt', { type: 'text/plain' })
    const form = createFormData(file)
    const request = createRequest(form)

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('File too large')
  })

  it('extracts text from plain text file', async () => {
    const POST = await importRoute()
    const content = 'Hello, this is a test file.'
    const file = new File([content], 'test.txt', { type: 'text/plain' })
    const form = createFormData(file)
    const request = createRequest(form)

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.filename).toBe('test.txt')
    expect(data.mimeType).toBe('text/plain')
    expect(data.textContent).toBe(content)
    expect(data.charCount).toBe(content.length)
    expect(data.truncated).toBe(false)
  })

  it('returns proper JSON structure', async () => {
    const POST = await importRoute()
    const file = new File(['test content'], 'code.py', { type: 'text/x-python' })
    const form = createFormData(file)
    const request = createRequest(form)

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('filename')
    expect(data).toHaveProperty('mimeType')
    expect(data).toHaveProperty('textContent')
    expect(data).toHaveProperty('charCount')
    expect(data).toHaveProperty('truncated')
  })

  it('handles markdown files', async () => {
    const POST = await importRoute()
    const content = '# Heading\n\nSome **bold** text.'
    const file = new File([content], 'readme.md', { type: 'text/markdown' })
    const form = createFormData(file)
    const request = createRequest(form)

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.textContent).toBe(content)
  })
})

// Large chat attachments go browser → Storage (signed upload) and the route
// extracts from the stored object, so the file never crosses Vercel's 4.5 MB
// request-body limit. Storage is mocked; these tests never reach Supabase.
describe('POST /api/extract { chatId, storagePath }', () => {
  const mockIsConfigured = vi.fn()
  const mockDownload = vi.fn()
  const mockRemove = vi.fn()
  const UUID = '0b8f6a52-3c1e-4d7a-9f10-2a6b5c4d3e21'

  beforeEach(() => {
    vi.resetModules()
    mockIsConfigured.mockReset().mockReturnValue(true)
    mockDownload.mockReset().mockResolvedValue(Buffer.from('Boring log B-3: stiff clay to 12 ft.'))
    mockRemove.mockReset().mockResolvedValue(undefined)
    vi.doMock('@/lib/storage', () => ({
      isStorageConfigured: mockIsConfigured,
      downloadToBuffer: mockDownload,
      removeObjects: mockRemove,
    }))
  })

  afterEach(() => {
    vi.doUnmock('@/lib/storage')
  })

  async function post(body: unknown) {
    const { POST } = await import('@/app/api/extract/route')
    const res = await POST(new Request('http://localhost/api/extract', {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }) as never)
    return { res, data: await res.json() }
  }

  it('extract-by-storage-path: reads the object from Storage and extracts it', async () => {
    const storagePath = `attachments/7/pending/${UUID}-geotech.txt`
    const { res, data } = await post({ chatId: 7, storagePath, mediaType: 'text/plain' })
    expect(res.status).toBe(200)
    expect(mockDownload).toHaveBeenCalledWith(storagePath)
    expect(data.textContent).toBe('Boring log B-3: stiff clay to 12 ft.')
    expect(data.charCount).toBe(data.textContent.length)
    expect(data.filename).toBe('geotech.txt')
    expect(data.truncated).toBe(false)
  })

  it('deletes the pending object once extracted (the text travels in the message)', async () => {
    const storagePath = `attachments/7/pending/${UUID}-geotech.txt`
    await post({ chatId: 7, storagePath })
    expect(mockRemove).toHaveBeenCalledWith([storagePath])
  })

  it('accepts the compose prefix when the chat does not exist yet', async () => {
    const storagePath = `attachments/compose/pending/${UUID}-notes.md`
    const { res } = await post({ chatId: null, storagePath })
    expect(res.status).toBe(200)
  })

  it('extract-by-storage-path: a path outside attachments/<chatId>/pending/ is a 400 and is never read', async () => {
    for (const storagePath of [
      `attachments/8/pending/${UUID}-geotech.txt`, // another chat
      `attachments/compose/pending/${UUID}-geotech.txt`, // compose prefix for a real chat
      `documents/1/2/plan.pdf`, // project documents
      `attachments/7/12/0-photo.png`, // a saved message attachment
      `attachments/7/pending/../../../documents/1/2/plan.pdf`, // traversal
      `attachments/7/pending/${UUID}-a/b.txt`, // extra segment
      `attachments/7/pending/not-a-uuid-geotech.txt`,
    ]) {
      const { res } = await post({ chatId: 7, storagePath })
      expect(res.status, storagePath).toBe(400)
    }
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('400 for an unsupported type, without downloading it', async () => {
    const storagePath = `attachments/7/pending/${UUID}-tool.exe`
    const { res, data } = await post({ chatId: 7, storagePath, mediaType: 'application/octet-stream' })
    expect(res.status).toBe(400)
    expect(data.error).toContain('Unsupported file type')
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('503 when storage is not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const { res } = await post({ chatId: 7, storagePath: `attachments/7/pending/${UUID}-a.txt` })
    expect(res.status).toBe(503)
  })

  it('400 for a malformed JSON body', async () => {
    const { res } = await post({ storagePath: 42 })
    expect(res.status).toBe(400)
  })
})
