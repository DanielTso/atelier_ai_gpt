# Phase D1 — Artifact Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Frame implementers by role (Database / Backend / Frontend / Docs).

**Goal:** Let Claude generate downloadable `.xlsx`/`.docx`/`.pdf` artifacts via a `generate_artifact` tool — server renders the file, stores it in `atelier-files`, and returns a downloadable card inline in chat.

**Architecture:** Pure-function renderers in `src/lib/artifacts/` (exceljs/docx/pdf-lib) → a `generate_artifact` AI SDK tool (`execute` renders + uploads + persists) merged into the chat route's tools → an `artifacts` table + GET/DELETE route → `ArtifactCard` rendered from the tool result and reattached on chat load via `getChatArtifacts`.

**Tech Stack:** Next.js 16, AI SDK v6 (`tool()` + `streamText`), `exceljs` (present), `docx`, `pdf-lib`, Drizzle/postgres-js, Vitest (+ PGlite, jsdom).

## Global Constraints
- Spec: `docs/specs/2026-06-17-phase-d1-artifact-engine-design.md`. **D1 only** (engine); the workspace panel/versioning is D2.
- AI SDK v6 tool API: `tool({ description, inputSchema: z.object({...}), execute: async (input) => output })`. Custom tools coexist with Claude `web_search` in one `tools` object.
- Storage reused from C-storage (`src/lib/storage.ts`); private `atelier-files` bucket; live Supabase configured (`.env.local`, migrations `0000`→`0004` applied; this plan adds `0005`).
- Conventional Commits; commit-body trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Windows + PowerShell + OneDrive.
- Renderer tests assert file **magic bytes** (xlsx/docx are ZIP → `PK\x03\x04`; pdf → `%PDF`) + non-empty — version-agnostic, no deep parsing.

---

## Task 1: Deps + artifacts schema + migration 0005 (Database)

**Files:** `package.json`, `src/db/schema.ts`, `drizzle/`

- [ ] **Step 1:** `npm install docx pdf-lib` (both runtime deps). Confirm they land in `dependencies`.
- [ ] **Step 2:** In `src/db/schema.ts`, add the table (after `documents`/`documentChunks`, before `personaUsage` is fine — keep imports `pgTable, text, integer, timestamp` already present):
```ts
export const artifacts = pgTable('artifacts', {
  id: idPk(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  storagePath: text('storage_path').notNull(),
  status: text('status').notNull().default('ready'),
  errorMessage: text('error_message'),
  createdAt: createdAt(),
}, (table) => [
  index('idx_artifacts_chat_id').on(table.chatId),
]);
```
- [ ] **Step 3:** `npx drizzle-kit generate` (offline). Expect `drizzle/0005_*.sql` creating `artifacts` (+ the index). Verify it ONLY creates `artifacts` (no other table changes). If it errors needing a URL, prefix `$env:DIRECT_URL='postgresql://x:x@localhost:5432/x';`.
- [ ] **Step 4:** `npx tsc --noEmit` → clean.
- [ ] **Step 5:** Commit:
```bash
git add package.json package-lock.json src/db/schema.ts drizzle/
git commit -m "feat(phase-d1): docx+pdf-lib deps and artifacts table"
```
(+ trailer)

> Live apply of `0005` happens in Task 7 (with the smoke), not here.

---

## Task 2: Artifact renderers (Backend, TDD)

**Files:** Create `src/lib/artifacts/types.ts`, `toXlsx.ts`, `toDocx.ts`, `toPdf.ts`, `render.ts`, `tests/unit/lib/artifacts/render.test.ts`

**Interfaces:**
- Produces: `type ArtifactType = 'xlsx'|'docx'|'pdf'`; `interface SheetSpec { name: string; rows: (string|number)[][] }`; `renderArtifact(type: ArtifactType, title: string, content: string | SheetSpec[]): Promise<{ buffer: Buffer; contentType: string; ext: ArtifactType }>`.

