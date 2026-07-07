# RAG Phase 1 — Ingestion Reliability & Fidelity Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal.** Kill the three silent-loss bugs in document ingestion (100K char truncation, 30-page vision cap, unbounded embedding fan-out) and make fidelity visible. Raise the char ceiling to 2M, bound + retry embeddings, raise the vision page cap to 60, persist the full extracted text as `extracted.txt`, and add a `page_count` / `pages_extracted` / `extraction_partial` schema + an amber **Partial** badge so a document always ends `complete`, explicitly `partial`, or `error`.

**Architecture.** The ingestion pipeline stays: `documents/process` route → extract (`fileExtraction` text / `visionExtraction` OCR) → `ingest.ts` (chunk→save→embed→status) for new uploads, or an inline embed-first→`commitDocumentReplacement` for the replace path. This plan (a) makes the extractors return a shared `ExtractionResult` carrying page/partial metadata, (b) extracts a bounded-concurrency+retry `embedChunks`/`embedContents` helper both paths call, (c) threads the metadata into `updateDocumentStatus`/`commitDocumentReplacement` behind migration `0014`, and (d) surfaces it in the API + `DocumentCard` + `DocumentPreviewDialog`.

**Tech stack.** Next.js 16 App Router, TypeScript, Drizzle + `drizzle-kit` on Supabase Postgres (pgvector), Gemini `gemini-embedding-001` embeddings, Vitest + PGlite for unit/DB tests, `@testing-library/react` (jsdom) for component tests.

## Global Constraints

- **Target release:** v4.44.0.
- `DOCUMENT_MAX_CHARS` default **2_000_000** (`Number(process.env.DOCUMENT_MAX_CHARS) || 2_000_000`).
- `EXTRACTION_MAX_PAGES` default **60** (raised from 30; already env-driven via `cfg()`).
- `EMBED_CONCURRENCY` default **5**, `EMBED_MAX_RETRIES` default **3**.
- **No silent loss:** any truncation, page-capping, or post-retry embed failure MUST surface as `extraction_partial = true` (a visible Partial badge). Never drop content without a signal.
- Vision pages stay **serial** (memory-safe on Fluid; paired with the shipped `maxDuration = 800` + stale reaper). Bounded-concurrency vision is out of scope.
- Migration `0014` is authored locally via `drizzle-kit generate`; **applying it to live Supabase is user-gated** (Task 8 documents it, does not run it).
- `extracted.txt` upload is **best-effort** (try/catch + `console.warn`; never fails ingestion — chunks are the retrieval path).
- **No backfill** of existing (already-truncated) documents. Old rows keep `extraction_partial = false`, `page_count`/`pages_extracted` null.
- **Style:** no Prettier; single-quote, no-semicolon for `.ts`/`.tsx` (match the file); `schema.ts` uses semicolons. Path alias `@/*` → `./src/*`.
- **Every commit** is a Conventional Commit (imperative lowercase, no trailing period) ending with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Gate (run before each commit):** `npm run typecheck` (0 errors) → `npm run lint` (0 errors) → `npm run build` → `npm test`. Single file: `npx vitest run <path>`.

---

### Task 1: Migration 0014 — page_count, pages_extracted, extraction_partial — [Model tier: FABLE]

**Files**
- `src/db/schema.ts` — `documents` table (lines 65–83); `boolean`/`integer` already imported (line 1) — no import change.
- `drizzle/0014_*.sql` — generated (do NOT hand-write; `drizzle-kit generate` names it).
- `drizzle/meta/_journal.json` + `drizzle/meta/0014_snapshot.json` — auto-updated by generate.
- `tests/unit/db/migration-0014.test.ts` — NEW (mirror `tests/unit/db/migration-0013.test.ts`, reuse `rowsOf`).

**Interfaces**
- Produces: three new Drizzle columns on `documents` — `pageCount` (`page_count integer`, nullable), `pagesExtracted` (`pages_extracted integer`, nullable), `extractionPartial` (`extraction_partial boolean NOT NULL DEFAULT false`). Consumed by Tasks 4/5/6/7.

**Steps**

