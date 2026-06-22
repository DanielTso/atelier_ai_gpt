# Artifact Formatting Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every generated artifact (xlsx/docx/pdf/pptx) render as a professionally formatted, Atelier-branded document instead of plain text.

**Architecture:** A shared `style.ts` (brand constants + per-library color helpers) and a shared `markdown.ts` (`parseMarkdown` → neutral AST via the `marked` lexer) feed four rewritten renderers. xlsx stays row-based (Claude's `sheets` model) with a styling pass; docx/pdf/pptx consume the AST. The tool description is updated so Claude emits structured content. No schema/migration/preview changes.

**Tech Stack:** TypeScript (strict), `exceljs`, `docx`, `pdf-lib`, `pptxgenjs`, new dep `marked`, Vitest.

## Global Constraints

- Server Components / server-only modules; renderers run on Node (Fluid Compute), never Edge.
- No change to the `generate_artifact` input schema, the DB schema, storage paths, or the version flow. No migration.
- `ArtifactPreview` and `MessagesList` (React markdown via `react-markdown`) are NOT touched.
- Brand colors are stored as `#`-less hex uppercase, mirrored from `globals.css` `@theme`: navy `1F3447`, steelBlue `4F7396`, ink `16202A`, slateText `6F7781`, softMist `F3F1EC`, mutedLine `E3DDD2`, white `FFFFFF`, success `3F7252`, warning `A06D2E`.
- Office docs use `Calibri` body font; PDF uses pdf-lib standard `Helvetica`/`Helvetica-Bold`. No embedded font files.
- Conventional Commits. Gate before tag: `npm run typecheck`, `npm run lint` (0 errors), `npm run build`, `npm test`.
- AST types live in `markdown.ts` (co-located with the parser that produces them) and are imported by the renderers. `src/lib/artifacts/types.ts` is NOT modified.

---

### Task 1: Brand style module

**Files:**
- Create: `src/lib/artifacts/style.ts`
- Test: `tests/unit/lib/artifacts/style.test.ts`

**Interfaces:**
- Produces: `BRAND` (record of `#`-less hex), `FONT` (`{ office, mono }`), `SIZE` (`{ h1, h2, h3, body }`, points), `argb(hex: string): string` (exceljs `FF`+hex), `pdfRgb(hex: string): [number, number, number]` (0–1 triplet).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifacts/style.test.ts
import { describe, it, expect } from 'vitest'
import { BRAND, FONT, SIZE, argb, pdfRgb } from '@/lib/artifacts/style'

describe('artifact style', () => {
  it('exposes brand hex without # prefix', () => {
    expect(BRAND.navy).toBe('1F3447')
    expect(BRAND.white).toBe('FFFFFF')
  })
  it('argb prefixes FF for exceljs', () => {
    expect(argb(BRAND.navy)).toBe('FF1F3447')
  })
  it('pdfRgb returns a normalized 0..1 triplet', () => {
    const [r, g, b] = pdfRgb('FFFFFF')
    expect([r, g, b]).toEqual([1, 1, 1])
    const [r2] = pdfRgb('000000')
    expect(r2).toBe(0)
  })
  it('exposes font + size scales', () => {
    expect(FONT.office).toBe('Calibri')
    expect(SIZE.h1).toBeGreaterThan(SIZE.body)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/style.test.ts`
Expected: FAIL — cannot resolve `@/lib/artifacts/style`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/artifacts/style.ts
// Brand palette mirrored from globals.css @theme. Stored as #-less uppercase hex
// because docx and pptxgenjs both want bare hex; exceljs wants ARGB; pdf-lib wants 0..1.
export const BRAND = {
  navy: '1F3447',
  steelBlue: '4F7396',
  ink: '16202A',
  slateText: '6F7781',
  softMist: 'F3F1EC',
  mutedLine: 'E3DDD2',
  white: 'FFFFFF',
  success: '3F7252',
  warning: 'A06D2E',
} as const

export const FONT = { office: 'Calibri', mono: 'Consolas' } as const

// Point sizes for headings + body.
export const SIZE = { h1: 16, h2: 13, h3: 11.5, body: 11 } as const

/** exceljs fills/fonts use 8-digit ARGB. */
export const argb = (hex: string): string => `FF${hex}`

/** pdf-lib rgb() wants 0..1 channel floats. */
export const pdfRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(0, 2), 16) / 255,
  parseInt(hex.slice(2, 4), 16) / 255,
  parseInt(hex.slice(4, 6), 16) / 255,
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/style.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/style.ts tests/unit/lib/artifacts/style.test.ts
git commit -m "feat(artifacts): add brand style module for renderers"
```

---

### Task 2: Markdown AST parser

**Files:**
- Create: `src/lib/artifacts/markdown.ts`
- Test: `tests/unit/lib/artifacts/markdown.test.ts`
- Modify: `package.json` (add `marked`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean }`
  - `type Block = { type: 'heading'; level: number; inlines: Inline[] } | { type: 'paragraph'; inlines: Inline[] } | { type: 'list'; ordered: boolean; items: Inline[][] } | { type: 'table'; header: Inline[][]; rows: Inline[][][] } | { type: 'code'; text: string }`
  - `parseMarkdown(md: string): Block[]`

- [ ] **Step 1: Install `marked`**

Run: `npm install marked@^14`
Expected: adds `marked` to dependencies; `marked` ships its own types (no `@types/marked` needed).

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/lib/artifacts/markdown.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '@/lib/artifacts/markdown'

describe('parseMarkdown', () => {
  it('parses headings with level', () => {
    const [b] = parseMarkdown('## Scope')
    expect(b).toMatchObject({ type: 'heading', level: 2 })
    expect(b.type === 'heading' && b.inlines[0]!.text).toBe('Scope')
  })

  it('captures inline bold and italic', () => {
    const [b] = parseMarkdown('Plain **bold** and *em* text')
    if (b.type !== 'paragraph') throw new Error('expected paragraph')
    const bold = b.inlines.find(i => i.bold)
    const em = b.inlines.find(i => i.italic)
    expect(bold?.text).toBe('bold')
    expect(em?.text).toBe('em')
  })

  it('parses unordered and ordered lists', () => {
    const [ul] = parseMarkdown('- one\n- two')
    expect(ul).toMatchObject({ type: 'list', ordered: false })
    expect(ul.type === 'list' && ul.items.length).toBe(2)
    const [ol] = parseMarkdown('1. a\n2. b')
    expect(ol).toMatchObject({ type: 'list', ordered: true })
  })

  it('parses a GFM table', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |'
    const [t] = parseMarkdown(md)
    if (t.type !== 'table') throw new Error('expected table')
    expect(t.header.map(c => c[0]!.text)).toEqual(['A', 'B'])
    expect(t.rows[0]!.map(c => c[0]!.text)).toEqual(['1', '2'])
  })

  it('degrades unsupported tokens and never throws', () => {
    expect(() => parseMarkdown('> quote\n\n---\n\n![x](y)')).not.toThrow()
    expect(parseMarkdown('')).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/markdown.test.ts`
Expected: FAIL — cannot resolve `@/lib/artifacts/markdown`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/artifacts/markdown.ts
import { marked, type Token, type Tokens } from 'marked'

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean }
export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; text: string }

// Flatten marked inline tokens into styled runs, tracking bold/italic/code context.
function inlines(tokens: Token[] | undefined, ctx: { bold?: boolean; italic?: boolean } = {}): Inline[] {
  const out: Inline[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong': out.push(...inlines((t as Tokens.Strong).tokens, { ...ctx, bold: true })); break
      case 'em': out.push(...inlines((t as Tokens.Em).tokens, { ...ctx, italic: true })); break
      case 'codespan': out.push({ text: (t as Tokens.Codespan).text, code: true }); break
      case 'link': out.push(...inlines((t as Tokens.Link).tokens, ctx)); break
      case 'br': out.push({ text: '\n' }); break
      case 'escape': out.push({ text: (t as Tokens.Escape).text, ...ctx }); break
      default: {
        const text = 'text' in t ? String((t as { text: unknown }).text) : ''
        if (text) out.push({ text, ...ctx })
      }
    }
  }
  return out.length ? out : [{ text: '' }]
}

function cellInlines(cell: Tokens.TableCell): Inline[] {
  return inlines(cell.tokens)
}

export function parseMarkdown(md: string): Block[] {
  const tokens = marked.lexer(md ?? '')
  const blocks: Block[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        blocks.push({ type: 'heading', level: (t as Tokens.Heading).depth, inlines: inlines((t as Tokens.Heading).tokens) })
        break
      case 'paragraph':
        blocks.push({ type: 'paragraph', inlines: inlines((t as Tokens.Paragraph).tokens) })
        break
      case 'list': {
        const list = t as Tokens.List
        blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(it => inlines(it.tokens)) })
        break
      }
      case 'table': {
        const table = t as Tokens.Table
        blocks.push({
          type: 'table',
          header: table.header.map(cellInlines),
          rows: table.rows.map(row => row.map(cellInlines)),
        })
        break
      }
      case 'code':
        blocks.push({ type: 'code', text: (t as Tokens.Code).text })
        break
      case 'space':
      case 'hr':
        break
      case 'blockquote': {
        // Degrade a blockquote to its paragraphs.
        blocks.push({ type: 'paragraph', inlines: inlines((t as Tokens.Blockquote).tokens) })
        break
      }
      default: {
        // Unknown block → plain paragraph if it carries text, else skip.
        const text = 'text' in t ? String((t as { text: unknown }).text) : ''
        if (text.trim()) blocks.push({ type: 'paragraph', inlines: [{ text }] })
      }
    }
  }
  return blocks
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/markdown.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/artifacts/markdown.ts tests/unit/lib/artifacts/markdown.test.ts
git commit -m "feat(artifacts): add shared markdown AST parser (marked)"
```

---

### Task 3: Styled Excel renderer

**Files:**
- Modify: `src/lib/artifacts/toXlsx.ts` (full rewrite of the body; keep `neutralizeCell`)
- Test: `tests/unit/lib/artifacts/toXlsx.test.ts`

**Interfaces:**
- Consumes: `BRAND`, `argb`, `FONT` from `./style`; `SheetSpec` from `./types`.
- Produces: `toXlsx(sheets: SheetSpec[]): Promise<Buffer>` (signature unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifacts/toXlsx.test.ts
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { toXlsx } from '@/lib/artifacts/toXlsx'

describe('toXlsx', () => {
  it('styles the header row, freezes it, and sizes columns', async () => {
    const buf = await toXlsx([{ name: 'S', rows: [['Activity', 'Dur'], ['Mobilize topsoil area', 3]] }])
    expect(buf.length).toBeGreaterThan(0)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('S')!
    const header = ws.getRow(1)
    expect(header.font?.bold).toBe(true)
    expect((header.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F3447')
    expect(ws.views[0]?.state).toBe('frozen')
    expect(ws.getColumn(1).width!).toBeGreaterThan(10)
  })

  it('falls back to a single empty sheet', async () => {
    const buf = await toXlsx([])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/toXlsx.test.ts`
