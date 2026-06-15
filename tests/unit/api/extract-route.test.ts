import { describe, it, expect, vi, beforeEach } from 'vitest'

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
