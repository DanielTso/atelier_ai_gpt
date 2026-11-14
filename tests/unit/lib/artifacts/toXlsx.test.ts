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
    // Warm palette (audit X13): deep warm clay header band, not the retired navy.
    expect((header.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF6B4A38')
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

  async function load(buf: Buffer) {
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any)
    return wb
  }

  it('sanitizes, truncates and de-duplicates sheet names instead of failing (audit B18)', async () => {
    const long = 'A'.repeat(40)
    const buf = await toXlsx([
      { name: 'Q1/Q2 Costs', rows: [['a']] },
      { name: 'Summary', rows: [['b']] },
      { name: 'summary', rows: [['c']] },
      { name: long, rows: [['d']] },
      { name: long + 'B', rows: [['e']] },
      { name: '[*?:]', rows: [['f']] },
    ])
    const names = (await load(buf)).worksheets.map(ws => ws.name)
    expect(names).toHaveLength(6)
    expect(names[0]).toBe('Q1Q2 Costs')
    expect(names[1]).toBe('Summary')
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31)
      expect(n).not.toMatch(/[[\]:*?/\\]/)
      expect(n.length).toBeGreaterThan(0)
    }
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(6)
  })

  it('guards formula-like text but leaves plain numbers and a lone dash alone (audit B18)', async () => {
    const buf = await toXlsx([{ name: 'S', rows: [['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'], ['-12.5', '=SUM(A1)', '-', '+1 555', '@cmd', '+42', '\t=1', '\r=1']] }])
    const row = (await load(buf)).getWorksheet('S')!.getRow(2)
    // "-12.5 is numeric": a plain number is never guarded (here it even becomes a number cell).
    expect(row.getCell(1).value).toBe(-12.5)
    expect(row.getCell(2).value).toBe(`'=SUM(A1)`)
    expect(row.getCell(3).value).toBe('-')
    expect(row.getCell(4).value).toBe(`'+1 555`)
    expect(row.getCell(5).value).toBe(`'@cmd`)
    expect(row.getCell(6).value).toBe('+42')
    expect(row.getCell(7).value).toBe(`'\t=1`)
    // The XML round-trip normalizes CR to LF; what matters is the guard apostrophe.
    expect(String(row.getCell(8).value)).toMatch(/^'\s=1$/)
  })

  it('stores a numeric string that round-trips exactly as a real number, and nothing else', async () => {
    const buf = await toXlsx([{ name: 'S', rows: [['a', 'b', 'c', 'd', 'e', 'f'], ['-12.5', '42', '00123', '1e3', '1.50', 'Infinity']] }])
    const row = (await load(buf)).getWorksheet('S')!.getRow(2)
    expect(row.getCell(1).value).toBe(-12.5)
    expect(row.getCell(2).value).toBe(42)
    expect(row.getCell(3).value).toBe('00123')
    expect(row.getCell(4).value).toBe('1e3')
    expect(row.getCell(5).value).toBe('1.50')
    expect(row.getCell(6).value).toBe('Infinity')
  })

  it('keeps header-row labels as text even when they look numeric', async () => {
    const buf = await toXlsx([{ name: 'S', rows: [['2025', '2026'], ['1', '2']] }])
    const ws = (await load(buf)).getWorksheet('S')!
    expect(ws.getRow(1).getCell(1).value).toBe('2025')
    expect(ws.getRow(1).getCell(2).value).toBe('2026')
    expect(ws.getRow(2).getCell(1).value).toBe(1)
  })

  it('keeps empty (null) cells and names a sheet that has no name', async () => {
    // @ts-expect-error null cells and a missing name arrive from parsed JSON (edit/regenerate)
    const buf = await toXlsx([{ rows: [['Item', 'Qty'], ['Rebar', null]] }])
    const ws = (await load(buf)).worksheets[0]!
    expect(ws.name).toBe('Sheet1')
    expect(ws.getRow(2).getCell(1).value).toBe('Rebar')
    expect(ws.getRow(2).getCell(2).value).toBeNull()
  })
})