Expected: FAIL — header fill is undefined / not navy.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/artifacts/toXlsx.ts
import type { SheetSpec } from './types'
import { BRAND, FONT, argb } from './style'

function neutralizeCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const BORDER = { style: 'thin' as const, color: { argb: argb(BRAND.mutedLine) } }
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }

export async function toXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const specs = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]

  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name || 'Sheet1')
    const rows = spec.rows ?? []

    rows.forEach((row, i) => {
      const added = ws.addRow(row.map(neutralizeCell))
      added.eachCell({ includeEmpty: true }, cell => {
        cell.border = ALL_BORDERS
        cell.alignment = { vertical: 'middle', wrapText: true }
      })
      if (i === 0) {
        added.font = { bold: true, color: { argb: argb(BRAND.white) }, name: FONT.office }
        added.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.navy) } }
        })
      } else if (i % 2 === 0) {
        // Band even body rows (row indices 2,4,... → spec rows i=2,4 are 0-based even).
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.softMist) } }
        })
      }
    })

    // Auto column widths from max rendered length, clamped to [10, 60].
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/toXlsx.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/toXlsx.ts tests/unit/lib/artifacts/toXlsx.test.ts
git commit -m "feat(artifacts): styled, branded xlsx output"
```

---

### Task 4: Styled Word renderer

**Files:**
- Modify: `src/lib/artifacts/toDocx.ts` (full rewrite)
- Test: `tests/unit/lib/artifacts/toDocx.test.ts`

**Interfaces:**
- Consumes: `parseMarkdown`, `Block`, `Inline` from `./markdown`; `BRAND`, `FONT`, `SIZE` from `./style`.
- Produces: `toDocx(markdown: string): Promise<Buffer>` (signature unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifacts/toDocx.test.ts
import { describe, it, expect } from 'vitest'
import { toDocx } from '@/lib/artifacts/toDocx'

describe('toDocx', () => {
  it('renders headings, bold, lists, and tables without throwing', async () => {
    const md = [
      '# Scope of Work',
      '',
      'Intro with **bold** text.',
      '',
      '## Items',
      '- first',
      '- second',
      '',
      '| Task | Days |',
      '| - | - |',
      '| Mobilize | 3 |',
    ].join('\n')
    const buf = await toDocx(md)
    expect(buf.length).toBeGreaterThan(0)
    // docx is a ZIP container → starts with "PK".
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('produces a valid file for empty input', async () => {
    const buf = await toDocx('')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/toDocx.test.ts`
