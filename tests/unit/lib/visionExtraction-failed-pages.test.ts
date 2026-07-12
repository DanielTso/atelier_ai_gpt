import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateTextMock = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => () => 'model' }))
vi.mock('@/lib/settings', () => ({ getGeminiApiKey: async () => 'key' }))
vi.mock('@/lib/pdfSegments', () => ({
  splitPdfIntoSegments: async () => ({
    segments: [
      { bytes: new Uint8Array(), firstPage: 1, lastPage: 2 },
      { bytes: new Uint8Array(), firstPage: 3, lastPage: 4 },
    ],
    pageCount: 4, skippedPages: 0,
  }),
  splitPdfPageRuns: async () => ({ segments: [], skippedPages: 0 }),
}))

describe('extractViaVision failed pages', () => {
  beforeEach(() => {
    vi.stubEnv('EXTRACTION_SEGMENT_RETRIES', '0')
    generateTextMock.mockReset()
  })
  it('records the page range of a segment that fails after retries', async () => {
    generateTextMock
      .mockResolvedValueOnce({ text: '# Page 1\nok', finishReason: 'stop' })
      .mockRejectedValueOnce(new Error('boom'))
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const r = await extractViaVision(Buffer.from(''))
    expect(r.failedPages).toEqual([3, 4])
    expect(r.partial).toBe(true)
  })
})
