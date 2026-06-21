import type { SheetSpec } from './types'

// Neutralize spreadsheet/CSV formula injection: a cell whose text begins with
// = + - @ (or a leading tab/CR that Excel trims) is treated as a formula by
// Excel/Sheets. Model-authored content is untrusted, so prefix such strings with
// an apostrophe to force them to render as literal text.
function neutralizeCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export async function toXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const specs = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]
  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name || 'Sheet1')
    spec.rows.forEach((row, i) => {
      const added = ws.addRow(row.map(neutralizeCell))
      if (i === 0) added.font = { bold: true }
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
