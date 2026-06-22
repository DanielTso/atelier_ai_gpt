# Artifact Formatting Upgrade — Design Spec

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Author:** Daniel + Claude (Sr Fullstack Engineer)

## Problem

The `generate_artifact` engine (`src/lib/artifacts/`) produces files that are "plain text in
Excel/Word/PDF/PowerPoint" — no styling. Concretely:

- `toXlsx.ts` dumps rows and bolds row 1. No column widths, colors, borders, banding, frozen
  header, or number alignment.
- `toDocx.ts` handles only `#`/`##`/`###` headings, `- ` bullets, and paragraphs. **No tables**, no
  inline bold/italic, no styled headings, no title block, no header/footer.
- `toPdf.ts` / `toPptx.ts` are similarly minimal.
- The content model is thin: Claude sends either `sheets` (`[{name, rows}]`) for xlsx or a plain
  `markdown` string for docx/pdf/pptx. Even with a better renderer, Markdown tables aren't rendered
  and Claude isn't guided to emit structure.

Two reference images (an Excel Gantt look-ahead and a Word ITP) set the **quality bar** — they are
not templates to reproduce.

## Goal

Make **every** generated artifact look like a professionally formatted document — styled headers,
real tables, fonts, brand colors, spacing — across all four formats, using the **Atelier brand
palette**. Generic styling applied to whatever Claude emits; no per-document-type templates.

## Non-goals (explicitly out of scope)

- Reproducing the reference layouts: Gantt timeline-bar columns, COMPLETE/PLANNED/MILESTONE status
  badges, week/day column scaffolding, TOC, cover pages, the 84-page ITP tab structure.
- Changing the tool input schema, the DB schema, or the artifact storage/version flow (no migration).
- Changing the in-app `ArtifactPreview` (it reads the unchanged stored source).
- Embedding custom fonts (use widely available system fonts + pdf-lib standard fonts).

## Approach (chosen)

Approach 1: a shared brand-style module + a shared Markdown tokenizer, consumed by per-format
renderers. Rejected alternatives: per-renderer duplication (inconsistent, 3× table code); HTML
intermediate (heavy Chromium/html-to-docx deps that fight the Fluid-Compute/bundle constraints).

## File layout

```
src/lib/artifacts/
├─ style.ts      NEW — brand constants + per-format color/font helpers
├─ markdown.ts   NEW — parseMarkdown(md) → neutral AST (via `marked` lexer)
├─ toXlsx.ts     REWRITE — styled rows (row-based, no AST)
├─ toDocx.ts     REWRITE — consumes AST
├─ toPdf.ts      REWRITE — consumes AST
├─ toPptx.ts     REWRITE — consumes AST (slides split on H1)
├─ tool.ts       EDIT — description guides Claude to emit structured content
├─ render.ts     UNCHANGED — dispatch signatures unchanged
└─ types.ts      EDIT — add the markdown-AST types
```

New dependency: `marked` (pure-JS, no postinstall → no `pnpm-workspace.yaml` policy change).

> Note on reuse: the project already depends on `react-markdown` + `remark-gfm`, but those emit
> **React elements** for in-browser rendering (used by `MessagesList` and `ArtifactPreview`). The
> file renderers run server-side and need a plain token stream, not React. `marked.lexer()` provides
> exactly that synchronously with a tiny footprint, so it is added rather than reusing the React
> stack. (Reusing remark/mdast directly would mean wiring `unified` + `remark-parse` for marginal
> benefit over `marked`.)

## Components

### `style.ts` (brand source of truth for documents)

Exports brand hex colors mirrored from `globals.css` `@theme`:

- `navy #1F3447`, `steelBlue #4F7396`, `ink #16202A`, `slateText #6F7781`, `softMist #F3F1EC`,
  `mutedLine #E3DDD2`, `white #FFFFFF`, `success #3F7252`, `warning #A06D2E`.

Plus: font names (`Calibri` for Office docs; pdf-lib uses standard `Helvetica`/`Helvetica-Bold`),
heading point sizes (H1 16, H2 13, H3 11.5, body 11), and small helpers to convert a hex string to
each library's color type (exceljs `ARGB` `FF……`, docx hex without `#`, pdf-lib `rgb(r,g,b)` 0–1,
pptxgenjs hex without `#`). One place to tune the look.

### `markdown.ts` (shared tokenizer)