Expected: FAIL — current `toDocx` ignores tables/bold but would still produce PK; the test fails first because the rewritten import surface (`parseMarkdown`) does not yet drive it. (If it passes against the old impl, proceed to rewrite anyway — Step 3 — and keep the test as a regression guard.)

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/toDocx.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/toDocx.ts tests/unit/lib/artifacts/toDocx.test.ts
git commit -m "feat(artifacts): styled, branded docx output with tables"
```

---

### Task 5: Styled PDF renderer

**Files:**
- Modify: `src/lib/artifacts/toPdf.ts` (full rewrite)
- Test: `tests/unit/lib/artifacts/toPdf.test.ts`

**Interfaces:**
- Consumes: `parseMarkdown`, `Block`, `Inline` from `./markdown`; `BRAND`, `pdfRgb`, `SIZE` from `./style`.
- Produces: `toPdf(markdown: string): Promise<Buffer>` (signature unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifacts/toPdf.test.ts
import { describe, it, expect } from 'vitest'
import { toPdf } from '@/lib/artifacts/toPdf'

describe('toPdf', () => {
  it('produces a valid multi-block PDF', async () => {
    const md = ['# Report', 'Para with **bold**.', '## Section', '- a', '- b'].join('\n\n')
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(400)
  })

  it('handles long content across pages without throwing', async () => {
    const md = Array.from({ length: 120 }, (_, i) => `Line ${i} with some wrapped text content here.`).join('\n\n')
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/toPdf.test.ts`
Expected: FAIL — rewritten import surface not present yet / current impl differs.