- [ ] **Step 1: Write the failing test** `tests/unit/lib/artifacts/render.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderArtifact } from '@/lib/artifacts/render'

const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // ZIP (xlsx/docx)

describe('renderArtifact', () => {
  it('renders xlsx from sheet specs (ZIP magic)', async () => {
    const out = await renderArtifact('xlsx', 'Schedule', [{ name: 'Tasks', rows: [['Task', 'Days'], ['Excavation', 5]] }])
    expect(out.ext).toBe('xlsx')
    expect(out.contentType).toContain('spreadsheetml')
    expect(out.buffer.subarray(0, 4)).toEqual(PK)
    expect(out.buffer.length).toBeGreaterThan(100)
  })

  it('renders docx from markdown (ZIP magic)', async () => {
    const out = await renderArtifact('docx', 'Report', '# Title\n\nA paragraph.\n\n- one\n- two')
    expect(out.ext).toBe('docx')
    expect(out.contentType).toContain('wordprocessingml')
    expect(out.buffer.subarray(0, 4)).toEqual(PK)
  })

  it('renders pdf from markdown (%PDF magic)', async () => {
    const out = await renderArtifact('pdf', 'Report', '# Title\n\nA paragraph of body text.')
    expect(out.ext).toBe('pdf')
    expect(out.contentType).toBe('application/pdf')
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('throws on an unknown type', async () => {
    // @ts-expect-error invalid type
    await expect(renderArtifact('pptx', 't', 'x')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/unit/lib/artifacts/render.test.ts`).

- [ ] **Step 3: Implement** the modules.

`src/lib/artifacts/types.ts`:
```ts
export type ArtifactType = 'xlsx' | 'docx' | 'pdf'

export interface SheetSpec {
  name: string
  rows: (string | number)[][]
}

export interface RenderedArtifact {
  buffer: Buffer
  contentType: string
  ext: ArtifactType
}
```

`src/lib/artifacts/toXlsx.ts`:
```ts
import type { SheetSpec } from './types'

export async function toXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const specs = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]
  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name || 'Sheet1')
    spec.rows.forEach((row, i) => {
      const added = ws.addRow(row)
      if (i === 0) added.font = { bold: true }
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
```

`src/lib/artifacts/toDocx.ts`:
```ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

/** Minimal Markdown → docx: #/##/### headings, '- ' bullets, blank-line paragraphs. */
export async function toDocx(markdown: string): Promise<Buffer> {
  const children: Paragraph[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { children.push(new Paragraph({})); continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
      children.push(new Paragraph({ heading: level, children: [new TextRun(h[2])] }))
      continue
    }
    const b = /^[-*]\s+(.*)$/.exec(line)
    if (b) { children.push(new Paragraph({ text: b[1], bullet: { level: 0 } })); continue }
    children.push(new Paragraph({ children: [new TextRun(line)] }))
  }
  const doc = new Document({ sections: [{ children }] })
  return await Packer.toBuffer(doc)
}
```

`src/lib/artifacts/toPdf.ts`:
```ts
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
```

`src/lib/artifacts/render.ts`:
```ts
import type { ArtifactType, SheetSpec, RenderedArtifact } from './types'
import { toXlsx } from './toXlsx'
import { toDocx } from './toDocx'
import { toPdf } from './toPdf'

const CONTENT_TYPE: Record<ArtifactType, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

export async function renderArtifact(
  type: ArtifactType,
  title: string,
  content: string | SheetSpec[]
): Promise<RenderedArtifact> {
  let buffer: Buffer
  if (type === 'xlsx') {
    buffer = await toXlsx(Array.isArray(content) ? content : [])
  } else if (type === 'docx') {
    buffer = await toDocx(typeof content === 'string' ? content : '')
  } else if (type === 'pdf') {
    buffer = await toPdf(typeof content === 'string' ? content : '')
  } else {
    throw new Error(`Unknown artifact type: ${type}`)
  }
  return { buffer, contentType: CONTENT_TYPE[type], ext: type }
}
```

- [ ] **Step 4: Run — expect PASS (4/4).** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit:** `git add src/lib/artifacts tests/unit/lib/artifacts && git commit -m "feat(phase-d1): artifact renderers (xlsx/docx/pdf)"` (+ trailer)

---

## Task 3: Artifact persistence actions (Backend, TDD)

