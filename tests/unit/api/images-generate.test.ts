import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks declared before importRoute so vi.doMock captures them
const m = {
  getGeminiApiKey: vi.fn(),
  isStorageConfigured: vi.fn(),
  uploadBuffer: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  generateImageBytes: vi.fn(),
  createGeneratedImage: vi.fn(),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: m.getGeminiApiKey }))
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: m.isStorageConfigured,
    uploadBuffer: m.uploadBuffer,
    createSignedDownloadUrl: m.createSignedDownloadUrl,
  }))
  vi.doMock('@/lib/image/generate', () => ({ generateImageBytes: m.generateImageBytes }))
  vi.doMock('@/app/actions', () => ({ createGeneratedImage: m.createGeneratedImage }))
  const { POST } = await import('@/app/api/images/generate/route')
  return POST
}

function req(body: object) {
  return new Request('http://localhost/api/images/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/images/generate', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    // Default: storage configured, key set, happy generation
    m.isStorageConfigured.mockReturnValue(true)
    m.getGeminiApiKey.mockResolvedValue('gemini-key')
    m.generateImageBytes.mockResolvedValue({
      bytes: Buffer.from('fake-image'),
      mediaType: 'image/png',
      ext: 'png',
    })
    m.uploadBuffer.mockResolvedValue(undefined)
    m.createSignedDownloadUrl.mockResolvedValue('https://storage.example.com/signed-url')
    m.createGeneratedImage.mockResolvedValue({
      id: 42,
      projectId: null,
      prompt: 'a sunset',
      aspectRatio: null,
      mediaType: 'image/png',
      storagePath: 'images/standalone/uuid.png',
      fileSize: 10,
      createdAt: new Date('2026-06-28T00:00:00Z'),
    })
  })

  it('returns 503 when no Gemini API key is configured', async () => {
    m.getGeminiApiKey.mockResolvedValue(null)
    const POST = await importRoute()
    const res = await POST(req({ prompt: 'a sunset' }))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Gemini API key/i)
  })

  it('returns 503 when storage is not configured', async () => {
    m.isStorageConfigured.mockReturnValue(false)
    const POST = await importRoute()
    const res = await POST(req({ prompt: 'a sunset' }))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/storage/i)
  })

  it('returns 400 for invalid request body (empty prompt)', async () => {
    const POST = await importRoute()
    const res = await POST(req({ prompt: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid request body (missing prompt)', async () => {
    const POST = await importRoute()
    const res = await POST(req({ aspectRatio: '16:9' }))
    expect(res.status).toBe(400)
  })

  it('returns 502 when generateImageBytes throws', async () => {
    m.generateImageBytes.mockRejectedValue(new Error('Model refused'))
    const POST = await importRoute()
    const res = await POST(req({ prompt: 'a sunset' }))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Image generation failed/)
  })

  it('happy path: returns 200 with image.url and calls uploadBuffer + createGeneratedImage', async () => {
    const POST = await importRoute()
    const res = await POST(req({ prompt: 'a sunset', aspectRatio: '16:9' }))
    expect(res.status).toBe(200)

    const body = await res.json() as { image: { id: number; url: string } }
    expect(body.image.id).toBe(42)
    expect(body.image.url).toBe('https://storage.example.com/signed-url')

    // uploadBuffer called with a path under images/
    expect(m.uploadBuffer).toHaveBeenCalledOnce()
    const [uploadPath] = m.uploadBuffer.mock.calls[0] as [string, ...unknown[]]
    expect(uploadPath).toMatch(/^images\/standalone\//)

    // createGeneratedImage called with correct data
    expect(m.createGeneratedImage).toHaveBeenCalledOnce()
    const [imgData] = m.createGeneratedImage.mock.calls[0] as [{ prompt: string; aspectRatio: string | null }]
    expect(imgData.prompt).toBe('a sunset')
    expect(imgData.aspectRatio).toBe('16:9')
  })

  it('happy path: scopes storage path to projectId when provided', async () => {
    m.createGeneratedImage.mockResolvedValue({
      id: 7, projectId: 3, prompt: 'test', aspectRatio: null,
      mediaType: 'image/png', storagePath: 'images/3/uuid.png',
      fileSize: 10, createdAt: new Date(),
    })
    const POST = await importRoute()
    await POST(req({ prompt: 'test', projectId: 3 }))

    const [uploadPath] = m.uploadBuffer.mock.calls[0] as [string, ...unknown[]]
    expect(uploadPath).toMatch(/^images\/3\//)
  })
})