`parseMarkdown(md: string): Block[]` using `marked.lexer`. Maps to a neutral, library-agnostic AST:

```ts
type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean }
type Block =
  | { type: 'heading'; level: 1|2|3|4|5|6; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }     // each item = inline runs
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; text: string }
```

Inline parsing flattens `strong`/`em`/`codespan`/`text` (and link text) into runs. Unsupported
tokens (images, blockquotes, hr) degrade to plain paragraphs. This AST is the single contract the
three text renderers consume.

### `toXlsx.ts`

Row-based (Claude's `sheets` model, unchanged). Per worksheet:

- **Header row (row 1):** navy fill, white bold font, centered, thin borders; freeze with
  `ws.views = [{ state: 'frozen', ySplit: 1 }]`.
- **Body rows:** alternating banded fill (Soft Mist on even rows), thin muted-line borders, wrap
  text, vertical-center.
- **Column widths:** computed from the max rendered length per column, clamped to ~[10, 60].
- **Numeric columns:** right-aligned when every non-header cell in the column is a number.
- Keep the existing `neutralizeCell` formula-injection guard. Multi-sheet preserved. Empty-sheet
  fallback preserved.

### `toDocx.ts`

Consumes the AST. Produces:

- **Title block:** the artifact title as a navy heading with a steel-blue bottom border rule.
- **Headings:** H1 navy ~16pt bold, H2 steel-blue ~13pt bold, H3+ ink bold; body Calibri/ink 11pt.
- **Inline runs:** bold/italic/monospace.
- **Lists:** bulleted and numbered.
- **Tables:** full-width Word table — navy header row (white bold), banded body rows, muted-line
  borders.
- **Page header** (artifact title) and **footer** (page number field).

### `toPdf.ts`

Consumes the AST with pdf-lib (Letter, margins, Helvetica family). Title block (navy), sized/colored
headings, wrapped paragraphs, bullets, and **simple branded tables** (header fill band + row
separators; cell text wraps to a sane line cap). Tracks `y` and adds pages on overflow; footer page
numbers. pdf-lib is low-level, so tables are intentionally simple (no cell merging).

### `toPptx.ts`

Consumes the AST with pptxgenjs. The first `# H1` (or each top-level `#`) starts a slide. Title
slide variant for the first; content slides have a navy title strip with white title text and styled
body (bullets/paragraphs) in brand colors.

### `tool.ts`

Update the `description` to instruct Claude to **emit structure**: for docx/pdf/pptx use `##`
headings, `**bold**`, `| Markdown | tables |`, and `- ` lists; for xlsx provide a header row plus
clean columns. Keep the input schema identical.

## Error handling

Every renderer stays best-effort within the existing `tool.ts` try/catch (failures return
`{ error }` and clean up the uploaded object). `parseMarkdown` never throws on malformed input —
unknown tokens degrade to paragraphs. Empty content yields a valid minimal file.

## Testing

- **Unit — `parseMarkdown`:** headings, inline bold/italic/code, ordered/unordered lists, tables,
  fallback for unsupported tokens.
- **Unit — renderers (smoke):** each `to*` returns a non-empty Buffer with correct magic bytes (`PK`
  for xlsx/docx/pptx ZIP, `%PDF` for pdf). xlsx read-back via exceljs asserts header fill, frozen
  view, and computed column widths. docx/pptx assert the ZIP contains expected parts.
- **Regression:** existing artifact tests stay green.
- **Gate:** `npm run typecheck`, `npm run lint` (0 errors), `npm run build`, `npm test`.
- **Manual:** generate one of each type via a Claude chat; download and eyeball against the quality
  bar; confirm `ArtifactPreview` still renders.

## Risks

- **pdf-lib table fidelity** is limited (manual layout). Mitigation: keep PDF tables simple; accept
  lower fidelity than docx/xlsx.
- **`marked` output drift** across versions. Mitigation: pin the version; the neutral AST isolates
  renderers from `marked` internals.
- **Font availability** (Calibri) on the viewer's machine. Mitigation: Office falls back gracefully;
  choice is a widely available professional default.

## Definition of done

All four renderers emit brand-styled output (verified by tests + a manual one-of-each download),
Markdown tables render in Word/PDF, the tool guides Claude to produce structure, the full gate passes
with zero errors, and `ArtifactPreview` is unaffected. Ship as a minor version bump with CHANGELOG +
release, per the project cadence.
