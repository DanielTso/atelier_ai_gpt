import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockRender = vi.fn()

function setup(key: string | null = 'k', numPages = 2) {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
  vi.doMock('unpdf', () => ({
    definePDFJSModule: () => Promise.resolve(),
    getDocumentProxy: () => Promise.resolve({ numPages }),
    renderPageAsImage: (...a: unknown[]) => mockRender(...a),
  }))
}

describe('extractViaVision', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockRender.mockReset() })

  it('renders each page and concatenates per-page extractions', async () => {
    setup('k', 2)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText
      .mockResolvedValueOnce({ text: 'PAGE ONE TEXT' })
      .mockResolvedValueOnce({ text: 'PAGE TWO TEXT' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out).toContain('PAGE ONE TEXT')
    expect(out).toContain('PAGE TWO TEXT')
    expect(mockRender).toHaveBeenCalledTimes(2)
    // Each render must get its OWN buffer copy — pdfjs detaches the array it parses,
    // so reusing one instance breaks page 2+ with a DataCloneError.
    expect(mockRender.mock.calls[0][0]).not.toBe(mockRender.mock.calls[1][0])
  })

  it('returns empty string when no API key', async () => {
    setup(null, 2)
    const { extractViaVision } = await import('@/lib/visionExtraction')
    expect(await extractViaVision(Buffer.from('pdf'))).toBe('')
    expect(mockRender).not.toHaveBeenCalled()
  })

  it('caps pages at EXTRACTION_MAX_PAGES', async () => {
    process.env.EXTRACTION_MAX_PAGES = '1'
    setup('k', 5)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText.mockResolvedValue({ text: 'X' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    await extractViaVision(Buffer.from('pdf'))
    expect(mockRender).toHaveBeenCalledTimes(1)
    delete process.env.EXTRACTION_MAX_PAGES
  })

  it('tolerates a per-page failure and keeps going', async () => {
    setup('k', 2)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText
      .mockRejectedValueOnce(new Error('page 1 boom'))
      .mockResolvedValueOnce({ text: 'PAGE TWO OK' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out).toContain('PAGE TWO OK')
  })

  it('extractViaVisionImage sends a single image directly', async () => {
    setup('k')
    mockGenerateText.mockResolvedValue({ text: 'IMAGE TEXT' })
    const { extractViaVisionImage } = await import('@/lib/visionExtraction')
    const out = await extractViaVisionImage(Buffer.from('img'), 'image/png')
    expect(out).toBe('IMAGE TEXT')
    expect(mockRender).not.toHaveBeenCalled()
  })
})
