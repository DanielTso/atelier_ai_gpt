import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockUpload = vi.fn()
const mockSigned = vi.fn()
const mockGetKey = vi.fn()
const mockIsConfigured = vi.fn(() => true)
const mockGoogle = vi.fn((m: string) => ({ modelId: m }))

async function load() {
  vi.resetModules()
  // Provide a pass-through `tool` so the real definition (with .execute) comes back.
  vi.doMock('ai', () => ({ tool: (def: unknown) => def, generateText: mockGenerateText }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => mockGoogle }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: mockGetKey }))
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: mockIsConfigured,
    uploadBuffer: mockUpload,
    createSignedDownloadUrl: mockSigned,
    ARTIFACT_URL_TTL_SECONDS: 86400,
  }))
  return (await import('@/lib/image/tool')).createGenerateImageTool
}

describe('generate_image tool', () => {
  beforeEach(() => {
    [mockGenerateText, mockUpload, mockSigned, mockGetKey].forEach(f => f.mockReset())
    mockIsConfigured.mockReturnValue(true)
    mockGetKey.mockResolvedValue('gkey')
    mockUpload.mockResolvedValue(undefined)
    mockSigned.mockResolvedValue('signed:url')
    mockGenerateText.mockResolvedValue({ files: [{ mediaType: 'image/png', uint8Array: new Uint8Array([1, 2, 3]) }], text: '' })
  })

  it('generates, uploads, and returns a small descriptor (no base64)', async () => {
    const make = await load()
    const out = await make({ chatId: 7, projectId: null }).execute!({ prompt: 'a red barn at dusk' }, {} as never)
    expect(mockGenerateText).toHaveBeenCalled()
    expect(mockUpload).toHaveBeenCalled()
    expect(out).toEqual({
      storagePath: expect.stringMatching(/^attachments\/7\/generated\/.+\.png$/),
      url: 'signed:url',
      // Stable same-origin proxy form for embedding in HTML artifacts (signed url expires).
      embedUrl: expect.stringMatching(/^\/api\/files\/raw\?path=attachments%2F7%2Fgenerated%2F.+\.png$/),
      mediaType: 'image/png',
      filename: 'generated-image.png',
      fileSize: 3, // byteLength of the mocked image (Uint8Array([1,2,3]))
    })
    // tiny result — no base64 image bytes leak into the conversation
    expect(JSON.stringify(out).length).toBeLessThan(400)
  })

  it('returns an error and skips upload when no Gemini key', async () => {
    mockGetKey.mockResolvedValue(null)
    const make = await load()
    const out = await make({ chatId: 7, projectId: null }).execute!({ prompt: 'x' }, {} as never)
    expect(out).toEqual({ error: expect.stringContaining('unavailable') })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('returns an error when the model produced no image', async () => {
    mockGenerateText.mockResolvedValue({ files: [], text: 'sorry' })
    const make = await load()
    const out = await make({ chatId: 7, projectId: null }).execute!({ prompt: 'x' }, {} as never)
    expect(out).toEqual({ error: expect.stringContaining('No image') })
    expect(mockUpload).not.toHaveBeenCalled()
  })
})
