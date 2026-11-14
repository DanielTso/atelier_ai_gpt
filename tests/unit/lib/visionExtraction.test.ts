import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockSplit = vi.fn()
const mockSplitRuns = vi.fn()
const mockRecordUsage = vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined)

const seg = (firstPage: number, lastPage: number) => ({ bytes: new Uint8Array([1]), firstPage, lastPage })

function setup(key: string | null = 'k') {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
  vi.doMock('@/lib/usage', () => ({ recordUsage: mockRecordUsage }))
  vi.doMock('@/lib/pdfSegments', () => ({
    splitPdfIntoSegments: (...a: unknown[]) => mockSplit(...a),
    splitPdfPageRuns: (...a: unknown[]) => mockSplitRuns(...a),
  }))
}

describe('extractViaVision (segmented)', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
    mockSplit.mockReset()
    process.env.EXTRACTION_SEGMENT_RETRIES = '0' // keep failure tests fast
  })

  it('sends one call per segment with the pdf inline and joins in page order', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2), seg(3, 4)], pageCount: 4, skippedPages: [], cappedPages: [] })
    mockGenerateText
      .mockResolvedValueOnce({ text: 'SEG ONE', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'SEG TWO', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text.indexOf('SEG ONE')).toBeLessThan(out.text.indexOf('SEG TWO'))
    expect(out).toMatchObject({ pageCount: 4, pagesExtracted: 4, partial: false })
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
    const content = mockGenerateText.mock.calls[0][0].messages[0].content
    expect(content[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' })
    // prompt carries the absolute page range so headings use real page numbers
    expect(content[0].text).toContain('pages 1-2')
  })

  // Audit C5: every vision call writes one usage_events row.
  it('records one vision-extract usage row per successful segment call', async () => {
    mockRecordUsage.mockClear()
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2), seg(3, 4)], pageCount: 4, skippedPages: [], cappedPages: [] })
    const usage = { inputTokens: 120, inputTokenDetails: { noCacheTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokens: 30, outputTokenDetails: { textTokens: 30, reasoningTokens: 0 }, totalTokens: 150 }
    mockGenerateText
      .mockResolvedValueOnce({ text: 'SEG ONE', finishReason: 'stop', totalUsage: usage })
      .mockRejectedValueOnce(new Error('boom'))
    const { extractViaVision } = await import('@/lib/visionExtraction')
    await extractViaVision(Buffer.from('pdf'))
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: null, projectId: null, purpose: 'vision-extract', model: 'gemini-3.5-flash', usage,
    })
  })

  it('records a vision-extract usage row for the single-image path and the hybrid page-run path', async () => {
    mockRecordUsage.mockClear()
    setup()
    mockGenerateText.mockResolvedValue({ text: 'IMG', finishReason: 'stop' })
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 2)], skippedPages: [] })
    const { extractViaVisionImage, extractPagesViaVision } = await import('@/lib/visionExtraction')
    await extractViaVisionImage(Buffer.from('img'), 'image/png')
    await extractPagesViaVision(Buffer.from('pdf'), [2])
    expect(mockRecordUsage).toHaveBeenCalledTimes(2)
    for (const [args] of mockRecordUsage.mock.calls as unknown as [{ purpose: string }][]) expect(args.purpose).toBe('vision-extract')
  })

  it('transcribes at temperature 0 — re-processing the same sheet must not produce different text', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 2, skippedPages: [], cappedPages: [] })
    mockGenerateText.mockResolvedValue({ text: 'OK', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    await extractViaVision(Buffer.from('pdf'))
    expect(mockGenerateText.mock.calls[0][0].temperature).toBe(0)
  })

  it('returns empty result without touching the pdf when no API key', async () => {
    setup(null)
    const { extractViaVision } = await import('@/lib/visionExtraction')
    expect((await extractViaVision(Buffer.from('pdf'))).text).toBe('')
    expect(mockSplit).not.toHaveBeenCalled()
  })

  it('a segment that fails after retries drops its pages and flags partial', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2), seg(3, 4)], pageCount: 4, skippedPages: [], cappedPages: [] })
    mockGenerateText
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ text: 'SEG TWO', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text).toBe('# Page 3\n[pages 3–4 · vision]\nSEG TWO')
    expect(out).toMatchObject({ pagesExtracted: 2, partial: true })
  })

  it('retries a failed segment before giving up', async () => {
    process.env.EXTRACTION_SEGMENT_RETRIES = '1'
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 2, skippedPages: [], cappedPages: [] })
    mockGenerateText
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ text: 'RECOVERED', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text).toBe('# Page 1\n[pages 1–2 · vision]\nRECOVERED')
    expect(out.partial).toBe(false)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  it('output truncation (finishReason length) keeps text but flags partial', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 2, skippedPages: [], cappedPages: [] })
    mockGenerateText.mockResolvedValue({ text: 'TRUNCATED TEXT', finishReason: 'length' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text).toBe('# Page 1\n[pages 1–2 · vision]\nTRUNCATED TEXT')
    expect(out.partial).toBe(true)
  })

  it('skipped pages from the splitter flag partial', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 3, skippedPages: [3], cappedPages: [] })
    mockGenerateText.mockResolvedValue({ text: 'OK', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out).toMatchObject({ pageCount: 3, pagesExtracted: 2, partial: true, failedPages: [3] })
  })

  it('records skipped, capped and failed-segment pages in failedPages, sorted (audit X9)', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2), seg(3, 4)], pageCount: 7, skippedPages: [5], cappedPages: [6, 7] })
    mockGenerateText
      .mockResolvedValueOnce({ text: 'SEG ONE', finishReason: 'stop' })
      .mockRejectedValueOnce(new Error('boom'))
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.failedPages).toEqual([3, 4, 5, 6, 7])
    expect(out.partial).toBe(true)
  })
})

