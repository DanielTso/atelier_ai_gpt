import type { SheetSpec } from './types'

export async function toXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const specs = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]
  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name || 'Sheet1')
    spec.rows.forEach((row, i) => {
      const added = ws.addRow(row)
      if (i === 0) added.font = { bold: true }
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
