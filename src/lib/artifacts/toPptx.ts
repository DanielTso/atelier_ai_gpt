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

// Surface link destinations as "text (url)" so the URL survives in the slide text.
const plain = (inlines: Inline[]) => inlines.map(i => (i.href && i.href !== i.text) ? `${i.text} (${i.href})` : i.text).join('')

type Line = { text: string; options: Record<string, unknown> }

/** Approx. body lines that fit the content box on a wide slide before overflow. */
export const MAX_LINES_PER_SLIDE = 12

/** Split items into fixed-size groups; always returns at least one (possibly empty) group. */
export function paginate<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]]
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size))
  return groups
}

// Flatten a slide's body blocks into styled text lines for the content box.
function bodyLines(body: Block[]): Line[] {
  const lines: Line[] = []
  for (const b of body) {
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
  return lines
}

export async function toPptx(markdown: string): Promise<Buffer> {
  const mod = await import('pptxgenjs')
  const PptxGenJS = mod.default ?? mod
  const pptx = new (PptxGenJS as new () => InstanceType<typeof import('pptxgenjs')['default']>)()
  pptx.layout = 'LAYOUT_WIDE'

  const renderSlide = (title: string, lines: Line[]) => {
    const s = pptx.addSlide()
    s.background = { color: BRAND.white }
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: BRAND.navy } })
    s.addText(title || 'Slide', { x: 0.4, y: 0.1, w: 12, h: 0.7, fontFace: FONT.office, fontSize: 24, bold: true, color: BRAND.white, valign: 'middle' })
    if (lines.length) {
      s.addText(lines.map(l => ({ text: l.text, options: { ...l.options, breakLine: true } })), { x: 0.5, y: 1.1, w: 12.3, h: 6, valign: 'top' })
    }
  }

  for (const slide of splitSlides(parseMarkdown(markdown))) {
    const lines = bodyLines(slide.body)
    // Overflow: split a long body across continuation slides ("… (cont.)").
    paginate(lines, MAX_LINES_PER_SLIDE).forEach((group, i) => {
      const title = i === 0 ? slide.title : `${slide.title || 'Slide'} (cont.)`
      renderSlide(title, group)
    })
  }

  const data = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(data as Buffer)
}