describe('extractPagesViaVision', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockSplitRuns.mockReset(); process.env.EXTRACTION_SEGMENT_RETRIES = '0' })

  it('extracts each run segment and returns per-segment text', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 3), seg(7, 9)], skippedPages: [] })
    mockGenerateText
      .mockResolvedValueOnce({ text: 'NOTES A', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'NOTES B', finishReason: 'stop' })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    const out = await extractPagesViaVision(Buffer.from('pdf'), [2, 3, 7, 8, 9])
    expect(out.segments).toEqual([
      { firstPage: 2, lastPage: 3, text: 'NOTES A' },
      { firstPage: 7, lastPage: 9, text: 'NOTES B' },
    ])
    expect(out.failed).toBe(0)
  })

  it('counts a failed run and omits it', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 3), seg(7, 9)], skippedPages: [] })
    mockGenerateText
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ text: 'NOTES B', finishReason: 'stop' })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    const out = await extractPagesViaVision(Buffer.from('pdf'), [2, 3, 7, 8, 9])
    expect(out.segments).toEqual([{ firstPage: 7, lastPage: 9, text: 'NOTES B' }])
    expect(out.failed).toBe(1)
    expect(out.failedPages).toEqual([2, 3])
  })

  it('flags truncation', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 3)], skippedPages: [] })
    mockGenerateText.mockResolvedValue({ text: 'PARTIAL NOTES', finishReason: 'length' })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    expect((await extractPagesViaVision(Buffer.from('pdf'), [2, 3])).truncated).toBe(true)
  })

  it('surfaces oversize pages the splitter skipped', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [], skippedPages: [2, 3] })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    const out = await extractPagesViaVision(Buffer.from('pdf'), [2, 3])
    expect(out).toEqual({ segments: [], failed: 0, failedPages: [2, 3], truncated: false, skippedPages: [2, 3] })
  })

  it('returns empty without a key', async () => {
    setup(null)
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    expect(await extractPagesViaVision(Buffer.from('pdf'), [2])).toEqual({ segments: [], failed: 0, failedPages: [], truncated: false, skippedPages: [] })
    expect(mockSplitRuns).not.toHaveBeenCalled()
  })
})

describe('extractViaVisionImage', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockSplit.mockReset() })

  it('sends a single image directly', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: 'IMAGE TEXT' })
    const { extractViaVisionImage } = await import('@/lib/visionExtraction')
    const out = await extractViaVisionImage(Buffer.from('img'), 'image/png')
    expect(out.text).toBe('IMAGE TEXT')
    expect(out.pageCount).toBe(1)
    expect(mockSplit).not.toHaveBeenCalled()
    expect(mockGenerateText.mock.calls[0][0].temperature).toBe(0)
  })
})
