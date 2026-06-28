import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetGeminiApiKey, mockGenerateText, mockCreateGoogleGenerativeAI } = vi.hoisted(() => {
  const mockGoogleFn = vi.fn(() => 'google-model-stub')
  return {
    mockGetGeminiApiKey: vi.fn(),
    mockGenerateText: vi.fn(),
    mockCreateGoogleGenerativeAI: vi.fn(() => mockGoogleFn),
  }
})

vi.mock('@/lib/settings', () => ({ getGeminiApiKey: mockGetGeminiApiKey }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: mockCreateGoogleGenerativeAI }))
vi.mock('ai', () => ({ generateText: mockGenerateText }))

import { generateImageBytes } from '@/lib/image/generate'

function makeImageFile(mediaType: string, content = 'fake-image-bytes') {
  const uint8Array = new TextEncoder().encode(content)
  return { mediaType, uint8Array }
}

describe('generateImageBytes', () => {
  beforeEach(() => {
    mockGetGeminiApiKey.mockReset()
    mockGenerateText.mockReset()
    mockCreateGoogleGenerativeAI.mockClear()
  })

  it('throws when no Gemini API key is configured', async () => {
    mockGetGeminiApiKey.mockResolvedValue(null)
    await expect(generateImageBytes('a sunset')).rejects.toThrow(/no Gemini API key/)
  })

  it('throws when the model returns no image part', async () => {
    mockGetGeminiApiKey.mockResolvedValue('test-key')
    mockGenerateText.mockResolvedValue({ files: [] })
    await expect(generateImageBytes('a sunset')).rejects.toThrow(/No image was returned/)
  })

  it('returns bytes, mediaType, and ext for a PNG image part', async () => {
    mockGetGeminiApiKey.mockResolvedValue('test-key')
    const fakeFile = makeImageFile('image/png')
    mockGenerateText.mockResolvedValue({ files: [fakeFile] })

    const result = await generateImageBytes('a sunset')

    expect(result.mediaType).toBe('image/png')
    expect(result.ext).toBe('png')
    expect(Buffer.isBuffer(result.bytes)).toBe(true)
    expect(result.bytes.length).toBeGreaterThan(0)
  })

  it('derives ext correctly for jpeg and webp', async () => {
    mockGetGeminiApiKey.mockResolvedValue('key')

    for (const [mt, expectedExt] of [
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/png', 'png'],
    ] as const) {
      mockGenerateText.mockResolvedValue({ files: [makeImageFile(mt)] })
      const { ext } = await generateImageBytes('test')
      expect(ext).toBe(expectedExt)
    }
  })

  it('appends aspect-ratio hint to the prompt', async () => {
    mockGetGeminiApiKey.mockResolvedValue('key')
    mockGenerateText.mockResolvedValue({ files: [makeImageFile('image/png')] })

    await generateImageBytes('a sunset', '16:9')

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as { prompt?: string } | undefined
    expect(callArgs?.prompt).toContain('Aspect ratio: 16:9')
  })

  it('does not append aspect-ratio hint when aspectRatio is omitted', async () => {
    mockGetGeminiApiKey.mockResolvedValue('key')
    mockGenerateText.mockResolvedValue({ files: [makeImageFile('image/png')] })

    await generateImageBytes('a sunset')

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as { prompt?: string } | undefined
    expect(callArgs?.prompt).not.toContain('Aspect ratio')
  })
})
