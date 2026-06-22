// src/lib/artifacts/toPdf.ts
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { parseMarkdown, type Inline } from './markdown'
import { BRAND, SIZE, pdfRgb } from './style'

const PAGE = { w: 612, h: 792 } // US Letter (points)
const MARGIN = 54
const MAX_W = PAGE.w - MARGIN * 2

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/)
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
    page.drawText(s, { x, y, size, font: f, color: rgb(color[0], color[1], color[2]) })
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
      for (const item of b.items) {
        const wrapped = wrap(plain(item), font, SIZE.body, MAX_W - 16)
        wrapped.forEach((line, li) => {
          ensure(SIZE.body + 4); y -= SIZE.body + 4
          text(li === 0 ? '•' : ' ', MARGIN, SIZE.body, font, pdfRgb(BRAND.slateText))
          text(line, MARGIN + 16, SIZE.body, font, pdfRgb(BRAND.ink))
        })
      }
      y -= 4
    } else if (b.type === 'table') {
      const cols = b.header.length || 1
      const colW = MAX_W / cols
      const drawRow = (cells: Inline[][], isHeader: boolean, band: boolean) => {
        ensure(SIZE.body + 8); y -= SIZE.body + 8
        const navyColor = pdfRgb(BRAND.navy)
        const softMistColor = pdfRgb(BRAND.softMist)
        if (isHeader) page.drawRectangle({ x: MARGIN, y: y - 2, width: MAX_W, height: SIZE.body + 8, color: rgb(navyColor[0], navyColor[1], navyColor[2]) })
        else if (band) page.drawRectangle({ x: MARGIN, y: y - 2, width: MAX_W, height: SIZE.body + 8, color: rgb(softMistColor[0], softMistColor[1], softMistColor[2]) })
        cells.forEach((cell, ci) => {
          const s = plain(cell).slice(0, 40)
          text(s, MARGIN + ci * colW + 4, SIZE.body, isHeader ? bold : font, isHeader ? pdfRgb(BRAND.white) : pdfRgb(BRAND.ink))
        })
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
