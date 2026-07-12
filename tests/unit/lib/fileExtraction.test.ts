import { describe, it, expect, vi, afterEach } from 'vitest'
import ExcelJS from 'exceljs'
import { extractTextFromBuffer, isSupported, getExtension } from '@/lib/fileExtraction'

async function buildXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Budget')
  sheet.addRow(['Item', 'Cost', 'Date'])
  sheet.addRow(['Widget', 19.99, new Date('2026-01-15')])
  sheet.addRow(['Total', { formula: 'B2', result: 19.99 }, null])
  const notes = wb.addWorksheet('Notes')
  notes.addRow(['hello', 'world'])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('fileExtraction — xlsx', () => {
  it('extracts each sheet as tab-separated rows with a sheet header', async () => {
    const { text } = await extractTextFromBuffer(await buildXlsx(), 'xlsx')
    expect(text).toContain('# Sheet: Budget')
    expect(text).toContain('Item\tCost\tDate')
    expect(text).toContain('# Sheet: Notes')
    expect(text).toContain('hello\tworld')
  })

  it('formats dates and resolves formulas to their cached result', async () => {
    const { text } = await extractTextFromBuffer(await buildXlsx(), 'xlsx')
    expect(text).toContain('2026-01-15') // Date → ISO date
    expect(text).toContain('Widget\t19.99\t2026-01-15')
    expect(text).toContain('Total\t19.99') // formula B2 → cached 19.99
  })

  it('treats .xlsx as a supported extension', () => {
    expect(getExtension('quarterly.xlsx')).toBe('xlsx')
    expect(isSupported('quarterly.xlsx', '')).toBe(true)
  })
})

// The PDF text path is bounded so a very large document can't build an unbounded
// joined string on top of the buffer already in memory. We mock unpdf to control
// the page array and re-import the real module so its dynamic import resolves the mock.
describe('fileExtraction — pdf text bounding + partial', () => {
  async function loadWithPdfPages(pages: string[], maxChars = 1000) {
    process.env.DOCUMENT_MAX_CHARS = String(maxChars)
    vi.resetModules()
    vi.doMock('unpdf', () => ({ extractText: async () => ({ totalPages: pages.length, text: pages }) }))
    const mod = await import('@/lib/fileExtraction')
    return mod
  }
  afterEach(() => { delete process.env.DOCUMENT_MAX_CHARS })

  it('caps at DOCUMENT_MAX_CHARS and flags partial for an over-ceiling PDF', async () => {
    const { extractTextFromBuffer, DOCUMENT_MAX_CHARS } = await loadWithPdfPages(['A'.repeat(800), 'B'.repeat(800), 'C'.repeat(800)], 1000)
    const out = await extractTextFromBuffer(Buffer.from('x'), 'pdf')
    expect(out.text.length).toBe(DOCUMENT_MAX_CHARS)
    expect(out.partial).toBe(true)
    expect(out.pageCount).toBe(3)
  })

  it('returns full text with partial false when under the ceiling', async () => {
    const { extractTextFromBuffer } = await loadWithPdfPages(['hello', 'world'], 1000)
    const out = await extractTextFromBuffer(Buffer.from('x'), 'pdf')
    expect(out.text).toBe('hello\nworld')
    expect(out.partial).toBe(false)
    expect(out.pageCount).toBe(2)
  })
})

describe('extractTextFromBuffer pageTexts', () => {
  it('attaches raw per-page text for PDFs', async () => {
    vi.resetModules()
    vi.doMock('unpdf', () => ({
      extractText: () => Promise.resolve({ totalPages: 3, text: ['page one text', 'p2', 'page three text'] }),
    }))
    const { extractTextFromBuffer } = await import('@/lib/fileExtraction')
    const out = await extractTextFromBuffer(Buffer.from('pdf'), 'pdf')
    expect(out.pageTexts).toEqual(['page one text', 'p2', 'page three text'])
    expect(out.text).toContain('page one text')
    expect(out.pageCount).toBe(3)
  })

  it('leaves pageTexts undefined for non-PDF', async () => {
    vi.resetModules()
    const { extractTextFromBuffer } = await import('@/lib/fileExtraction')
    const out = await extractTextFromBuffer(Buffer.from('plain text'), 'txt')
    expect(out.pageTexts).toBeUndefined()
  })
})

describe('isImageUpload — raster allow-list', () => {
  it('accepts the four raster formats by extension or MIME', async () => {
    const { isImageUpload } = await import('@/lib/fileExtraction')
    expect(isImageUpload('png', 'application/octet-stream')).toBe(true)
    expect(isImageUpload('bin', 'image/jpeg')).toBe(true)
    expect(isImageUpload('webp', 'image/webp')).toBe(true)
  })
  it('rejects svg and other image/* MIMEs the pipeline cannot process', async () => {
    const { isImageUpload } = await import('@/lib/fileExtraction')
    expect(isImageUpload('svg', 'image/svg+xml')).toBe(false)
    expect(isImageUpload('gif', 'image/gif')).toBe(false)
    expect(isImageUpload('tiff', 'image/tiff')).toBe(false)
  })
})