- [ ] Write the failing test FIRST. Create `tests/unit/db/migration-0014.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest'
  import { sql } from 'drizzle-orm'
  import { createTestDb, testDb } from '../../helpers/test-db'

  // drizzle-orm/pglite's execute() returns { rows }, but postgres-js returns a bare
  // array. Normalize so this test asserts the same way regardless of driver shape.
  function rowsOf<T>(res: unknown): T[] {
    return ((res as { rows?: T[] }).rows ?? (res as T[]))
  }

  // Migration 0014: fidelity columns on documents (Phase 1 RAG). page_count /
  // pages_extracted are nullable; extraction_partial is NOT NULL DEFAULT false.
  describe('migration 0014 — document fidelity columns', () => {
    beforeEach(async () => { await createTestDb() })

    it('adds page_count, pages_extracted, extraction_partial with correct nullability + default', async () => {
      const res = await testDb.execute(sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'documents'
          AND column_name IN ('page_count', 'pages_extracted', 'extraction_partial')
        ORDER BY column_name
      `)
      const rows = rowsOf<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(res)
      const byName = Object.fromEntries(rows.map(r => [r.column_name, r]))
      expect(byName.page_count).toMatchObject({ data_type: 'integer', is_nullable: 'YES' })
      expect(byName.pages_extracted).toMatchObject({ data_type: 'integer', is_nullable: 'YES' })
      expect(byName.extraction_partial.data_type).toBe('boolean')
      expect(byName.extraction_partial.is_nullable).toBe('NO')
      expect(byName.extraction_partial.column_default).toMatch(/false/)
    })
  })
  ```

- [ ] Run it — expect FAIL (columns don't exist yet, migration not authored):
  ```
  npx vitest run tests/unit/db/migration-0014.test.ts
  ```
  Expected: `FAIL … expected undefined to match object { data_type: 'integer', … }` (byName.page_count is undefined).

- [ ] Edit `src/db/schema.ts` `documents` table — add the three columns after `extractionMethod` (keep semicolons, match the file):
  ```ts
  extractionMethod: text('extraction_method'),
  pageCount: integer('page_count'),
  pagesExtracted: integer('pages_extracted'),
  extractionPartial: boolean('extraction_partial').notNull().default(false),
  revision: integer('revision').notNull().default(1),
  ```

- [ ] Generate the migration (authors `drizzle/0014_<slug>.sql` + updates journal/snapshot):
  ```
  npx drizzle-kit generate
  ```
  Expected: prints `3 columns added` for `documents`; new `drizzle/0014_*.sql` contains exactly three `ALTER TABLE "documents" ADD COLUMN` statements:
  ```sql
  ALTER TABLE "documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
  ALTER TABLE "documents" ADD COLUMN "pages_extracted" integer;--> statement-breakpoint
  ALTER TABLE "documents" ADD COLUMN "extraction_partial" boolean DEFAULT false NOT NULL;
  ```
  Confirm `drizzle/meta/_journal.json` gained an `idx: 14` entry tagged `0014_*`.

- [ ] Re-run the test — expect PASS (PGlite runs all migrations incl. 0014 on `createTestDb`):
  ```
  npx vitest run tests/unit/db/migration-0014.test.ts
  ```
  Expected: `1 passed`.

- [ ] Run the gate (`npm run typecheck && npm run lint && npm run build && npm test`) — expect green. Commit:
  ```
  feat(db): add page_count, pages_extracted, extraction_partial to documents (migration 0014)
  ```

---

### Task 2: embedChunks helper — bounded concurrency + retry — [Model tier: FABLE]

**Files**
- `src/lib/embedChunks.ts` — NEW.
- `tests/unit/lib/embedChunks.test.ts` — NEW.

**Interfaces**
- Consumes: `generateEmbedding(text: string, taskType?: 'query' | 'document') => Promise<number[]>` from `@/lib/embeddings`; `updateChunkEmbedding(chunkId: number, embedding: number[]) => Promise<...>` from `@/app/actions`.
- Produces (both used downstream — keep these signatures exact):
  ```ts
  // Persisting variant — for the new-upload path (chunks already saved, have ids).
  export async function embedChunks(
    chunks: { id: number; content: string }[],
    opts?: { concurrency?: number; retries?: number },
  ): Promise<{ embedded: number; failed: number }>

  // Non-persisting variant — for the replace path (embeds BEFORE inserting, no ids yet).
  export async function embedContents(
    contents: string[],
    opts?: { concurrency?: number; retries?: number },
  ): Promise<{ embeddings: (number[] | null)[]; embedded: number; failed: number }>
  ```
  Both share one bounded worker pool + retry primitive (spec Component B: "shared by ingest + replace paths"). `embedContents` exists because the replace path in Task 6 cannot use the id-based `embedChunks` — it must embed before any destructive DB write to keep the prior revision intact.

**Steps**

- [ ] Write the failing test FIRST. Create `tests/unit/lib/embedChunks.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const mockGenerateEmbedding = vi.fn()
  const mockUpdateChunkEmbedding = vi.fn()

  async function load() {
    vi.resetModules()
    vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: mockGenerateEmbedding }))
    vi.doMock('@/app/actions', () => ({ updateChunkEmbedding: mockUpdateChunkEmbedding }))
    return await import('@/lib/embedChunks')
  }

  const vec = () => new Array(768).fill(0.1)

  describe('embedChunks', () => {
    beforeEach(() => { mockGenerateEmbedding.mockReset(); mockUpdateChunkEmbedding.mockReset(); mockUpdateChunkEmbedding.mockResolvedValue(undefined) })

    it('never exceeds the concurrency cap', async () => {
      let inFlight = 0, maxInFlight = 0
      mockGenerateEmbedding.mockImplementation(async () => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(r => setTimeout(r, 5))
        inFlight--; return vec()
      })
      const { embedChunks } = await load()
      const chunks = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, content: `c${i}` }))
      const res = await embedChunks(chunks, { concurrency: 5 })
      expect(maxInFlight).toBeLessThanOrEqual(5)
      expect(res).toEqual({ embedded: 20, failed: 0 })
      expect(mockUpdateChunkEmbedding).toHaveBeenCalledTimes(20)
    })

    it('retries a chunk that rejects once then resolves, and counts it embedded', async () => {
      mockGenerateEmbedding
        .mockRejectedValueOnce(new Error('429 rate limit'))
        .mockResolvedValueOnce(vec())
      const { embedChunks } = await load()
      const res = await embedChunks([{ id: 1, content: 'a' }], { concurrency: 1, retries: 3 })
      expect(res).toEqual({ embedded: 1, failed: 0 })
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
      expect(mockUpdateChunkEmbedding).toHaveBeenCalledWith(1, expect.any(Array))
    })

    it('counts a permanently-failing chunk as failed and does not throw', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('boom'))
      const { embedChunks } = await load()
      const res = await embedChunks([{ id: 1, content: 'a' }, { id: 2, content: 'b' }], { concurrency: 2, retries: 1 })
      expect(res).toEqual({ embedded: 0, failed: 2 })
      expect(mockUpdateChunkEmbedding).not.toHaveBeenCalled()
    })
  })

  describe('embedContents', () => {
    beforeEach(() => { mockGenerateEmbedding.mockReset() })

    it('returns embeddings in order with null for failures, and does not persist', async () => {
      mockGenerateEmbedding
        .mockResolvedValueOnce(vec())
        .mockRejectedValue(new Error('down'))
      const { embedContents } = await load()
      const res = await embedContents(['a', 'b'], { concurrency: 1, retries: 0 })
      expect(res.embedded).toBe(1)
      expect(res.failed).toBe(1)
      expect(res.embeddings[0]).toEqual(expect.any(Array))
      expect(res.embeddings[1]).toBeNull()
      expect(mockUpdateChunkEmbedding).not.toHaveBeenCalled()
    })
  })
  ```

- [ ] Run it — expect FAIL (module missing):
  ```
  npx vitest run tests/unit/lib/embedChunks.test.ts
  ```
  Expected: `FAIL … Cannot find module '@/lib/embedChunks'`.

- [ ] Implement `src/lib/embedChunks.ts` (single-quote, no-semicolon):
  ```ts
  // Bounded-concurrency, retrying embedding — shared by the new-upload path (embedChunks,
  // persists by chunk id) and the replace path (embedContents, returns embeddings so it can
  // embed BEFORE the destructive commit). Removing the 100K truncation turns a long contract
  // into hundreds of chunks; firing them all at once 429s Gemini and silently drops embeddings.
  import { generateEmbedding } from '@/lib/embeddings'
  import { updateChunkEmbedding } from '@/app/actions'

  const DEFAULT_CONCURRENCY = Number(process.env.EMBED_CONCURRENCY) || 5
  const DEFAULT_RETRIES = Number(process.env.EMBED_MAX_RETRIES) || 3
  const BACKOFF_BASE_MS = 100

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // Embed one string with retry + exponential backoff (100ms, 200ms, 400ms…). Returns null
  // if every attempt fails — a null is a counted, visible failure, never a thrown crash.
  async function embedWithRetry(content: string, retries: number): Promise<number[] | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await generateEmbedding(content, 'document')
      } catch (err) {
        if (attempt === retries) {
          console.warn(`[embedChunks] embed failed after ${retries + 1} attempts:`, err instanceof Error ? err.message : err)
          return null
        }
        await sleep(BACKOFF_BASE_MS * 2 ** attempt)
      }
    }
    return null
  }

  // Bounded worker pool: at most `concurrency` tasks in flight; preserves index order.
  async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    async function worker() {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await task(items[i], i)
      }
    }
    const n = Math.max(1, Math.min(concurrency, items.length))
    await Promise.all(Array.from({ length: n }, () => worker()))
    return results
  }

  export async function embedChunks(
    chunks: { id: number; content: string }[],
    opts: { concurrency?: number; retries?: number } = {},
  ): Promise<{ embedded: number; failed: number }> {
    const retries = opts.retries ?? DEFAULT_RETRIES
    let embedded = 0
    let failed = 0
    await mapWithConcurrency(chunks, opts.concurrency ?? DEFAULT_CONCURRENCY, async (chunk) => {
      const embedding = await embedWithRetry(chunk.content, retries)
      if (embedding) {
        await updateChunkEmbedding(chunk.id, embedding)
        embedded++
      } else {
        failed++
      }
    })
    return { embedded, failed }
  }

  export async function embedContents(
    contents: string[],
    opts: { concurrency?: number; retries?: number } = {},
  ): Promise<{ embeddings: (number[] | null)[]; embedded: number; failed: number }> {
    const retries = opts.retries ?? DEFAULT_RETRIES
    const embeddings = await mapWithConcurrency(contents, opts.concurrency ?? DEFAULT_CONCURRENCY, (content) =>
      embedWithRetry(content, retries),
    )
    const embedded = embeddings.filter(Boolean).length
    return { embeddings, embedded, failed: embeddings.length - embedded }
  }
  ```

- [ ] Re-run the test — expect PASS:
  ```
  npx vitest run tests/unit/lib/embedChunks.test.ts
  ```
  Expected: `4 passed` (runtime < 1s; the retry backoff test sleeps ≤ ~300ms with real timers).

- [ ] Run the gate — expect green. Commit:
  ```
  feat(rag): add bounded-concurrency, retrying embedChunks/embedContents helper
  ```

---

### Task 3: Extraction fidelity — ExtractionResult, 2M ceiling, vision cap 60 — [Model tier: FABLE]

**Files**
- `src/lib/fileExtraction.ts` — `MAX_TEXT_LENGTH` (line 8) → `DOCUMENT_MAX_CHARS`; `extractTextFromBuffer` (lines 55–80) → returns `ExtractionResult`; export the `ExtractionResult` interface.
- `src/lib/visionExtraction.ts` — `cfg().maxPages` default 30→60 (line 16); `extractViaVision` (lines 33–64) + `extractViaVisionImage` (lines 67–77) → return `ExtractionResult`.
- `src/app/api/extract/route.ts` — consume `.text`/`.partial` (lines 2, 21–26).
- `src/app/api/documents/web-ingest/route.ts` — `MAX_TEXT_LENGTH` → `DOCUMENT_MAX_CHARS` (lines 7, 38).
- `src/app/api/documents/process/route.ts` — **minimal** call-site updates so it compiles: consume `.text` from the three extractors (lines 6, 78–98); full metadata threading is Task 6.
- `tests/unit/lib/fileExtraction.test.ts` — update PDF-bounding tests to `DOCUMENT_MAX_CHARS` + new return shape.
- `tests/unit/lib/visionExtraction.test.ts` — update to `.text` + add page-count assertions.
- `tests/unit/api/documents-process.test.ts` — convert extractor mocks to return `ExtractionResult` (keeps the suite green; Task 6 adds new assertions).

**Interfaces**
- Produces (the canonical shape every extractor + downstream task uses — keep exact):
  ```ts
  export interface ExtractionResult {
    text: string
    pageCount: number | null
    pagesExtracted: number | null
    partial: boolean
  }
  export const DOCUMENT_MAX_CHARS = Number(process.env.DOCUMENT_MAX_CHARS) || 2_000_000
  export async function extractTextFromBuffer(buffer: Buffer, extension: string): Promise<ExtractionResult>
  export async function extractViaVision(buffer: Buffer): Promise<ExtractionResult>
  export async function extractViaVisionImage(buffer: Buffer, mimeType: string): Promise<ExtractionResult>
  ```
- Note: `unpdf`'s `extractText` returns `{ totalPages, text }` — `pageCount` for the PDF text path comes from `result.totalPages`. Vision path: `pageCount = pdf.numPages`, `pagesExtracted = min(numPages, maxPages)`.

**Steps**

- [ ] Update the failing tests FIRST. In `tests/unit/lib/fileExtraction.test.ts`, replace the "pdf text bounding" block to use `DOCUMENT_MAX_CHARS` and the new return shape (set a small env ceiling before importing so we don't build 2M chars):
  ```ts
  describe('fileExtraction — pdf text bounding + partial', () => {
    async function loadWithPdfPages(pages: string[], maxChars = 1000) {
      process.env.DOCUMENT_MAX_CHARS = String(maxChars)
      vi.resetModules()
      vi.doMock('unpdf', () => ({ extractText: async () => ({ totalPages: pages.length, text: pages }) }))
      const mod = await import('@/lib/fileExtraction')
      return mod
    }
    afterEach(() => { delete process.env.DOCUMENT_MAX_CHARS })

    it('caps at DOCUMENT_MAX_CHARS and flags partial for an over-ceiling PDF', async () => {
      const { extractTextFromBuffer, DOCUMENT_MAX_CHARS } = await loadWithPdfPages(['A'.repeat(800), 'B'.repeat(800), 'C'.repeat(800)], 1000)
      const out = await extractTextFromBuffer(Buffer.from('x'), 'pdf')
      expect(out.text.length).toBe(DOCUMENT_MAX_CHARS)
      expect(out.partial).toBe(true)
      expect(out.pageCount).toBe(3)
    })

    it('returns full text with partial false when under the ceiling', async () => {
      const { extractTextFromBuffer } = await loadWithPdfPages(['hello', 'world'], 1000)
      const out = await extractTextFromBuffer(Buffer.from('x'), 'pdf')
      expect(out.text).toBe('hello\nworld')
      expect(out.partial).toBe(false)
      expect(out.pageCount).toBe(2)
    })
  })
  ```
  Add `afterEach` to the imports: `import { describe, it, expect, vi, afterEach } from 'vitest'`. In the existing xlsx tests, change assertions to read `.text` (e.g. `const { text } = await extractTextFromBuffer(await buildXlsx(), 'xlsx'); expect(text).toContain('# Sheet: Budget')`).

- [ ] Update `tests/unit/lib/visionExtraction.test.ts`: change every `expect(out)` to `expect(out.text)`; in the cap test add page assertions:
  ```ts
  it('caps pages at EXTRACTION_MAX_PAGES and reports partial', async () => {
    process.env.EXTRACTION_MAX_PAGES = '1'
    setup('k', 5)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText.mockResolvedValue({ text: 'X' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(mockRender).toHaveBeenCalledTimes(1)
    expect(out.pageCount).toBe(5)
    expect(out.pagesExtracted).toBe(1)
    expect(out.partial).toBe(true)
    delete process.env.EXTRACTION_MAX_PAGES
  })
  ```
  In the 2-page happy path add `expect(out.partial).toBe(false)` and `expect(out.pagesExtracted).toBe(2)`. In the no-key case: `expect((await extractViaVision(Buffer.from('pdf'))).text).toBe('')`. In the image case: `const out = await extractViaVisionImage(...); expect(out.text).toBe('IMAGE TEXT'); expect(out.pageCount).toBe(1)`.

- [ ] Run both — expect FAIL (extractors still return strings):
  ```
  npx vitest run tests/unit/lib/fileExtraction.test.ts tests/unit/lib/visionExtraction.test.ts
  ```
  Expected: `FAIL … out.text is undefined` / `expected 'hello\nworld' … received undefined`.

- [ ] Edit `src/lib/fileExtraction.ts`. Replace line 8 and add the interface:
  ```ts
  export const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
  export const DOCUMENT_MAX_CHARS = Number(process.env.DOCUMENT_MAX_CHARS) || 2_000_000 // char ceiling; text past this is dropped + flagged partial

  export interface ExtractionResult {
    text: string
    pageCount: number | null
    pagesExtracted: number | null
    partial: boolean
  }
  ```
  Replace `extractTextFromBuffer` (lines 55–80) with:
  ```ts
  export async function extractTextFromBuffer(buffer: Buffer, extension: string): Promise<ExtractionResult> {
    let text = ''
    let pageCount: number | null = null
    let truncated = false
    if (extension === 'pdf') {
      const { extractText } = await import('unpdf')
      const result = await extractText(new Uint8Array(buffer))
      pageCount = typeof result.totalPages === 'number' ? result.totalPages : null
      // Accumulate page-by-page and stop at DOCUMENT_MAX_CHARS so a huge PDF can't build a
      // multi-megabyte string on top of the ≤200MB buffer already in memory.
      const pages = Array.isArray(result.text) ? result.text : [String(result.text)]
      for (let i = 0; i < pages.length; i++) {
        text += (text ? '\n' : '') + pages[i]
        if (text.length >= DOCUMENT_MAX_CHARS) {
          // Broke on the cap: partial if we overshot OR there are still pages left. This catches
          // the exact-boundary case (text lands on the cap with more pages) that a bare
          // `length > MAX` check would silently drop — no silent loss.
          truncated = text.length > DOCUMENT_MAX_CHARS || i < pages.length - 1
          break
        }
      }
    } else if (extension === 'docx') {
      const mammoth = await import('mammoth')
      text = (await mammoth.extractRawText({ buffer })).value
    } else if (extension === 'xlsx') {
      text = await extractTextFromXlsx(buffer)
    } else {
      text = buffer.toString('utf-8')
    }
    if (text.length > DOCUMENT_MAX_CHARS) { text = text.slice(0, DOCUMENT_MAX_CHARS); truncated = true }
    // Text path partial = char-truncation only; it doesn't page-cap, so pagesExtracted stays null.
    return { text, pageCount, pagesExtracted: null, partial: truncated }
  }
  ```

- [ ] Edit `src/lib/visionExtraction.ts`. Bump the default (line 16): `maxPages: num(process.env.EXTRACTION_MAX_PAGES, 60),`. Add `import type { ExtractionResult } from './fileExtraction'` at the top. Change `extractViaVision` to build and return the result:
  ```ts
  /** Render each PDF page and vision-extract it. Best-effort; empty result if no key. */
  export async function extractViaVision(buffer: Buffer): Promise<ExtractionResult> {
    const apiKey = await getGeminiApiKey()
    if (!apiKey) return { text: '', pageCount: null, pagesExtracted: null, partial: false }
    const { model, maxPages, scale, maxOutputTokens } = cfg()
    const { definePDFJSModule, getDocumentProxy, renderPageAsImage } = await import('unpdf')
    await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
    const source = new Uint8Array(buffer)
    const pdf = await getDocumentProxy(new Uint8Array(source))
    try {
      const pageCount = pdf.numPages
      const total = Math.min(pageCount, maxPages)
      if (pageCount > maxPages) console.warn(`[visionExtraction] capping at ${maxPages}/${pageCount} pages`)
      const parts: string[] = []
      for (let page = 1; page <= total; page++) {
        try {
          const ab = await renderPageAsImage(new Uint8Array(source), page, { canvasImport: () => import('@napi-rs/canvas'), scale })
          const text = await extractImage(new Uint8Array(ab), model, maxOutputTokens, apiKey)
          if (text) parts.push(`# Page ${page}\n${text}`)
        } catch (err) {
          console.warn(`[visionExtraction] page ${page} failed:`, err instanceof Error ? err.message : err)
        }
      }
      return { text: parts.join('\n\n'), pageCount, pagesExtracted: total, partial: total < pageCount }
    } finally {
      await pdf.destroy?.()
    }
  }
  ```
  Change `extractViaVisionImage` to return the result:
  ```ts
  export async function extractViaVisionImage(buffer: Buffer, _mimeType: string): Promise<ExtractionResult> {
    const apiKey = await getGeminiApiKey()
    if (!apiKey) return { text: '', pageCount: 1, pagesExtracted: 1, partial: false }
    const { model, maxOutputTokens } = cfg()
    try {
      const text = await extractImage(new Uint8Array(buffer), model, maxOutputTokens, apiKey)
      return { text, pageCount: 1, pagesExtracted: 1, partial: false }
    } catch (err) {
      console.warn('[visionExtraction] image failed:', err instanceof Error ? err.message : err)
      return { text: '', pageCount: 1, pagesExtracted: 1, partial: false }
    }
  }
  ```

- [ ] Update `src/app/api/extract/route.ts` (consume the new shape; drop the manual `MAX_TEXT_LENGTH` slice — the extractor already caps):
  ```ts
  import { getExtension, validateUploadedFile, extractTextFromBuffer } from '@/lib/fileExtraction'
  // …
  const ext = getExtension(file.name)
  const buffer = Buffer.from(await file.arrayBuffer())
  const { text: textContent, partial } = await extractTextFromBuffer(buffer, ext)
  return NextResponse.json({
    filename: file.name, mimeType: file.type, textContent,
    charCount: textContent.length, truncated: partial,
  })
  ```

- [ ] Update `src/app/api/documents/web-ingest/route.ts`: import (line 7) `import { DOCUMENT_MAX_CHARS } from '@/lib/fileExtraction'` and line 38 `if (text.length > DOCUMENT_MAX_CHARS) text = text.slice(0, DOCUMENT_MAX_CHARS)`.

- [ ] Update `src/app/api/documents/process/route.ts` **minimally** to compile against the new signatures (full threading is Task 6). Line 6 import: swap `MAX_TEXT_LENGTH` for `DOCUMENT_MAX_CHARS`. In the extract block (lines 76–99), consume `.text`:
  ```ts
  if (isImage) {
    const r = await extractViaVisionImage(buffer, effMimeType)
    textContent = r.text
    extractionMethod = 'vision'
  } else {
    const r = await extractTextFromBuffer(buffer, ext)
    textContent = r.text
    if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
      const v = await extractViaVision(buffer)
      if (v.text.trim().length > textContent.trim().length) {
        textContent = v.text
        extractionMethod = 'vision'
      }
    }
  }
  ```
  And line 96: `if (textContent.length > DOCUMENT_MAX_CHARS) { … textContent = textContent.slice(0, DOCUMENT_MAX_CHARS) }` (keep the vision-path safety cap; the text path is already capped).

- [ ] Update `tests/unit/api/documents-process.test.ts` extractor mocks to return `ExtractionResult` (mechanical; keeps the suite green). Add a helper near the top of the describe and convert `mockResolvedValue`s:
  ```ts
  const extRes = (text: string, extra: Partial<{ pageCount: number | null; pagesExtracted: number | null; partial: boolean }> = {}) =>
    ({ text, pageCount: null, pagesExtracted: null, partial: false, ...extra })
  ```
  In `beforeEach`: `m.extractViaVision.mockResolvedValue(extRes(''))` and `m.extractViaVisionImage.mockResolvedValue(extRes(''))`. In each test replace `m.extractTextFromBuffer.mockResolvedValue('A'.repeat(300))` → `m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300)))`, `m.extractViaVision.mockResolvedValue('V'.repeat(300))` → `extRes('V'.repeat(300))`, `m.extractViaVisionImage.mockResolvedValue('image text here')` → `extRes('image text here')`. Leave the `mockRejectedValue`/empty-`''` cases as `extRes('')` or the reject as-is (`m.extractTextFromBuffer.mockRejectedValue(...)` unchanged).

- [ ] Run the touched suites — expect PASS:
  ```
  npx vitest run tests/unit/lib/fileExtraction.test.ts tests/unit/lib/visionExtraction.test.ts tests/unit/api/documents-process.test.ts
  ```
  Expected: all green.

- [ ] Run the gate — expect green (typecheck confirms every caller consumes `.text`). Commit:
  ```
  feat(rag): return ExtractionResult from extractors, raise ceiling to 2M and vision cap to 60
  ```

---

### Task 4: actions persistence — page fields in updateDocumentStatus + commitDocumentReplacement — [Model tier: SONNET]

**Files**
- `src/app/actions.ts` — `updateDocumentStatus` (lines 470–479) `updates` param; `commitDocumentReplacement` (lines 550–585) `meta` param + `.set(...)`.
- `tests/unit/actions/document-fidelity.test.ts` — NEW (mirror `tests/unit/actions/document-reversioning.test.ts`).

**Interfaces**
- Consumes: migration 0014 columns (Task 1).
- Produces:
  ```ts
  updateDocumentStatus(id, status, updates?: {
    chunkCount?: number; errorMessage?: string; charCount?: number; thumbnailPath?: string;
    extractionMethod?: 'text' | 'vision';
    pageCount?: number | null; pagesExtracted?: number | null; extractionPartial?: boolean
  })
  // commitDocumentReplacement meta gains: pageCount?, pagesExtracted?, extractionPartial?
  ```

**Steps**

- [ ] Write the failing test FIRST. Create `tests/unit/actions/document-fidelity.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest'
  import { createTestDb, testDb } from '../../helpers/test-db'

  vi.mock('@/db', () => ({ get db() { return testDb } }))

  describe('document fidelity persistence', () => {
    beforeEach(async () => { await createTestDb() })

    it('updateDocumentStatus persists page_count, pages_extracted, extraction_partial', async () => {
      const a = await import('@/app/actions')
      const [p] = await a.createProject('Fidelity')
      const [doc] = await a.createUploadingDocument({ projectId: p.id, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 100 })
      await a.updateDocumentStatus(doc.id, 'ready', {
        chunkCount: 3, charCount: 5000, extractionMethod: 'vision',
        pageCount: 80, pagesExtracted: 60, extractionPartial: true,
      })
      const after = await a.getDocumentById(doc.id)
      expect(after!.pageCount).toBe(80)
      expect(after!.pagesExtracted).toBe(60)
      expect(after!.extractionPartial).toBe(true)
    })

    it('commitDocumentReplacement persists the fidelity fields on the swapped row', async () => {
      const a = await import('@/app/actions')
      const [p] = await a.createProject('FidelityR')
      const [doc] = await a.createUploadingDocument({ projectId: p.id, filename: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 })
      await a.commitDocumentReplacement(doc.id, p.id,
        [{ chunkIndex: 0, content: 'x', embedding: null }],
        {
          filename: 'b.pdf', mimeType: 'application/pdf', fileSize: 20, storagePath: 'documents/x/1/rev2/b.pdf',
          thumbnailPath: null, charCount: 30, chunkCount: 1, extractionMethod: 'text', revision: 2, status: 'ready',
          pageCount: 40, pagesExtracted: 25, extractionPartial: true,
        })
      const after = await a.getDocumentById(doc.id)
      expect(after!.pageCount).toBe(40)
      expect(after!.pagesExtracted).toBe(25)
      expect(after!.extractionPartial).toBe(true)
    })
  })
  ```

- [ ] Run it — expect FAIL (params don't accept the fields; typecheck/`.set` ignores them → assertions see null):
  ```
  npx vitest run tests/unit/actions/document-fidelity.test.ts
  ```
  Expected: `FAIL … expected null to be 80` (and a TS error on the extra `meta` keys).

- [ ] Edit `src/app/actions.ts` `updateDocumentStatus` `updates` type (line 473) — add the three optional fields:
  ```ts
  updates?: { chunkCount?: number; errorMessage?: string; charCount?: number; thumbnailPath?: string; extractionMethod?: 'text' | 'vision'; pageCount?: number | null; pagesExtracted?: number | null; extractionPartial?: boolean }
  ```
  The existing `.set({ status, ...updates, updatedAt: new Date() })` already spreads them — no body change.

- [ ] Edit `commitDocumentReplacement` `meta` type (after `errorMessage?`) — add:
  ```ts
  pageCount?: number | null
  pagesExtracted?: number | null
  extractionPartial?: boolean
  ```
  In the `tx.update(documents).set({...})` block (lines 576–582), add:
  ```ts
  pageCount: meta.pageCount ?? null, pagesExtracted: meta.pagesExtracted ?? null,
  extractionPartial: meta.extractionPartial ?? false,
  ```

- [ ] Re-run the test — expect PASS:
  ```
  npx vitest run tests/unit/actions/document-fidelity.test.ts
  ```
  Expected: `2 passed`.

- [ ] Run the gate — expect green. Commit:
  ```
  feat(actions): persist page_count/pages_extracted/extraction_partial in document writes
  ```

---

### Task 5: ingest.ts rewire — embedChunks + partial threading — [Model tier: FABLE]

**Files**
- `src/lib/ingest.ts` — replace the `Promise.allSettled` loop (lines 17–29) with `embedChunks`; extend `opts`; thread partial + page fields.
- `tests/unit/lib/ingest.test.ts` — NEW.

**Interfaces**
- Consumes: `embedChunks(saved: { id; content }[]) => { embedded; failed }` (Task 2); `updateDocumentStatus(..., { pageCount?, pagesExtracted?, extractionPartial? })` (Task 4).
- Produces:
  ```ts
  export async function ingestText(
    doc: { id: number; projectId: number },
    textContent: string,
    opts: { extractionMethod: 'text' | 'vision'; thumbnailPath?: string; pageCount?: number | null; pagesExtracted?: number | null; partial?: boolean },
  ): Promise<{ status: 'ready' | 'error'; chunkCount: number }>
  ```

**Steps**

- [ ] Write the failing test FIRST. Create `tests/unit/lib/ingest.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const mockSaveDocumentChunks = vi.fn()
  const mockUpdateDocumentStatus = vi.fn()
  const mockChunkText = vi.fn()
  const mockEmbedChunks = vi.fn()

  async function load() {
    vi.resetModules()
    vi.doMock('@/app/actions', () => ({
      saveDocumentChunks: mockSaveDocumentChunks,
      updateChunkEmbedding: vi.fn(),
      updateDocumentStatus: mockUpdateDocumentStatus,
    }))
    vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: vi.fn() }))
    vi.doMock('@/lib/chunking', () => ({ chunkText: mockChunkText }))
    vi.doMock('@/lib/embedChunks', () => ({ embedChunks: mockEmbedChunks }))
    return await import('@/lib/ingest')
  }

  describe('ingestText', () => {
    beforeEach(() => {
      [mockSaveDocumentChunks, mockUpdateDocumentStatus, mockChunkText, mockEmbedChunks].forEach(f => f.mockReset())
      mockChunkText.mockReturnValue([{ index: 0, content: 'a' }, { index: 1, content: 'b' }, { index: 2, content: 'c' }])
      mockSaveDocumentChunks.mockResolvedValue([{ id: 1, content: 'a' }, { id: 2, content: 'b' }, { id: 3, content: 'c' }])
      mockUpdateDocumentStatus.mockResolvedValue(undefined)
    })

    it('flags extraction_partial when some embeds fail, and persists page fields', async () => {
      mockEmbedChunks.mockResolvedValue({ embedded: 2, failed: 1 })
      const { ingestText } = await load()
      const res = await ingestText({ id: 7, projectId: 1 }, 'text', { extractionMethod: 'text', pageCount: 10, pagesExtracted: 10, partial: false })
      expect(res.status).toBe('ready')
      expect(mockUpdateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({
        chunkCount: 3, extractionPartial: true, pageCount: 10, pagesExtracted: 10,
      }))
    })

    it('propagates opts.partial even when all embeds succeed', async () => {
      mockEmbedChunks.mockResolvedValue({ embedded: 3, failed: 0 })
      const { ingestText } = await load()
      await ingestText({ id: 8, projectId: 1 }, 'text', { extractionMethod: 'vision', pageCount: 80, pagesExtracted: 60, partial: true })
      expect(mockUpdateDocumentStatus).toHaveBeenCalledWith(8, 'ready', expect.objectContaining({ extractionPartial: true }))
    })

    it('status error when zero chunks embed', async () => {
      mockEmbedChunks.mockResolvedValue({ embedded: 0, failed: 3 })
      const { ingestText } = await load()
      const res = await ingestText({ id: 9, projectId: 1 }, 'text', { extractionMethod: 'text' })
      expect(res.status).toBe('error')
    })
  })
  ```

- [ ] Run it — expect FAIL (`embedChunks` not wired; `extractionPartial` absent):
  ```
  npx vitest run tests/unit/lib/ingest.test.ts
  ```
  Expected: `FAIL … number of calls: 0` / objectContaining mismatch (no `extractionPartial`).

- [ ] Rewrite `src/lib/ingest.ts`:
  ```ts
  // Shared post-extraction tail: chunk → save → embed → status. Used by the file
  // upload pipeline (documents/process) and web ingestion (documents/web-ingest).
  import { saveDocumentChunks, updateDocumentStatus } from '@/app/actions'
  import { chunkText } from '@/lib/chunking'
  import { embedChunks } from '@/lib/embedChunks'

  export async function ingestText(
    doc: { id: number; projectId: number },
    textContent: string,
    opts: { extractionMethod: 'text' | 'vision'; thumbnailPath?: string; pageCount?: number | null; pagesExtracted?: number | null; partial?: boolean },
  ): Promise<{ status: 'ready' | 'error'; chunkCount: number }> {
    const textChunks = chunkText(textContent)
    const saved = await saveDocumentChunks(textChunks.map(c => ({
      documentId: doc.id, projectId: doc.projectId, chunkIndex: c.index, content: c.content,
    })))
    const { embedded, failed } = await embedChunks(saved)
    if (failed > 0) console.warn(`[ingest] ${failed}/${saved.length} chunks failed to embed`)
    const status: 'ready' | 'error' = embedded === 0 && saved.length > 0 ? 'error' : 'ready'
    // A partial extraction (char-truncation / page-capping) OR any post-retry embed failure
    // is a fidelity hole — surface it, never hide it.
    const extractionPartial = Boolean(opts.partial) || failed > 0
    await updateDocumentStatus(doc.id, status, {
      chunkCount: saved.length, charCount: textContent.length,
      thumbnailPath: opts.thumbnailPath, extractionMethod: opts.extractionMethod,
      pageCount: opts.pageCount ?? null, pagesExtracted: opts.pagesExtracted ?? null,
      extractionPartial,
    })
    return { status, chunkCount: saved.length }
  }
  ```
  Note: `saveDocumentChunks` returns rows shaped `{ id, content, … }`, which satisfies `embedChunks`'s `{ id; content }[]` input.

- [ ] Re-run the test — expect PASS:
  ```
  npx vitest run tests/unit/lib/ingest.test.ts
  ```
  Expected: `3 passed`.

- [ ] Run the gate — expect green. Commit:
  ```
  feat(rag): rewire ingestText onto embedChunks and thread partial/page fields
  ```

---

### Task 6: process route — thread ExtractionResult, embedContents on replace, extracted.txt — [Model tier: OPUS]

**Files**
- `src/app/api/documents/process/route.ts` — capture full `ExtractionResult`; new-upload path passes page/partial into `ingestText`; replace path uses `embedContents` + threads fields into `commitDocumentReplacement`; upload `extracted.txt` best-effort.
- `src/app/api/documents/route.ts` — DELETE handler: add derived `extracted.txt` paths to the storage sweep.
- `tests/unit/api/documents-process.test.ts` — add assertions (extracted.txt upload; partial threading); mock `@/lib/embedChunks`.

**Interfaces**
- Consumes: `extractTextFromBuffer/extractViaVision/extractViaVisionImage => ExtractionResult` (Task 3); `ingestText(..., { pageCount, pagesExtracted, partial })` (Task 5); `embedContents(contents) => { embeddings, embedded, failed }` (Task 2); `commitDocumentReplacement(..., { pageCount, pagesExtracted, extractionPartial })` (Task 4); `uploadBuffer(path, Buffer, contentType)` (`@/lib/storage`).

**Steps**

- [ ] Extend the test FIRST. In `tests/unit/api/documents-process.test.ts`, add `embedContents` to the mock module and the doMock, and add assertions. Add to `importRoute`:
  ```ts
  vi.doMock('@/lib/embedChunks', () => ({
    embedChunks: vi.fn(async (chunks: { id: number }[]) => ({ embedded: chunks.length, failed: 0 })),
    embedContents: vi.fn(async (contents: string[]) => ({ embeddings: contents.map(() => new Array(768).fill(0.1)), embedded: contents.length, failed: 0 })),
  }))
  ```
  Add tests:
  ```ts
  it('uploads the full extracted text as extracted.txt (best-effort)', async () => {
    m.getDocumentById.mockResolvedValue({ id: 30, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'documents/1/30/doc.pdf' })
    m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300)))
    const POST = await importRoute()
    await POST(req(30) as never)
    expect(m.uploadBuffer).toHaveBeenCalledWith(expect.stringContaining('extracted.txt'), expect.any(Buffer), 'text/plain')
  })

  it('threads vision page-cap partial into the status write', async () => {
    m.getDocumentById.mockResolvedValue({ id: 31, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue(extRes(''))
    m.extractViaVision.mockResolvedValue(extRes('V'.repeat(300), { pageCount: 80, pagesExtracted: 60, partial: true }))
    const POST = await importRoute()
    await POST(req(31) as never)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(31, 'ready', expect.objectContaining({
      pageCount: 80, pagesExtracted: 60, extractionPartial: true,
    }))
  })

  it('replace path threads fidelity fields into commitDocumentReplacement', async () => {
    m.getDocumentById.mockResolvedValue({ id: 32, projectId: 1, revision: 1, filename: 'old.pdf', mimeType: 'application/pdf', fileSize: 5, storagePath: 'documents/1/32/old.pdf', thumbnailPath: null, charCount: 10, chunkCount: 1, extractionMethod: 'text' })
    m.extractTextFromBuffer.mockResolvedValue(extRes('A'.repeat(300), { pageCount: 12, pagesExtracted: null, partial: false }))
    m.createDocumentRevision.mockResolvedValue([{ id: 1 }])
    m.commitDocumentReplacement.mockResolvedValue(undefined)
    const POST = await importRoute()
    await POST(new Request('http://localhost/api/documents/process', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 32, filename: 'new.pdf', mimeType: 'application/pdf', fileSize: 9 }),
    }) as never)
    expect(m.commitDocumentReplacement).toHaveBeenCalledWith(32, 1, expect.any(Array), expect.objectContaining({
      pageCount: 12, extractionPartial: false,
    }))
  })
  ```
  Note: the two existing replace-path tests still mock `generateEmbedding`; since the replace path now uses `embedContents` (mocked above), the "all embeddings fail → error" test must set the `embedContents` mock to fail for that case. Update that test to override: `const ec = await import('@/lib/embedChunks')` is not accessible — instead extend the `vi.doMock('@/lib/embedChunks', …)` factory to read a mutable flag, OR simpler: in that specific test, re-mock. Cleanest: hoist an `embedContentsImpl` var the factory calls, and set it per-test. Wire the doMock as:
  ```ts
  m.embedContents = vi.fn()
  // in importRoute doMock: embedContents: m.embedContents
  // in beforeEach: m.embedContents.mockImplementation(async (contents: string[]) => ({ embeddings: contents.map(() => new Array(768).fill(0.1)), embedded: contents.length, failed: 0 }))
  ```
  Then the existing "all embeddings fail" replace test sets `m.embedContents.mockResolvedValue({ embeddings: [null], embedded: 0, failed: 1 })` and still expects `status: 'error'`. Add `embedContents: vi.fn()` and `embedChunks: vi.fn()` to the `m` object; add both to the `@/lib/embedChunks` doMock.

- [ ] Run the process suite — expect FAIL (extracted.txt not uploaded; fields not threaded; replace still calls `generateEmbedding`):
  ```
  npx vitest run tests/unit/api/documents-process.test.ts
  ```
  Expected: `FAIL … uploadBuffer … extracted.txt … number of calls: 0` and objectContaining mismatches.

- [ ] Edit `src/app/api/documents/process/route.ts`. Imports (line 5–6): add `embedContents` and `ExtractionResult`, drop the now-unused `generateEmbedding`/`chunkText` from the replace path if no longer referenced:
  ```ts
  import { ingestText } from '@/lib/ingest'
  import { chunkText } from '@/lib/chunking'
  import { embedContents } from '@/lib/embedChunks'
  import { DOCUMENT_MAX_CHARS, getExtension, isImageExtension, isSupported, extractTextFromBuffer, MAX_FILE_SIZE } from '@/lib/fileExtraction'
  import type { ExtractionResult } from '@/lib/fileExtraction'
  ```
  (Keep `generateEmbedding`/`ensureEmbeddingModel` import only if still used — `ensureEmbeddingModel` stays; `generateEmbedding` is now unused, remove it.)

  Rework the extract block to keep the full result:
  ```ts
  let textContent = ''
  let extractionMethod: 'text' | 'vision' = 'text'
  let extraction: ExtractionResult = { text: '', pageCount: null, pagesExtracted: null, partial: false }
  try {
    if (isImage) {
      extraction = await extractViaVisionImage(buffer, effMimeType)
      textContent = extraction.text
      extractionMethod = 'vision'
    } else {
      extraction = await extractTextFromBuffer(buffer, ext)
      textContent = extraction.text
      if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
        const v = await extractViaVision(buffer)
        if (v.text.trim().length > textContent.trim().length) {
          extraction = v
          textContent = v.text
          extractionMethod = 'vision'
        }
      }
    }
  } catch (e) {
    await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Failed to extract document content.' })
    return apiError(e, 'Failed to extract document content', 500, false)
  }
  if (textContent.length > DOCUMENT_MAX_CHARS) {
    console.warn(`[documents/process] ${doc.filename}: content truncated ${textContent.length} -> ${DOCUMENT_MAX_CHARS}`)
    textContent = textContent.slice(0, DOCUMENT_MAX_CHARS)
    extraction = { ...extraction, partial: true }
  }
  if (!textContent.trim()) { /* unchanged empty-content error */ }
  ```

  After the thumbnail block, before the `isReplace` branch, add the best-effort `extracted.txt` upload:
  ```ts
  // Persist the FULL extracted text as a faithful artifact (also Phase 2's whole-doc input).
  // Best-effort: chunks are the retrieval path, so a failure here never fails ingestion.
  try {
    const extractedTxtPath = `documents/${doc.projectId}/${doc.id}/${isReplace ? `rev${nextRevision}/` : ''}extracted.txt`
    await uploadBuffer(extractedTxtPath, Buffer.from(textContent, 'utf-8'), 'text/plain')
  } catch (e) {
    console.warn('[documents/process] extracted.txt upload failed:', e instanceof Error ? e.message : e)
  }
  ```

  Replace path — swap the ad-hoc `Promise.allSettled(map(generateEmbedding))` for `embedContents`:
  ```ts
  if (isReplace) {
    const textChunks = chunkText(textContent)
    const { embeddings, embedded, failed } = await embedContents(textChunks.map(c => c.content))
    const chunkRows = textChunks.map((c, i) => ({ chunkIndex: c.index, content: c.content, embedding: embeddings[i] }))
    if (failed > 0) console.warn(`[documents/process] ${failed}/${textChunks.length} chunks failed to embed`)
    const status: 'ready' | 'error' = embedded === 0 && textChunks.length > 0 ? 'error' : 'ready'
    const extractionPartial = extraction.partial || failed > 0

    await createDocumentRevision({ /* unchanged snapshot of doc.revision */ })
    await commitDocumentReplacement(doc.id, doc.projectId, chunkRows, {
      filename: effFilename, mimeType: effMimeType, fileSize: effFileSize, storagePath: sourcePath,
      thumbnailPath, charCount: textContent.length, chunkCount: chunkRows.length, extractionMethod,
      revision: nextRevision, status,
      errorMessage: status === 'error' ? 'New revision saved but embeddings failed.' : null,
      pageCount: extraction.pageCount, pagesExtracted: extraction.pagesExtracted, extractionPartial,
    })
    return NextResponse.json({ documentId: doc.id, status, revision: nextRevision, chunkCount: chunkRows.length, charCount: textContent.length })
  }
  ```

  New-upload path — pass page/partial into `ingestText`:
  ```ts
  const { status, chunkCount } = await ingestText(
    { id: doc.id, projectId: doc.projectId }, textContent,
    { extractionMethod, thumbnailPath, pageCount: extraction.pageCount, pagesExtracted: extraction.pagesExtracted, partial: extraction.partial },
  )
  ```

- [ ] Edit `src/app/api/documents/route.ts` DELETE handler — add derived `extracted.txt` paths to the sweep (best-effort; `removeObjects` tolerates absent keys). In the `if (doc)` block, extend `paths`:
  ```ts
  const extractedTxtPaths = [
    `documents/${doc.projectId}/${doc.id}/extracted.txt`,
    ...revisions.map(r => `documents/${r.projectId}/${doc.id}/rev${r.revision}/extracted.txt`),
  ]
  const paths = [
    doc.storagePath, doc.thumbnailPath,
    ...revisions.flatMap(r => [r.storagePath, r.thumbnailPath]),
    ...extractedTxtPaths,
  ].filter((p): p is string => Boolean(p))
  ```

- [ ] Re-run the process suite — expect PASS:
  ```
  npx vitest run tests/unit/api/documents-process.test.ts
  ```
  Expected: all green (existing + 3 new).

- [ ] Run the gate — expect green. Commit:
  ```
  feat(rag): thread extraction fidelity through process route, store extracted.txt, bound replace embeds
  ```

---

### Task 7: API + types + UI — DocumentSummary, GET, Partial badge — [Model tier: SONNET]

**Files**
- `src/types.ts` — `DocumentSummary` (lines 10–23) add three optional fields.
- `src/app/api/documents/route.ts` — GET (lines 23–27): `...d` already spreads the Drizzle-mapped `pageCount`/`pagesExtracted`/`extractionPartial` from `getProjectDocuments`; confirm via test (no code change needed).
- `src/components/chat/DocumentCard.tsx` — amber Partial badge beside the `vision` chip (lines 63–66).
- `src/components/ui/DocumentPreviewDialog.tsx` — Partial notice under the Meta row (after line 78).
- `tests/hooks/DocumentCard.test.tsx` — add Partial-badge cases.

**Interfaces**
- Produces: `DocumentSummary` gains `pageCount?: number | null; pagesExtracted?: number | null; extractionPartial?: boolean`.
- UI tooltip rule (guard nulls so `null < n` never leaks a bogus "Extracted null of N"): show **"Extracted {pagesExtracted} of {pageCount} pages"** only when `pagesExtracted != null && pageCount != null && pagesExtracted < pageCount`; otherwise **"Partial extraction — some content may be missing"**.

**Steps**

- [ ] Extend the failing test FIRST. In `tests/hooks/DocumentCard.test.tsx` add:
  ```ts
  it('renders an amber Partial badge with a page-count tooltip when extractionPartial', () => {
    render(<DocumentCard doc={{ ...base, extractionPartial: true, pagesExtracted: 60, pageCount: 80 }} onOpen={() => {}} onDelete={() => {}} />)
    const badge = screen.getByText(/partial/i)
    expect(badge).toBeTruthy()
    expect(badge.closest('[title]')?.getAttribute('title')).toBe('Extracted 60 of 80 pages')
  })

  it('uses the generic Partial tooltip when page counts are unknown', () => {
    render(<DocumentCard doc={{ ...base, extractionPartial: true }} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.getByText(/partial/i).closest('[title]')?.getAttribute('title')).toMatch(/some content may be missing/i)
  })

  it('shows no Partial badge when extractionPartial is falsy', () => {
    render(<DocumentCard doc={base} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.queryByText(/partial/i)).toBeNull()
  })
  ```

- [ ] Run it — expect FAIL (`extractionPartial` not on the type; badge not rendered):
  ```
  npx vitest run tests/hooks/DocumentCard.test.tsx
  ```
  Expected: `FAIL … Unable to find an element with the text: /partial/i` (plus a TS error on the extra doc props).

- [ ] Edit `src/types.ts` `DocumentSummary` — add before `revision`:
  ```ts
  extractionMethod: 'text' | 'vision' | null
  pageCount?: number | null
  pagesExtracted?: number | null
  extractionPartial?: boolean
  revision: number
  ```

- [ ] Edit `src/components/chat/DocumentCard.tsx`. Add `AlertTriangle` to the lucide import (line 3). Insert the badge right after the `vision` chip block (after line 65), before the `ml-auto` size span:
  ```tsx
  {doc.extractionPartial && (
    <span
      className="flex items-center gap-0.5 text-[10px] text-amber-500"
      title={doc.pagesExtracted != null && doc.pageCount != null && doc.pagesExtracted < doc.pageCount
        ? `Extracted ${doc.pagesExtracted} of ${doc.pageCount} pages`
        : 'Partial extraction — some content may be missing'}
    >
      <AlertTriangle className="h-2.5 w-2.5" />Partial
    </span>
  )}
  ```

- [ ] Edit `src/components/ui/DocumentPreviewDialog.tsx`. After the Meta `<div>` (line 78), add the notice:
  ```tsx
  {doc.extractionPartial && (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      {doc.pagesExtracted != null && doc.pageCount != null && doc.pagesExtracted < doc.pageCount
        ? `Partial extraction — extracted ${doc.pagesExtracted} of ${doc.pageCount} pages. Some content may be missing.`
        : 'Partial extraction — some content may be missing.'}
    </div>
  )}
  ```

- [ ] Confirm the GET route surfaces the fields. `getProjectDocuments` does `db.select().from(documents)`, so each `d` already carries `pageCount`/`pagesExtracted`/`extractionPartial` (Drizzle camelCase), and the GET's `{ ...d, url, thumbnailUrl }` spreads them — no code change. Optionally add a passthrough assertion to `tests/unit/api/documents-route.test.ts` by including `extractionPartial: true` in a mocked `getProjectDocuments` row and asserting `data.documents[0].extractionPartial === true`.

- [ ] Re-run the touched tests — expect PASS:
  ```
  npx vitest run tests/hooks/DocumentCard.test.tsx tests/unit/api/documents-route.test.ts
  ```
  Expected: all green.

- [ ] Run the gate — expect green. Commit:
  ```
  feat(ui): surface extraction_partial with an amber Partial badge and preview notice
  ```

---

### Task 8: Gate + release — [Model tier: FABLE]

**Files**
- `CHANGELOG.md` — new `## [4.44.0]` entry at the top (below the header, above `[4.43.0]`).
- `package.json` — version bump happens via `npm version` in the (user-gated) release checklist, not here.

