/** Minimal Markdown → pptx: each `# H1` starts a new slide; ##/### + paragraphs
 *  become body text; `- `/`* ` become bullets. Pure-JS (pptxgenjs), serverless-safe. */
export async function toPptx(markdown: string): Promise<Buffer> {
  const mod = await import('pptxgenjs')
  const PptxGenJS = mod.default
  const pptx = new PptxGenJS()

  type Body = { text: string; bullet: boolean }
  const slides: { title: string; body: Body[] }[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h1 = /^#\s+(.*)$/.exec(line)
    if (h1) { slides.push({ title: h1[1] ?? '', body: [] }); continue }
    if (slides.length === 0) slides.push({ title: '', body: [] })
    const slide = slides[slides.length - 1]!
    const h = /^#{2,3}\s+(.*)$/.exec(line)
    if (h) { slide.body.push({ text: h[1] ?? '', bullet: false }); continue }
    const b = /^[-*]\s+(.*)$/.exec(line)
    slide.body.push(b ? { text: b[1] ?? '', bullet: true } : { text: line, bullet: false })
  }
  if (slides.length === 0) slides.push({ title: 'Untitled', body: [] })

  for (const s of slides) {
    const slide = pptx.addSlide()
    slide.addText(s.title || ' ', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true, color: '1F3447' })
    if (s.body.length > 0) {
      slide.addText(
        s.body.map(b => ({ text: b.text, options: { bullet: b.bullet, fontSize: 16, color: '16202A', breakLine: true } })),
        { x: 0.7, y: 1.3, w: 8.6, h: 5 },
      )
    }
  }

  const out = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(out as ArrayBuffer)
}
