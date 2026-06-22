// src/lib/artifacts/toXlsx.ts
import type { SheetSpec } from './types'
import { BRAND, FONT, argb } from './style'

function neutralizeCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const BORDER = { style: 'thin' as const, color: { argb: argb(BRAND.mutedLine) } }
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }

export async function toXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const specs = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]

  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name || 'Sheet1')
    const rows = spec.rows ?? []

    rows.forEach((row, i) => {
      const added = ws.addRow(row.map(neutralizeCell))
      added.eachCell({ includeEmpty: true }, cell => {
        cell.border = ALL_BORDERS
        cell.alignment = { vertical: 'middle', wrapText: true }
      })
      if (i === 0) {
        added.font = { bold: true, color: { argb: argb(BRAND.white) }, name: FONT.office }
        added.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.navy) } }
        })
      } else if (i % 2 === 0) {
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.softMist) } }
        })
      }
    })

    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)
    for (let c = 1; c <= colCount; c++) {
      let max = 10
      let allNumeric = rows.length > 1
      rows.forEach((r, ri) => {
        const v = r[c - 1]
        if (v != null) max = Math.max(max, String(v).length + 2)
        if (ri > 0 && typeof v !== 'number') allNumeric = false
      })
      ws.getColumn(c).width = Math.min(60, max)
      if (allNumeric) {
        ws.getColumn(c).eachCell((cell, rn) => { if (rn > 1) cell.alignment = { vertical: 'middle', horizontal: 'right' } })
      }
    }

    if (rows.length) ws.views = [{ state: 'frozen', ySplit: 1 }]
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