**Files:** `src/app/actions.ts`; `tests/unit/actions/artifacts.test.ts`

**Interfaces:**
- Produces: `createArtifact(data: { chatId: number; projectId: number | null; type: string; title: string; storagePath: string; status?: string; errorMessage?: string }): Promise<row[]>`; `getChatArtifacts(chatId: number): Promise<{ id; chatId; type; title; status; downloadUrl: string | null; createdAt }[]>`; `getArtifactById(id): Promise<row|null>`; `deleteArtifact(id): Promise<row[]>`.

- [ ] **Step 1: Write the failing test** `tests/unit/actions/artifacts.test.ts` using the sibling PGlite harness (mock `@/db` → `testDb`, `createTestDb()` in `beforeEach`) AND mock `@/lib/storage` (`createSignedDownloadUrl` → `signed:<path>`, `removeObjects`, `isStorageConfigured` → true). READ a sibling actions test for the exact harness. Cover:
```ts
  it('creates an artifact and reads it back with a signed downloadUrl', async () => {
    const { createProject, createChat, createArtifact, getChatArtifacts } = await import('@/app/actions')
    const [p] = await createProject('P'); const [c] = await createChat(p.id, 'C')
    await createArtifact({ chatId: c.id, projectId: p.id, type: 'xlsx', title: 'Schedule', storagePath: `artifacts/${p.id}/1/schedule.xlsx` })
    const rows = await getChatArtifacts(c.id)
    expect(rows[0].title).toBe('Schedule')
    expect(rows[0].type).toBe('xlsx')
    expect(rows[0].downloadUrl).toBe(`signed:artifacts/${p.id}/1/schedule.xlsx`)
  })

  it('deleteArtifact returns the row (for storage cleanup)', async () => {
    const { createProject, createChat, createArtifact, deleteArtifact } = await import('@/app/actions')
    const [p] = await createProject('P'); const [c] = await createChat(p.id, 'C')
    const [a] = await createArtifact({ chatId: c.id, projectId: p.id, type: 'pdf', title: 'R', storagePath: 'artifacts/x.pdf' })
    const [d] = await deleteArtifact(a.id)
    expect(d.id).toBe(a.id)
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** in `src/app/actions.ts` (add `artifacts` to the `@/db/schema` import; `createSignedDownloadUrl` is already imported from `@/lib/storage`):
```ts
export async function createArtifact(data: {
  chatId: number; projectId: number | null; type: string; title: string; storagePath: string; status?: string; errorMessage?: string
}) {
  return await db.insert(artifacts).values({
    chatId: data.chatId, projectId: data.projectId ?? null, type: data.type, title: data.title,
    storagePath: data.storagePath, status: data.status ?? 'ready', errorMessage: data.errorMessage ?? null,
  }).returning()
}

export async function getArtifactById(id: number) {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, id))
  return a ?? null
}

export async function getChatArtifacts(chatId: number) {
  const rows = await db.select().from(artifacts).where(eq(artifacts.chatId, chatId)).orderBy(asc(artifacts.createdAt))
  return await Promise.all(rows.map(async (r) => ({
    id: r.id, chatId: r.chatId, type: r.type, title: r.title, status: r.status, createdAt: r.createdAt,
    downloadUrl: r.storagePath ? await createSignedDownloadUrl(r.storagePath).catch(() => null) : null,
  })))
}

export async function deleteArtifact(id: number) {
  return await db.delete(artifacts).where(eq(artifacts.id, id)).returning()
}
```
(`asc` is already imported in actions.ts.)

- [ ] **Step 4: Run — expect PASS.** Full actions suite `npx vitest run tests/unit/actions/` (no regressions) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/app/actions.ts tests/unit/actions/artifacts.test.ts && git commit -m "feat(phase-d1): artifact persistence actions"` (+ trailer)

---

## Task 4: generate_artifact tool + chat-route wiring (Backend, TDD)

