// src/lib/artifacts/toXlsx.ts
import type { SheetSpec } from './types'
import { BRAND, FONT, argb } from './style'
import { mdToPlainText } from './markdown'

// A signed or unsigned plain number ("-12.5", "+42", "1e3"): never a formula.
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

// Excel can't render Markdown — convert any Markdown markup in a string cell to plain
// text (so "## A", "**bold**" don't show their raw markers). A numeric string that
// round-trips exactly ("-12.5", "42") becomes a real number cell so SUM works; "00123",
// "1e3", "1.50" keep their spelling as text. Then the formula guard: it prefixes an
// apostrophe, which shows in the cell, so it only applies to text that could be read
// as a formula — a leading = + - @ TAB or CR that is not a plain number or a lone "-"
// (audit B18).
function cleanCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value
  const text = /[*_`#~]/.test(value) ? mdToPlainText(value) : value
  const num = Number(text)
  if (Number.isFinite(num) && String(num) === text) return num
  const formulaLike = /^[=+\-@\t\r]/.test(text) && text !== '-' && !PLAIN_NUMBER.test(text)
  return formulaLike ? `'${text}` : text
}

const SHEET_NAME_MAX = 31

// Excel sheet names: no [ ] : * ? / \, no leading/trailing apostrophe, not empty,
// at most 31 chars, unique ignoring case, and not the reserved "History". exceljs
// throws on any of these, which used to fail the whole artifact (audit B18).
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw, i) => {
    const cleaned = String(raw ?? '').replace(/[[\]:*?/\\]/g, '').trim().slice(0, SHEET_NAME_MAX)
    let base = cleaned.replace(/^'+|'+$/g, '').trim()
    if (!base) base = `Sheet${i + 1}`
    else if (base.toLowerCase() === 'history') base = `${base} 1`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`
      name = `${base.slice(0, SHEET_NAME_MAX - suffix.length).trimEnd()}${suffix}`
    }
    used.add(name.toLowerCase())
    return name
  })
}

const BORDER = { style: 'thin' as const, color: { argb: argb(BRAND.mutedLine) } }
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }

export async function toXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const specs = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]

  const names = sheetNames(specs.map(s => s.name))
  for (const [si, spec] of specs.entries()) {
    const ws = wb.addWorksheet(names[si])
    // Cleaned once, so column sizing and right-alignment see the real cell values.
    const rows = (spec.rows ?? []).map(row => row.map(cleanCell))

    rows.forEach((row, i) => {
      const added = ws.addRow(row)
      added.eachCell({ includeEmpty: true }, cell => {
        cell.border = ALL_BORDERS
        cell.alignment = { vertical: 'middle', wrapText: true }
      })
      if (i === 0) {
        added.font = { bold: true, color: { argb: argb(BRAND.white) }, name: FONT.office }
        added.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.clay) } }
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
