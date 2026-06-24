// tests/unit/lib/artifacts/toXlsx.test.ts
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { toXlsx } from '@/lib/artifacts/toXlsx'

describe('toXlsx', () => {
  it('styles the header row, freezes it, and sizes columns', async () => {
    const buf = await toXlsx([{ name: 'S', rows: [['Activity', 'Dur'], ['Mobilize topsoil area', 3]] }])
    expect(buf.length).toBeGreaterThan(0)
    const wb = new ExcelJS.Workbook()
    // Node 24 Buffer<ArrayBufferLike> vs legacy exceljs Buffer — both are Uint8Array at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any)
    const ws = wb.getWorksheet('S')!
    const header = ws.getRow(1)
    expect(header.font?.bold).toBe(true)
    expect((header.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F3447')
    expect(ws.views[0]?.state).toBe('frozen')
    expect(ws.getColumn(1).width!).toBeGreaterThan(10)
  })

  it('falls back to a single empty sheet', async () => {
    const buf = await toXlsx([])
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any)
    expect(wb.worksheets.length).toBe(1)
  })

  it('strips Markdown markup from string cells', async () => {
    const buf = await toXlsx([{ name: 'S', rows: [['Item', 'Note'], ['## Section', 'a **bold** value']] }])
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any)
    const ws = wb.getWorksheet('S')!
    expect(String(ws.getRow(2).getCell(1).value)).toBe('Section')
    expect(String(ws.getRow(2).getCell(2).value)).toBe('a bold value')
  })
})