**Interfaces**
- Consumes: all prior tasks. Produces: a green full gate + a documented, user-gated release runbook. **Does NOT execute the release.**

**Steps**

- [ ] Run the full verification gate and capture output:
  ```
  npm run typecheck && npm run lint && npm run build && npm test
  ```
  Expected: typecheck 0 errors; lint 0 errors (baseline warnings OK); build succeeds; Vitest all-pass including `migration-0014`, `embedChunks`, `ingest`, `document-fidelity`, updated `fileExtraction`/`visionExtraction`/`documents-process`, `DocumentCard`.

- [ ] Add the CHANGELOG entry (match the existing voice/format):
  ```markdown
  ## [4.44.0] - 2026-07-07 — RAG Phase 1: ingestion reliability & fidelity

  Phase 1 of the RAG overhaul. Kills three silent-loss bugs in document ingestion and makes fidelity visible — every document now ends complete, explicitly partial, or error.

  ### Fixed

  - **No more silent 100K truncation.** `MAX_TEXT_LENGTH` (100K) → `DOCUMENT_MAX_CHARS` (default 2,000,000, env-configurable). Long contracts/plans now ingest in full; text past the ceiling is dropped *and flagged partial*, never silently.
  - **No more silent embedding loss.** New bounded-concurrency + retry/backoff embedder (`embedChunks`/`embedContents`, `EMBED_CONCURRENCY=5`, `EMBED_MAX_RETRIES=3`) shared by the new-upload and replace paths — hundreds of chunks no longer 429 Gemini into null embeddings.
  - **No more silent 30-page vision cap.** `EXTRACTION_MAX_PAGES` default 30 → 60; over-cap scanned PDFs are flagged partial with the extracted/total page counts.

  ### Added

  - **Full extracted text stored** as `documents/<proj>/<id>[/rev<N>]/extracted.txt` (best-effort; also Phase 2's whole-document input).
  - **Fidelity schema (migration 0014):** `page_count`, `pages_extracted`, `extraction_partial` on `documents`.
  - **Amber "Partial" badge** + tooltip on `DocumentCard` and a notice in the preview dialog when extraction was truncated, page-capped, or some chunks failed to embed.

  ### Notes

  - No backfill: existing (already-truncated) documents keep `extraction_partial = false`; re-upload for full fidelity. Vision pages stay serial (memory-safe). Migration 0014 must be applied to live Supabase (see release checklist).
  ```

