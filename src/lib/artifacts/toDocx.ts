// src/lib/artifacts/toDocx.ts
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, Header, Footer, PageNumber,
} from 'docx'
import { parseMarkdown, type Block, type Inline } from './markdown'
import { BRAND, FONT, SIZE } from './style'

const runs = (inlines: Inline[]) =>
  inlines.map(i => {
    const run = new TextRun({
      text: i.text,
      bold: i.bold,
      italics: i.italic,
      font: i.code ? FONT.mono : FONT.office,
      color: i.href ? BRAND.terracotta : BRAND.ink,
      underline: i.href ? {} : undefined,
    })
    // Emit a real, clickable hyperlink when the run carries a destination.
    return i.href ? new ExternalHyperlink({ children: [run], link: i.href }) : run
  })

function headingPara(b: Extract<Block, { type: 'heading' }>): Paragraph {
  const level = b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
  const color = b.level === 1 ? BRAND.clay : b.level === 2 ? BRAND.terracotta : BRAND.ink
  const size = (b.level === 1 ? SIZE.h1 : b.level === 2 ? SIZE.h2 : SIZE.h3) * 2 // half-points
  return new Paragraph({
    heading: level,
    spacing: { before: 200, after: 100 },
    children: b.inlines.map(i => new TextRun({ text: i.text, bold: true, color, size, font: FONT.office })),
  })
}

function mdTable(b: Extract<Block, { type: 'table' }>): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: b.header.map(cell => new TableCell({
      shading: { type: ShadingType.SOLID, color: BRAND.clay, fill: BRAND.clay },
      children: [new Paragraph({ children: cell.map(i => new TextRun({ text: i.text, bold: true, color: BRAND.white, font: FONT.office })) })],
    })),
  })
  const bodyRows = b.rows.map((row, ri) => new TableRow({
    children: row.map(cell => new TableCell({
      shading: ri % 2 === 1 ? { type: ShadingType.SOLID, color: BRAND.softMist, fill: BRAND.softMist } : undefined,
      children: [new Paragraph({ children: runs(cell) })],
    })),
  }))
  const border = { style: BorderStyle.SINGLE, size: 4, color: BRAND.mutedLine }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [headerRow, ...bodyRows],
  })
}

// Word supports nesting levels 0..8.
const MAX_LEVEL = 8

// One numbering definition per distinct start value ("3." for a list that
// resumes after a paragraph). Each ordered list or sublist gets its OWN
// instance of it, so a later list restarts at its start instead of continuing
// the previous list's count (audit B17). Every ordered item sits on level 0 of
// its instance, the level docx writes a restart override for; a nested
// sublist's depth is carried by the paragraph's own indent instead.
const olReference = (start: number) => `ol-${start}`
function olConfig(start: number) {
  return {
    reference: olReference(start),
    levels: [{ level: 0, format: 'decimal' as const, text: '%1.', start, alignment: AlignmentType.START }],
  }
}

type Numbering = { instance: number; starts: Set<number> }

function listParas(b: Extract<Block, { type: 'list' }>, num: Numbering): Paragraph[] {
  // The open ordered list at each depth, so a parent's later items keep their
  // count after a nested sublist.
  const open: { instance: number; start: number }[] = []
  return b.items.map(item => {
    const level = Math.min(item.level, MAX_LEVEL)
    if (!item.ordered) return new Paragraph({ children: runs(item.inlines), bullet: { level } })
    if (item.startsList || !open[level]) {
      num.instance += 1
      num.starts.add(item.number)
      open[level] = { instance: num.instance, start: item.number }
    }
    const list = open[level]!
    return new Paragraph({
      children: runs(item.inlines),
      numbering: { reference: olReference(list.start), level: 0, instance: list.instance },
      indent: { left: 720 * (level + 1), hanging: 360 },
    })
  })
}

// Code keeps its line structure: one run per line, joined by line breaks
// (a "\n" inside a single run renders as one line in Word, audit B17).
function codePara(text: string): Paragraph {
  return new Paragraph({
    children: text.split('\n').map((line, i) => new TextRun({ text: line, font: FONT.mono, color: BRAND.slateText, break: i > 0 ? 1 : undefined })),
  })
}

export async function toDocx(markdown: string): Promise<Buffer> {
  const blocks = parseMarkdown(markdown)
  const children: (Paragraph | Table)[] = []
  const num: Numbering = { instance: 0, starts: new Set() }

  for (const b of blocks) {
    if (b.type === 'heading') children.push(headingPara(b))
    else if (b.type === 'table') children.push(mdTable(b))
    else if (b.type === 'list') children.push(...listParas(b, num))
    else if (b.type === 'code') children.push(codePara(b.text))
    else children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.inlines) }))
  }
  if (children.length === 0) children.push(new Paragraph({}))

  const doc = new Document({
    numbering: { config: [...num.starts].map(olConfig) },
    styles: { default: { document: { run: { font: FONT.office, size: SIZE.body * 2, color: BRAND.ink } } } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '', color: BRAND.slateText })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], color: BRAND.slateText, size: 18 })] })] }) },
      children,
    }],
  })
  return await Packer.toBuffer(doc)
}
