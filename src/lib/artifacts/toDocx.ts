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

// Every ordered list or sublist gets its OWN numbering definition (its own
// abstractNum, starting at the list's start value, e.g. "3." for a list that
// resumes after a paragraph), so Word cannot share a counter between lists and
// a later list restarts instead of continuing the previous one (audit B17).
// Every ordered item sits on level 0 of its definition; a nested sublist's
// depth is carried by the paragraph's own indent instead.
type OrderedList = { reference: string; start: number }
function olConfig({ reference, start }: OrderedList) {
  return {
    reference,
    levels: [{ level: 0, format: 'decimal' as const, text: '%1.', start, alignment: AlignmentType.START }],
  }
}

type Numbering = { lists: OrderedList[] }

function listParas(b: Extract<Block, { type: 'list' }>, num: Numbering): Paragraph[] {
  // The open ordered list at each depth, so a parent's later items keep their
  // count after a nested sublist.
  const open: OrderedList[] = []
  return b.items.map(item => {
    const level = Math.min(item.level, MAX_LEVEL)
    if (!item.ordered) return new Paragraph({ children: runs(item.inlines), bullet: { level } })
    if (item.startsList || !open[level]) {
      const list = { reference: `ol-${num.lists.length + 1}`, start: item.number }
      num.lists.push(list)
      open[level] = list
    }
    return new Paragraph({
      children: runs(item.inlines),
      numbering: { reference: open[level]!.reference, level: 0 },
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
  const num: Numbering = { lists: [] }

  for (const b of blocks) {
    if (b.type === 'heading') children.push(headingPara(b))
    else if (b.type === 'table') children.push(mdTable(b))
    else if (b.type === 'list') children.push(...listParas(b, num))
    else if (b.type === 'code') children.push(codePara(b.text))
    else children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.inlines) }))
  }
  if (children.length === 0) children.push(new Paragraph({}))

  const doc = new Document({
    numbering: { config: num.lists.map(olConfig) },
    styles: { default: { document: { run: { font: FONT.office, size: SIZE.body * 2, color: BRAND.ink } } } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '', color: BRAND.slateText })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], color: BRAND.slateText, size: 18 })] })] }) },
      children,
    }],
  })
  return await Packer.toBuffer(doc)
}