- [ ] Re-run `npm test` after the CHANGELOG edit (docs-only, but keep the gate honest) — expect green.

- [ ] Commit:
  ```
  docs(changelog): add 4.44.0 RAG phase 1 ingestion fidelity entry
  ```

- [ ] Document the **user-gated release checklist** (do NOT execute — hand to the user):
  1. `git checkout master && git merge --no-ff feat/rag-phase1-ingestion` (bring the branch in).
  2. `npm version minor` → bumps `package.json` to `4.44.0`, creates the `v4.44.0` tag.
  3. `git push origin master --follow-tags` (triggers Vercel prod deploy + CI: lint/typecheck/build/vitest/`drizzle-kit migrate`/playwright).
  4. `gh release create v4.44.0 --title "v4.44.0 — RAG Phase 1: ingestion reliability & fidelity" --notes-from-tag` (or paste the CHANGELOG section).
  5. **Apply migration 0014 to live Supabase** (env changes/migrations don't auto-apply):
     ```
     DIRECT_URL=<supabase direct :5432 URL> npx drizzle-kit migrate
     ```
  6. Re-check: upload a > 100K-char contract in prod → confirm chunk count reflects the full doc, all chunks embed, `extracted.txt` exists in Storage, and a genuinely over-cap scanned PDF shows the amber **Partial** badge with "Extracted N of M pages".
  7. (Optional) tune `DOCUMENT_MAX_CHARS` / `EXTRACTION_MAX_PAGES` / `EMBED_CONCURRENCY` in Vercel env, then redeploy to pick up.