**Files:** Create `src/lib/artifacts/tool.ts`, `tests/unit/lib/artifacts/tool.test.ts`; modify `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `renderArtifact` (T2), `createArtifact` (T3), `uploadBuffer`/`isStorageConfigured` (`@/lib/storage`).
- Produces: `createGenerateArtifactTool(ctx: { chatId: number; projectId: number | null }): Tool` — an AI SDK `tool()` whose `execute` returns `{ artifactId: number; title: string; type: string; downloadUrl: string } | { error: string }`.

- [ ] **Step 1: Write the failing test** `tests/unit/lib/artifacts/tool.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRender = vi.fn()
const mockUpload = vi.fn()
const mockCreate = vi.fn()
const mockSigned = vi.fn()

async function load() {
  vi.resetModules()
  vi.doMock('@/lib/artifacts/render', () => ({ renderArtifact: mockRender }))
  vi.doMock('@/lib/storage', () => ({ uploadBuffer: mockUpload, createSignedDownloadUrl: mockSigned, isStorageConfigured: () => true }))
  vi.doMock('@/app/actions', () => ({ createArtifact: mockCreate }))
  return (await import('@/lib/artifacts/tool')).createGenerateArtifactTool
}

describe('generate_artifact tool', () => {
  beforeEach(() => {
    [mockRender, mockUpload, mockCreate, mockSigned].forEach(f => f.mockReset())
    mockRender.mockResolvedValue({ buffer: Buffer.from('PK..'), contentType: 'app/xlsx', ext: 'xlsx' })
    mockUpload.mockResolvedValue(undefined)
    mockCreate.mockResolvedValue([{ id: 9 }])
    mockSigned.mockResolvedValue('signed:url')
  })

  it('renders, uploads, persists, returns a downloadable result', async () => {
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute({ type: 'xlsx', title: 'Schedule', format: 'sheets', content: [{ name: 'T', rows: [['a']] }] })
    expect(mockRender).toHaveBeenCalledWith('xlsx', 'Schedule', [{ name: 'T', rows: [['a']] }])
    expect(mockUpload).toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ chatId: 3, projectId: 1, type: 'xlsx', title: 'Schedule' }))
    expect(out).toEqual({ artifactId: 9, title: 'Schedule', type: 'xlsx', downloadUrl: 'signed:url' })
  })

  it('returns an error result when rendering throws', async () => {
    mockRender.mockRejectedValue(new Error('bad content'))
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute({ type: 'pdf', title: 'R', format: 'markdown', content: 'x' })
    expect(out).toEqual({ error: expect.stringContaining('Failed') })
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `src/lib/artifacts/tool.ts`:
```ts
import { tool } from 'ai'
import { z } from 'zod'
import { renderArtifact } from './render'
import { uploadBuffer, createSignedDownloadUrl } from '@/lib/storage'
import { createArtifact } from '@/app/actions'
import type { ArtifactType } from './types'

const sheetSpec = z.object({ name: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))) })

function slug(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact').slice(0, 60)
}

export function createGenerateArtifactTool(ctx: { chatId: number; projectId: number | null }) {
  return tool({
    description: 'Generate a downloadable file artifact (Excel .xlsx, Word .docx, or PDF) for the user. ' +
      'Use for reports, schedules, takeoffs, and write-ups the user can download. For xlsx, pass format "sheets" ' +
      'with content as an array of {name, rows}. For docx/pdf, pass format "markdown" with content as a Markdown string.',
    inputSchema: z.object({
      type: z.enum(['xlsx', 'docx', 'pdf']),
      title: z.string().min(1).max(200),
      format: z.enum(['markdown', 'sheets']),
      content: z.union([z.string(), z.array(sheetSpec)]),
    }),
    execute: async ({ type, title, content }) => {
      try {
        const { buffer, contentType, ext } = await renderArtifact(type as ArtifactType, title, content)
        const [row] = await createArtifact({ chatId: ctx.chatId, projectId: ctx.projectId, type, title, storagePath: 'pending' })
        const path = `artifacts/${ctx.projectId ?? 'standalone'}/${row.id}/${slug(title)}.${ext}`
        await uploadBuffer(path, buffer, contentType)
        // Re-point storage path now that we know the artifact id.
        const { updateArtifactStoragePath } = await import('@/app/actions')
        await updateArtifactStoragePath(row.id, path)
        const downloadUrl = await createSignedDownloadUrl(path)
        return { artifactId: row.id, title, type, downloadUrl }
      } catch (e) {
        console.warn('[generate_artifact] failed:', e instanceof Error ? e.message : e)
        return { error: 'Failed to generate the artifact.' }
      }
    },
  })
}
```
Add to `src/app/actions.ts` the small helper used above:
```ts
export async function updateArtifactStoragePath(id: number, storagePath: string) {
  return await db.update(artifacts).set({ storagePath }).where(eq(artifacts.id, id)).returning()
}
```
(Update the T4 tool test's `createArtifact` mock to also mock `updateArtifactStoragePath` in the `@/app/actions` doMock: add `updateArtifactStoragePath: vi.fn()`.)

- [ ] **Step 4: Wire into the chat route** `src/app/api/chat/route.ts`. After `const { model: selectedModel, tools: providerTools, providerOptions } = await createProvider(modelName)` (rename `tools` → `providerTools`), and after the `chat` is fetched for `chatId`, build the merged tools:
```ts
import { createGenerateArtifactTool } from '@/lib/artifacts/tool'
import { isStorageConfigured } from '@/lib/storage'
// ...
let tools = providerTools
if (modelName.startsWith('claude') && chatId && isStorageConfigured()) {
  const projectId = (await getChatWithContext(chatId))?.projectId ?? null
  tools = { ...(providerTools ?? {}), generate_artifact: createGenerateArtifactTool({ chatId, projectId }) }
}
```
(`getChatWithContext(chatId)` is already called in the route — reuse that `chat` variable's `projectId` instead of a second call; the snippet shows intent. Pass `tools` into `streamText` where `googleTools` was used.) Ensure `toUIMessageStreamResponse` is called with `{ sendSources: true }` as today.

- [ ] **Step 5: Run** `npx vitest run tests/unit/lib/artifacts/tool.test.ts` (PASS), full api suite (no regressions), `npx tsc --noEmit`, `npm run build` (chat route compiles with the merged tool).
- [ ] **Step 6: Commit:** `git add src/lib/artifacts/tool.ts tests/unit/lib/artifacts/tool.test.ts src/app/api/chat/route.ts src/app/actions.ts && git commit -m "feat(phase-d1): generate_artifact tool wired into chat"` (+ trailer)

---

## Task 5: Artifacts GET/DELETE route (Backend, TDD)

**Files:** Create `src/app/api/artifacts/route.ts`, `tests/unit/api/artifacts-route.test.ts`

- [ ] **Step 1: Write the failing test** (mirror `tests/unit/api/documents-route.test.ts` patterns — mock `@/app/actions` + `@/lib/storage`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetChatArtifacts = vi.fn()
const mockGetArtifactById = vi.fn()
const mockDeleteArtifact = vi.fn()
const mockRemoveObjects = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({ getChatArtifacts: mockGetChatArtifacts, getArtifactById: mockGetArtifactById, deleteArtifact: mockDeleteArtifact }))
  vi.doMock('@/lib/storage', () => ({ removeObjects: mockRemoveObjects }))
  return await import('@/app/api/artifacts/route')
}

describe('artifacts route', () => {
  beforeEach(() => { [mockGetChatArtifacts, mockGetArtifactById, mockDeleteArtifact, mockRemoveObjects].forEach(f => f.mockReset()) })

  it('GET returns chat artifacts', async () => {
    mockGetChatArtifacts.mockResolvedValue([{ id: 1, title: 'R', type: 'pdf', downloadUrl: 'signed:x' }])
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/artifacts?chatId=3') as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.artifacts[0].downloadUrl).toBe('signed:x')
  })

  it('DELETE removes the storage object then the row', async () => {
    mockGetArtifactById.mockResolvedValue({ id: 5, storagePath: 'artifacts/5/r.pdf' })
    mockRemoveObjects.mockResolvedValue(undefined); mockDeleteArtifact.mockResolvedValue([{ id: 5 }])
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request('http://localhost/api/artifacts?id=5', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    expect(mockRemoveObjects).toHaveBeenCalledWith(['artifacts/5/r.pdf'])
    expect(mockDeleteArtifact).toHaveBeenCalledWith(5)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `src/app/api/artifacts/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getChatArtifacts, getArtifactById, deleteArtifact } from '@/app/actions'
import { removeObjects } from '@/lib/storage'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const chatId = Number(searchParams.get('chatId'))
  if (!chatId || isNaN(chatId)) return NextResponse.json({ error: 'Invalid chatId' }, { status: 400 })
  return NextResponse.json({ artifacts: await getChatArtifacts(chatId) })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = Number(searchParams.get('id'))
  if (!id || isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const a = await getArtifactById(id)
  if (a?.storagePath) {
    await removeObjects([a.storagePath]).catch((e) => console.warn('[artifacts] cleanup failed:', e instanceof Error ? e.message : e))
  }
  await deleteArtifact(id)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Run — expect PASS (2/2).** Full api suite + `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/app/api/artifacts/route.ts tests/unit/api/artifacts-route.test.ts && git commit -m "feat(phase-d1): artifacts GET/DELETE route"` (+ trailer)

---

## Task 6: ArtifactCard + chat rendering (Frontend, TDD)

**Files:** `src/types.ts`; create `src/components/chat/ArtifactCard.tsx`, `tests/hooks/ArtifactCard.test.tsx`; modify `src/components/chat/MessagesList.tsx`; modify `src/app/page.tsx` (load artifacts on chat open)

**Interfaces:**
- Produces: `ArtifactSummary` in `src/types.ts`: `{ id: number; chatId: number; type: 'xlsx'|'docx'|'pdf'|string; title: string; status: string; downloadUrl: string | null; createdAt: Date | null }`.

- [ ] **Step 1:** Add `ArtifactSummary` to `src/types.ts`:
```ts
export interface ArtifactSummary {
  id: number
  chatId: number
  type: string
  title: string
  status: string
  downloadUrl: string | null
  createdAt: Date | null
}
```

- [ ] **Step 2: Write the failing test** `tests/hooks/ArtifactCard.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ArtifactCard } from '@/components/chat/ArtifactCard'
import type { ArtifactSummary } from '@/types'

const a: ArtifactSummary = { id: 1, chatId: 3, type: 'xlsx', title: 'Site Schedule', status: 'ready', downloadUrl: 'signed:x', createdAt: null }

describe('ArtifactCard', () => {
  it('shows the title, type label, and a download link', () => {
    render(<ArtifactCard artifact={a} />)
    expect(screen.getByText('Site Schedule')).toBeTruthy()
    expect(screen.getByText(/XLSX/i)).toBeTruthy()
    const link = screen.getByRole('link', { name: /download/i }) as HTMLAnchorElement
    expect(link.href).toContain('signed:x')
  })

  it('renders without a link when downloadUrl is null', () => {
    render(<ArtifactCard artifact={{ ...a, downloadUrl: null }} />)
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
  })
})
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** `src/components/chat/ArtifactCard.tsx`:
```tsx
'use client'
import { memo } from 'react'
import { FileSpreadsheet, FileText, FileType, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArtifactSummary } from '@/types'

const ICON: Record<string, typeof FileText> = { xlsx: FileSpreadsheet, docx: FileType, pdf: FileText }

export const ArtifactCard = memo(function ArtifactCard({ artifact }: { artifact: ArtifactSummary }) {
  const Icon = ICON[artifact.type] ?? FileText
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/50 p-3 my-2 max-w-sm">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{artifact.title}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{artifact.type}</p>
      </div>
      {artifact.downloadUrl && (
        <a href={artifact.downloadUrl} target="_blank" rel="noreferrer"
          className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity shrink-0')}>
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      )}
    </div>
  )
})
```

- [ ] **Step 5: Run — expect PASS (2/2).**

- [ ] **Step 6: Render artifacts in the chat.** Because tool results aren't persisted in message parts, render the chat's artifacts from a loaded list. In `src/app/page.tsx`: add `const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([])`; in `loadMessages(cid)` also `fetch(\`/api/artifacts?chatId=${cid}\`)` → `setArtifacts(data.artifacts)`; after a chat response finishes (the existing `onFinish`), re-fetch artifacts so a freshly-generated one appears. Pass `artifacts` to `MessagesList`. In `src/components/chat/MessagesList.tsx`, accept an `artifacts?: ArtifactSummary[]` prop and render an `ArtifactCard` for each **after the last assistant message** (D1 keys by chat, not per-message):
```tsx
{artifacts && artifacts.length > 0 && (
  <div className="px-4">{artifacts.map(a => <ArtifactCard key={a.id} artifact={a} />)}</div>
)}
```
(Import `ArtifactCard` + the `ArtifactSummary` type. Place the block after the messages map, inside the scroll container.)

- [ ] **Step 7:** `npm run build` clean; `npx tsc --noEmit` clean; `npm run lint` no new errors.
- [ ] **Step 8:** Commit: `git add src/types.ts src/components/chat/ArtifactCard.tsx tests/hooks/ArtifactCard.test.tsx src/components/chat/MessagesList.tsx src/app/page.tsx && git commit -m "feat(phase-d1): artifact cards rendered in chat"` (+ trailer)

---

## Task 7: Docs + gate + live apply 0005 + smoke (Docs / QA)

**Files:** `CLAUDE.md`, `CHANGELOG.md`, `docs/SESSION_HANDOFF.md`, `docs/chatlog-2026-06-17-phase-d1.md`

- [ ] **Step 1:** Apply migration `0005` to live Supabase: set `DIRECT_URL` to the session-pooler value from `.env.local` and run `npx drizzle-kit migrate`. Expect success. Verify the `artifacts` table exists.
- [ ] **Step 2:** `CLAUDE.md`: document the artifact engine — `generate_artifact` tool, `src/lib/artifacts/` renderers, `artifacts` table, `/api/artifacts` route, `ArtifactCard`, the `docx`/`pdf-lib` deps. Note D2 (workspace UI) is next.
- [ ] **Step 3:** `CHANGELOG.md`: add `[4.6.0]` — Phase D1 artifact engine (tool-generated XLSX/DOCX/PDF, stored + downloadable). Reference spec + plan.
- [ ] **Step 4:** `docs/SESSION_HANDOFF.md`: mark D1 done; D2 (artifact workspace UI) next; migration `0005` applied.
- [ ] **Step 5:** Write `docs/chatlog-2026-06-17-phase-d1.md`.
- [ ] **Step 6: Full gate:** `npm run lint && npm run build && npm test` — 0 errors, 0 new warnings, all green.
- [ ] **Step 7: Live smoke** (Supabase + Anthropic configured): `npm run dev`, ask the chat "Make an Excel schedule with columns Task/Days and three rows." → an artifact card appears → Download yields a valid `.xlsx`. Repeat for "Write a one-page PDF project summary."
- [ ] **Step 8:** Commit (+ trailer).

---

## Self-review

**Spec coverage:** renderers xlsx/docx/pdf (T2) · `generate_artifact` tool + chat wiring (T4) · artifacts table + migration 0005 (T1, applied T7) · actions + GET/DELETE route with signed URLs + cleanup (T3/T5) · `ArtifactSummary` + `ArtifactCard` + chat rendering + reload via getChatArtifacts (T6) · deps docx/pdf-lib (T1) · tests + gate + live smoke (T7). ✅ D2 (panel/versioning), PPTX, charts — non-goals, deferred.
**Placeholders:** all modules/tests shown in full; chat-route + page.tsx edits show the exact additions (implementer reads the files first, as noted). ✅
**Type consistency:** `ArtifactType`/`SheetSpec`/`renderArtifact` (T2) consumed by the tool (T4); `createArtifact`/`getChatArtifacts`/`getArtifactById`/`deleteArtifact`/`updateArtifactStoragePath` (T3/T4) used by tool + route (T4/T5); `ArtifactSummary` (T6) returned by `getChatArtifacts`'s shape (T3) and consumed by `ArtifactCard` (T6); `createGenerateArtifactTool(ctx)` signature consistent T4. ✅
**Deferred (D2+):** artifact workspace panel, live preview, versioning/edit-regenerate, per-message pinning, PPTX, charts/images, manual export button.
