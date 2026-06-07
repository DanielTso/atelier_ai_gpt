import { describe, it, expect } from 'vitest'
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
    const text = await extractTextFromBuffer(await buildXlsx(), 'xlsx')
    expect(text).toContain('# Sheet: Budget')
    expect(text).toContain('Item\tCost\tDate')
    expect(text).toContain('# Sheet: Notes')
    expect(text).toContain('hello\tworld')
  })

  it('formats dates and resolves formulas to their cached result', async () => {
    const text = await extractTextFromBuffer(await buildXlsx(), 'xlsx')
    expect(text).toContain('2026-01-15') // Date → ISO date
    expect(text).toContain('Widget\t19.99\t2026-01-15')
    expect(text).toContain('Total\t19.99') // formula B2 → cached 19.99
  })

  it('treats .xlsx as a supported extension', () => {
    expect(getExtension('quarterly.xlsx')).toBe('xlsx')
    expect(isSupported('quarterly.xlsx', '')).toBe(true)
  })
})
