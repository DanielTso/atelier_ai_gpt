// src/lib/artifacts/toPdf.ts
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { parseMarkdown, type Inline } from './markdown'
import { BRAND, SIZE, pdfRgb } from './style'

const PAGE = { w: 612, h: 792 } // US Letter (points)
const MARGIN = 54
const MAX_W = PAGE.w - MARGIN * 2

// pdf-lib StandardFonts are WinAnsi-encoded and throw on non-Latin-1 input.
// Map common smart punctuation to ASCII, then replace any remaining
// character above the Latin-1 range so drawText never throws.
function winAnsi(s: string): string {
  return s
    .replace(/[''‚′]/g, "'")
    .replace(/[""„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•‣◦]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^ -ÿ]/g, '?')
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = winAnsi(text).split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(trial, size) > maxW && line) { lines.push(line); line = w }
    else line = trial
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export async function toPdf(markdown: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const blocks = parseMarkdown(markdown)

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h])
  let y = PAGE.h - MARGIN

  const ensure = (need: number) => {
    if (y - need < MARGIN) { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - MARGIN }
  }
  const text = (s: string, x: number, size: number, f: PDFFont, color: [number, number, number]) => {
    page.drawText(winAnsi(s), { x, y, size, font: f, color: rgb(color[0], color[1], color[2]) })
  }
  const plain = (inlines: Inline[]) => inlines.map(i => i.text).join('')

  for (const b of blocks) {
    if (b.type === 'heading') {
      const size = b.level === 1 ? SIZE.h1 : b.level === 2 ? SIZE.h2 : SIZE.h3
      const color = b.level === 1 ? pdfRgb(BRAND.navy) : b.level === 2 ? pdfRgb(BRAND.steelBlue) : pdfRgb(BRAND.ink)
      for (const line of wrap(plain(b.inlines), bold, size, MAX_W)) {
        ensure(size + 8); y -= size + 6; text(line, MARGIN, size, bold, color)
      }
      y -= 4
    } else if (b.type === 'list') {
      b.items.forEach((item, idx) => {
        const marker = b.ordered ? `${idx + 1}.` : '-'
        const wrapped = wrap(plain(item), font, SIZE.body, MAX_W - 16)
        wrapped.forEach((line, li) => {
          ensure(SIZE.body + 4); y -= SIZE.body + 4
          text(li === 0 ? marker : ' ', MARGIN, SIZE.body, font, pdfRgb(BRAND.slateText))
          text(line, MARGIN + 16, SIZE.body, font, pdfRgb(BRAND.ink))
        })
      })
      y -= 4
    } else if (b.type === 'table') {
      const colCount = b.header.length || 1
      // Column widths proportional to the longest content per column, normalized to MAX_W.
      const charW = new Array<number>(colCount).fill(1)
      for (const r of [b.header, ...b.rows]) {
        r.forEach((cell, ci) => { charW[ci] = Math.max(charW[ci] ?? 1, plain(cell).length) })
      }
      const totalChars = charW.reduce((a, c) => a + c, 0) || 1
      const colW = charW.map(w => (w / totalChars) * MAX_W)
      const PAD = 4
      const lineH = SIZE.body + 2

      const drawRow = (cells: Inline[][], isHeader: boolean, band: boolean) => {
        const f = isHeader ? bold : font
        const cellLines = cells.map((cell, ci) => wrap(plain(cell), f, SIZE.body, (colW[ci] ?? MAX_W) - 2 * PAD))
        const maxLines = Math.max(1, ...cellLines.map(l => l.length))
        const rowH = maxLines * lineH + PAD
        // Page break: start a fresh page and repeat the header band before a body row.
        if (y - rowH < MARGIN) {
          page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - MARGIN
          if (!isHeader) drawRow(b.header, true, false)
        }
        const rowTop = y
        const rowBottom = y - rowH
        const navyColor = pdfRgb(BRAND.navy)
        const softMistColor = pdfRgb(BRAND.softMist)
        if (isHeader) page.drawRectangle({ x: MARGIN, y: rowBottom, width: MAX_W, height: rowH, color: rgb(navyColor[0], navyColor[1], navyColor[2]) })
        else if (band) page.drawRectangle({ x: MARGIN, y: rowBottom, width: MAX_W, height: rowH, color: rgb(softMistColor[0], softMistColor[1], softMistColor[2]) })
        const color = isHeader ? pdfRgb(BRAND.white) : pdfRgb(BRAND.ink)
        let x = MARGIN
        cellLines.forEach((lines, ci) => {
          lines.forEach((ln, li) => {
            page.drawText(winAnsi(ln), { x: x + PAD, y: rowTop - PAD - SIZE.body - li * lineH, size: SIZE.body, font: f, color: rgb(color[0], color[1], color[2]) })
          })
          x += colW[ci] ?? 0
        })
        y = rowBottom
      }
      drawRow(b.header, true, false)
      b.rows.forEach((r, ri) => drawRow(r, false, ri % 2 === 1))
      y -= 6
    } else if (b.type === 'code') {
      for (const line of b.text.split('\n')) { ensure(SIZE.body + 4); y -= SIZE.body + 4; text(line, MARGIN, SIZE.body, font, pdfRgb(BRAND.slateText)) }
      y -= 4
    } else {
      for (const line of wrap(plain(b.inlines), font, SIZE.body, MAX_W)) { ensure(SIZE.body + 4); y -= SIZE.body + 4; text(line, MARGIN, SIZE.body, font, pdfRgb(BRAND.ink)) }
      y -= 4
    }
  }

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
