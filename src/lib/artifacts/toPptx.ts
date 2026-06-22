// src/lib/artifacts/toPptx.ts
import { parseMarkdown, type Block, type Inline } from './markdown'
import { BRAND, FONT } from './style'

type Slide = { title: string; body: Block[] }

function splitSlides(blocks: Block[]): Slide[] {
  const slides: Slide[] = []
  let current: Slide | null = null
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 1) {
      current = { title: b.inlines.map(i => i.text).join(''), body: [] }
      slides.push(current)
    } else {
      if (!current) { current = { title: '', body: [] }; slides.push(current) }
      current.body.push(b)
    }
  }
  return slides.length ? slides : [{ title: '', body: [] }]
}

const plain = (inlines: Inline[]) => inlines.map(i => i.text).join('')

export async function toPptx(markdown: string): Promise<Buffer> {
  const mod = await import('pptxgenjs')
  const PptxGenJS = mod.default ?? mod
  const pptx = new (PptxGenJS as new () => InstanceType<typeof import('pptxgenjs')['default']>)()
  pptx.layout = 'LAYOUT_WIDE'

  for (const slide of splitSlides(parseMarkdown(markdown))) {
    const s = pptx.addSlide()
    s.background = { color: BRAND.white }
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: BRAND.navy } })
    s.addText(slide.title || 'Slide', { x: 0.4, y: 0.1, w: 12, h: 0.7, fontFace: FONT.office, fontSize: 24, bold: true, color: BRAND.white, valign: 'middle' })

    const lines: { text: string; options: Record<string, unknown> }[] = []
    for (const b of slide.body) {
      if (b.type === 'list') {
        for (const item of b.items) lines.push({ text: plain(item), options: { bullet: b.ordered ? { type: 'number' } : true, color: BRAND.ink, fontSize: 16, fontFace: FONT.office } as Record<string, unknown> })
      } else if (b.type === 'heading') {
        lines.push({ text: plain(b.inlines), options: { bold: true, color: BRAND.steelBlue, fontSize: 18, fontFace: FONT.office, paraSpaceBefore: 6 } })
      } else if (b.type === 'paragraph') {
        lines.push({ text: plain(b.inlines), options: { color: BRAND.ink, fontSize: 16, fontFace: FONT.office } })
      } else if (b.type === 'table') {
        for (const row of [b.header, ...b.rows]) lines.push({ text: row.map(plain).join('  |  '), options: { color: BRAND.slateText, fontSize: 14, fontFace: FONT.mono } })
      } else if (b.type === 'code') {
        lines.push({ text: b.text, options: { color: BRAND.slateText, fontSize: 13, fontFace: FONT.mono } })
      }
    }
    if (lines.length) {
      s.addText(lines.map(l => ({ text: l.text, options: { ...l.options, breakLine: true } })), { x: 0.5, y: 1.1, w: 12.3, h: 6, valign: 'top' })
    }
  }

  const data = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(data as Buffer)
}
