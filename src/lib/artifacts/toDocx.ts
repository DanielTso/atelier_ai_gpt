// src/lib/artifacts/toDocx.ts
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, Header, Footer, PageNumber,
} from 'docx'
import { parseMarkdown, type Block, type Inline } from './markdown'
import { BRAND, FONT, SIZE } from './style'

const runs = (inlines: Inline[]) =>
  inlines.map(i => new TextRun({
    text: i.text,
    bold: i.bold,
    italics: i.italic,
    font: i.code ? FONT.mono : FONT.office,
    color: BRAND.ink,
  }))

function headingPara(b: Extract<Block, { type: 'heading' }>): Paragraph {
  const level = b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
  const color = b.level === 1 ? BRAND.navy : b.level === 2 ? BRAND.steelBlue : BRAND.ink
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
      shading: { type: ShadingType.SOLID, color: BRAND.navy, fill: BRAND.navy },
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

function listParas(b: Extract<Block, { type: 'list' }>): Paragraph[] {
  return b.items.map(item => new Paragraph({
    children: runs(item),
    bullet: b.ordered ? undefined : { level: 0 },
    numbering: b.ordered ? { reference: 'ol', level: 0 } : undefined,
  }))
}

export async function toDocx(markdown: string): Promise<Buffer> {
  const blocks = parseMarkdown(markdown)
  const children: (Paragraph | Table)[] = []

  for (const b of blocks) {
    if (b.type === 'heading') children.push(headingPara(b))
    else if (b.type === 'table') children.push(mdTable(b))
    else if (b.type === 'list') children.push(...listParas(b))
    else if (b.type === 'code') children.push(new Paragraph({ children: [new TextRun({ text: b.text, font: FONT.mono, color: BRAND.slateText })] }))
    else children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.inlines) }))
  }
  if (children.length === 0) children.push(new Paragraph({}))

  const doc = new Document({
    numbering: { config: [{ reference: 'ol', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] },
    styles: { default: { document: { run: { font: FONT.office, size: SIZE.body * 2, color: BRAND.ink } } } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '', color: BRAND.slateText })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], color: BRAND.slateText, size: 18 })] })] }) },
      children,
    }],
  })
  return await Packer.toBuffer(doc)
}