- [ ] **Step 3: Write minimal implementation**

```ts
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
    page.drawText(s, { x, y, size, font: f, color: rgb(...color) })
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
        for (const [li, line] of wrap(plain(item), font, SIZE.body, MAX_W - 16).entries()) {
          ensure(SIZE.body + 4); y -= SIZE.body + 4
          text(li === 0 ? '•' : ' ', MARGIN, SIZE.body, font, pdfRgb(BRAND.slateText))
          text(line, MARGIN + 16, SIZE.body, font, pdfRgb(BRAND.ink))
        }
      }
      y -= 4
    } else if (b.type === 'table') {
      const cols = b.header.length || 1
      const colW = MAX_W / cols
      const drawRow = (cells: Inline[][], isHeader: boolean, band: boolean) => {
        ensure(SIZE.body + 8); y -= SIZE.body + 8
        if (isHeader) page.drawRectangle({ x: MARGIN, y: y - 2, width: MAX_W, height: SIZE.body + 8, color: rgb(...pdfRgb(BRAND.navy)) })
        else if (band) page.drawRectangle({ x: MARGIN, y: y - 2, width: MAX_W, height: SIZE.body + 8, color: rgb(...pdfRgb(BRAND.softMist)) })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/toPdf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/toPdf.ts tests/unit/lib/artifacts/toPdf.test.ts
git commit -m "feat(artifacts): styled, branded pdf output"
```

---

### Task 6: Styled PowerPoint renderer

**Files:**
- Modify: `src/lib/artifacts/toPptx.ts` (full rewrite)
- Test: `tests/unit/lib/artifacts/toPptx.test.ts`

