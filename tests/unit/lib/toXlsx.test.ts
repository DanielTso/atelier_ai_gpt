import { describe, it, expect } from 'vitest'
import { toXlsx } from '@/lib/artifacts/toXlsx'
import type { SheetSpec } from '@/lib/artifacts/types'

// Verifies the xlsx edit round-trip is lossless: a SheetSpec[] rendered by
// toXlsx and read back with exceljs returns the same cell values. The artifact
// edit route's source of truth is the stored SheetSpec[] JSON (re-rendered each
// edit), so this guards against silent data loss in the render step itself.
async function readBack(buffer: Buffer) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  return wb
}

describe('toXlsx round-trip', () => {
  it('preserves sheet name, headers, and data cells (numbers stay numbers)', async () => {
    const sheets: SheetSpec[] = [
      { name: 'Data', rows: [['Name', 'Qty'], ['Widget', 5], ['Gadget', 12]] },
    ]
    const wb = await readBack(await toXlsx(sheets))
    const ws = wb.getWorksheet('Data')
    expect(ws).toBeTruthy()
    expect(ws!.getCell('A1').value).toBe('Name')
    expect(ws!.getCell('B1').value).toBe('Qty')
    expect(ws!.getCell('A2').value).toBe('Widget')
    expect(ws!.getCell('B2').value).toBe(5) // number preserved, not stringified
    expect(ws!.getCell('A3').value).toBe('Gadget')
    expect(ws!.getCell('B3').value).toBe(12)
  })

  it('preserves multiple sheets independently', async () => {
    const wb = await readBack(await toXlsx([
      { name: 'First', rows: [['a'], ['b']] },
      { name: 'Second', rows: [['x'], ['y']] },
    ]))
    expect(wb.getWorksheet('First')!.getCell('A2').value).toBe('b')
    expect(wb.getWorksheet('Second')!.getCell('A2').value).toBe('y')
  })

  it('renders markdown cell markup as plain text (intended, not loss)', async () => {
    const ws = (await readBack(await toXlsx([{ name: 'S', rows: [['**bold**']] }]))).getWorksheet('S')!
    const a1 = ws.getCell('A1').value
    expect(a1).toContain('bold')
    expect(a1).not.toContain('*')
  })

  it('neutralizes a formula-injection cell as text, not a live formula', async () => {
    const ws = (await readBack(await toXlsx([{ name: 'S', rows: [['=SUM(A1:A9)']] }]))).getWorksheet('S')!
    const a1 = ws.getCell('A1').value
    expect(typeof a1).toBe('string') // not a { formula, result } object
    expect(String(a1)).toContain('SUM')
  })

  it('handles an empty sheet list without throwing', async () => {
    const wb = await readBack(await toXlsx([]))
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1)
  })
})
