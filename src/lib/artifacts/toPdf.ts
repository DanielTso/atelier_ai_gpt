import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/** Minimal Markdown → a clean text PDF (headings larger/bold, wrapped paragraphs, bullets). */
export async function toPdf(markdown: string): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const margin = 56
  let page = pdf.addPage()
  let { width, height } = page.getSize()
  let y = height - margin

  const ensure = (lineH: number) => { if (y - lineH < margin) { page = pdf.addPage(); ({ width, height } = page.getSize()); y = height - margin } }
  const maxW = () => width - margin * 2
  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const words = text.split(/\s+/), lines: string[] = []
    let cur = ''
    for (const w of words) {
      const trial = cur ? cur + ' ' + w : w
      if (f.widthOfTextAtSize(trial, size) > maxW() && cur) { lines.push(cur); cur = w } else cur = trial
    }
    if (cur) lines.push(cur)
    return lines.length ? lines : ['']
  }
  const draw = (text: string, f: typeof font, size: number, gap = 4) => {
    for (const line of wrap(text, f, size)) {
      ensure(size + gap)
      page.drawText(line, { x: margin, y, size, font: f, color: rgb(0.1, 0.13, 0.17) })
      y -= size + gap
    }
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { y -= 8; continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) { const size = h[1].length === 1 ? 20 : h[1].length === 2 ? 16 : 13; y -= 4; draw(h[2], bold, size, 6); continue }
    const b = /^[-*]\s+(.*)$/.exec(line)
    if (b) { draw('• ' + b[1], font, 11); continue }
    draw(line, font, 11)
  }
  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