**Interfaces:**
- Consumes: `parseMarkdown`, `Block`, `Inline` from `./markdown`; `BRAND`, `FONT` from `./style`.
- Produces: `toPptx(markdown: string): Promise<Buffer>` (signature unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifacts/toPptx.test.ts
import { describe, it, expect } from 'vitest'
import { toPptx } from '@/lib/artifacts/toPptx'

describe('toPptx', () => {
  it('splits slides on H1 and produces a valid pptx', async () => {
    const md = ['# Title One', 'body a', '# Title Two', '- bullet'].join('\n\n')
    const buf = await toPptx(md)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('produces a deck for content with no H1', async () => {
    const buf = await toPptx('just a paragraph')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/toPptx.test.ts`
Expected: FAIL — rewritten import surface not present yet / current impl differs.

- [ ] **Step 3: Write minimal implementation**

```ts
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
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'

  for (const slide of splitSlides(parseMarkdown(markdown))) {
    const s = pptx.addSlide()
    s.background = { color: BRAND.white }
    // Navy title strip.
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: BRAND.navy } })
    s.addText(slide.title || 'Slide', { x: 0.4, y: 0.1, w: 12, h: 0.7, fontFace: FONT.office, fontSize: 24, bold: true, color: BRAND.white, valign: 'middle' })

    const lines: { text: string; options: object }[] = []
    for (const b of slide.body) {
      if (b.type === 'list') {
        for (const item of b.items) lines.push({ text: plain(item), options: { bullet: true, color: BRAND.ink, fontSize: 16, fontFace: FONT.office } })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/toPptx.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/toPptx.ts tests/unit/lib/artifacts/toPptx.test.ts
git commit -m "feat(artifacts): styled, branded pptx output"
```

---

### Task 7: Guide Claude to emit structure (tool description)

**Files:**
- Modify: `src/lib/artifacts/tool.ts:13-16` (the `description` string only)

**Interfaces:**
- Consumes: nothing new. The input schema and `execute` are unchanged.
- Produces: no code interface change — behavioral guidance for the model.

- [ ] **Step 1: Update the description**

Replace the `description` string with:

```ts
    description:
      'Generate a downloadable, professionally formatted file artifact (Excel .xlsx, Word .docx, PDF, or PowerPoint .pptx). ' +
      'Use for reports, schedules, takeoffs, write-ups, and slide decks. ' +
      'For xlsx, pass format "sheets" with content as an array of {name, rows}; make the FIRST row a header row of column titles and keep columns consistent. ' +
      'For docx/pdf/pptx, pass format "markdown" with rich Markdown: use "##"/"###" headings to structure sections, "**bold**" and "*italic*" for emphasis, "-"/"1." lists, and GitHub-flavored "| col | col |" tables for tabular data (these render as real styled Word/PDF tables). ' +
      'For pptx, each top-level "# Heading" starts a new slide. Prefer tables and headings over walls of plain text — the renderer styles this structure automatically.',
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no output errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/artifacts/tool.ts
git commit -m "feat(artifacts): guide model to emit structured content for formatting"
```

---

### Task 8: Full gate + version + changelog

**Files:**
- Modify: `package.json` (version), `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: typecheck clean; lint 0 errors (baseline ~27 warnings); build "Compiled successfully"; all tests pass (existing + the new artifact tests).

- [ ] **Step 2: Manual smoke (one of each type)**

Start dev, open a Claude chat with a `chatId`, ask: "Generate an xlsx schedule, a docx scope of work with a table, a pdf summary, and a pptx deck." Download each and confirm: navy styled headers, real tables in docx/pdf, banded xlsx with frozen header, styled slides. Confirm `ArtifactPreview` still opens.

- [ ] **Step 3: Bump version + changelog**

In `package.json` bump `version` to `4.20.0`. Prepend to `CHANGELOG.md`:

```markdown
## [4.20.0] - <date> — Professionally formatted artifacts

### Changed

- Generated artifacts (xlsx/docx/pdf/pptx) are now brand-styled instead of plain text. Shared `style.ts` (Atelier palette) + `markdown.ts` (`marked`-based AST). Excel gets a navy frozen header, banded rows, borders, auto column widths, numeric right-align; Word/PDF render Markdown **tables**, styled headings, inline bold/italic, lists, title block + page numbers; PPTX gets branded title/content slides. The `generate_artifact` tool now guides the model to emit structured Markdown.

### Notes

- New dep `marked` (pure-JS). No schema/migration/preview changes. Verification: typecheck clean, lint 0 errors, build clean, all tests pass.
```

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(artifacts): formatted-artifacts release (v4.20.0)"
```

---

## Self-Review

**Spec coverage:**
- style.ts (brand) → Task 1. markdown.ts (AST + `marked`) → Task 2. xlsx styling → Task 3. docx (tables, headings, lists, header/footer) → Task 4. pdf → Task 5. pptx → Task 6. tool description → Task 7. testing/gate/version → Task 8. `render.ts` unchanged (no task needed — signatures preserved). `ArtifactPreview` untouched (verified manually in Task 8). All spec sections covered.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The date token `<date>` in Task 8 changelog is filled at execution from the system date.

**Type consistency:** `parseMarkdown`/`Block`/`Inline` defined in Task 2 are consumed verbatim in Tasks 4–6. `BRAND`/`FONT`/`SIZE`/`argb`/`pdfRgb` defined in Task 1 are consumed in Tasks 3–6. `toXlsx`/`toDocx`/`toPdf`/`toPptx` signatures are unchanged, so `render.ts` keeps compiling.

**Note on docx test (Task 4):** if the smoke test passes against the pre-rewrite implementation, that is acceptable — the assertion is a regression guard (valid PK ZIP). The rewrite is still required to deliver tables/branding and is verified by the manual smoke in Task 8.
