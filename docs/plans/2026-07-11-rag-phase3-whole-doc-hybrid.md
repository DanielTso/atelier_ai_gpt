# RAG Phase 3 — Whole-Document Mode + Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix set-wide questions ("list every storm sheet") with a Claude-driven `read_document` tool over persisted `extracted.txt`, and fix identifier misses ("SW-101") with FTS + pg_trgm keyword search RRF-fused into the existing vector pipeline — plus failed-page tracking, chunk provenance tags, and a "Reading documents…" stage.

**Architecture:** One new Drizzle migration pair (generated `failed_pages` + custom pg_trgm/tsvector/GIN). New pure libs (`windowing`, `rrf`, `keywordSearch`) each unit-tested in isolation; `retrieval.ts` gains a fusion step; `/api/chat` gains the tool + document manifest. Everything degrades best-effort like the existing pipeline.

**Tech Stack:** Next.js 16, Drizzle/postgres-js, Supabase Postgres (pgvector + pg_trgm), AI SDK v6 tools, PGlite tests (Vitest).

**Spec:** `docs/specs/2026-07-11-rag-phase3-whole-doc-hybrid-design.md` (approved 2026-07-11).

## Global Constraints

- Code style: single-quote, no-semicolon in `src/lib/*` new files; **match the surrounding file** where editing (e.g. `src/app/api/chat/route.ts` uses semicolons). NEVER run Prettier.
- Test command (full suite): `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`. Single file: `npx vitest run <path>`.
- Migrations: author with `npx drizzle-kit generate`; **applying to Supabase (`DIRECT_URL=... npx drizzle-kit migrate`) is a prod action — ask the user first.** PGlite tests apply migrations automatically from `drizzle/`.
- Do not push to `master` without explicit user approval ("ship"/"push"). Local commits after each green task.
- New env knobs default so behavior without env changes is: hybrid ON, window 100k chars.
- Existing latest migration is `drizzle/0014_ambitious_vertigo.sql` — this plan adds `0015` (generated) and `0016` (custom).

---

### Task 1: Migration + schema — `failed_pages`, pg_trgm, tsvector, GIN indexes

**Files:**
- Modify: `src/db/schema.ts` (documents table, ~line 65–85)
- Modify: `tests/helpers/test-db.ts`
- Create: `drizzle/0015_*.sql` (generated), `drizzle/0016_hybrid_search.sql` (custom)
- Test: `tests/unit/lib/keyword-infra.test.ts`

**Interfaces:**
- Produces: `documents.failedPages: number[] | null` (Drizzle column `failed_pages jsonb`); DB objects `document_chunks.content_tsv` (generated, STORED), GIN indexes `idx_chunks_tsv`, `idx_chunks_trgm`; PGlite test DB with `pg_trgm` loaded.

- [ ] **Step 1: Add `failedPages` to the documents table in `src/db/schema.ts`**

Add `jsonb` to the existing `drizzle-orm/pg-core` import, then in `documents` after `extractionPartial`:

```ts
  failedPages: jsonb('failed_pages').$type<number[] | null>(),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0015_<name>.sql` containing `ALTER TABLE "documents" ADD COLUMN "failed_pages" jsonb;`

- [ ] **Step 3: Create the custom hybrid-search migration**

Run: `npx drizzle-kit generate --custom --name=hybrid_search`
Then write into the created `drizzle/0016_hybrid_search.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_tsv" ON "document_chunks" USING gin ("content_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_trgm" ON "document_chunks" USING gin ("content" gin_trgm_ops);
```

Note: `content_tsv` is deliberately NOT declared in `schema.ts` — raw-SQL only. `drizzle-kit generate` diffs `schema.ts` against its snapshots, so it will neither know about nor try to drop this column. Queries reference it via `sql` fragments (Task 4).

- [ ] **Step 4: Load pg_trgm in the PGlite test helper**

In `tests/helpers/test-db.ts`:

```ts
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
```

and change the constructor line to:

```ts
    client = new PGlite({ extensions: { vector, pg_trgm } })
```

- [ ] **Step 5: Write the failing infra test**

Create `tests/unit/lib/keyword-infra.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

describe('hybrid search infrastructure', () => {
  beforeEach(async () => { await createTestDb() })

  it('has pg_trgm and the content_tsv generated column', async () => {
    const r: unknown = await testDb.execute(sql`
      INSERT INTO projects (name) VALUES ('p') RETURNING id`)
    const rows = Array.isArray(r) ? r : (r as { rows: { id: number }[] }).rows
    const projectId = rows[0].id
    await testDb.execute(sql`
      INSERT INTO documents (project_id, filename, mime_type, file_size, char_count)
      VALUES (${projectId}, 'plans.pdf', 'application/pdf', 1, 1)`)
    await testDb.execute(sql`
      INSERT INTO document_chunks (document_id, project_id, chunk_index, content)
      VALUES (1, ${projectId}, 0, 'Storm drain schedule sheet SW-101 general notes')`)
    const q: unknown = await testDb.execute(sql`
      SELECT id FROM document_chunks
      WHERE content_tsv @@ websearch_to_tsquery('english', 'storm drain')
        AND content ILIKE '%SW-101%'`)
    const hits = Array.isArray(q) ? q : (q as { rows: unknown[] }).rows
    expect(hits.length).toBe(1)
  })
})
```

- [ ] **Step 6: Run test to verify it passes** (migrations run automatically in `createTestDb`)

Run: `npx vitest run tests/unit/lib/keyword-infra.test.ts`
Expected: PASS. If `pg_trgm` fails to load, check the import path `@electric-sql/pglite/contrib/pg_trgm` against the installed PGlite version (pinned `^0.4.6`).

- [ ] **Step 7: Run the full suite to catch schema drift**

Run: `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts tests/helpers/test-db.ts drizzle/ tests/unit/lib/keyword-infra.test.ts
git commit -m "feat(db): failed_pages column + pg_trgm/tsvector hybrid-search infrastructure"
```

---

### Task 2: Failed-page tracking through extraction → DB → UI

**Files:**
- Modify: `src/lib/fileExtraction.ts` (ExtractionResult, ~line 10)
- Modify: `src/lib/visionExtraction.ts` (extractViaVision ~106–124, extractPagesViaVision ~128–146)
- Modify: `src/app/api/documents/process/route.ts` (hybrid block ~123–152, ingest calls ~205–225)
- Modify: `src/app/actions.ts` (updateDocumentStatus ~470, commitDocumentReplacement — find with grep)
- Modify: `src/lib/ingest.ts`
- Modify: `src/types.ts` (DocumentSummary)
- Modify: `src/components/chat/DocumentCard.tsx` (Partial badge ~69–78)
- Modify: `src/lib/utils.ts` (add formatPageList)
- Test: `tests/unit/lib/utils.test.ts`, `tests/unit/lib/visionExtraction-failed-pages.test.ts`

**Interfaces:**
- Consumes: `documents.failedPages` column (Task 1).
- Produces: `ExtractionResult.failedPages?: number[]`; `extractPagesViaVision` return gains `failedPages: number[]`; `formatPageList(pages: number[]): string` in `src/lib/utils.ts`; `updateDocumentStatus`/`commitDocumentReplacement`/`ingestText` accept `failedPages?: number[] | null`. Task 6's tool reads `doc.failedPages`.

- [ ] **Step 1: Write the failing formatPageList test** (append to `tests/unit/lib/utils.test.ts`)

```ts
import { formatPageList } from '@/lib/utils'

describe('formatPageList', () => {
  it('collapses consecutive runs', () => {
    expect(formatPageList([12, 13, 14, 30])).toBe('12–14, 30')
  })
  it('handles single pages and unsorted input', () => {
    expect(formatPageList([7])).toBe('7')
    expect(formatPageList([3, 1, 2, 9])).toBe('1–3, 9')
  })
  it('returns empty string for empty input', () => {
    expect(formatPageList([])).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/unit/lib/utils.test.ts` → FAIL (`formatPageList` not exported)

- [ ] **Step 3: Implement `formatPageList` in `src/lib/utils.ts`** (match file style)

```ts
/** [12,13,14,30] → "12–14, 30" — compact page-run formatting for badges/tooltips. */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const runs: string[] = []
  let start = -1, prev = -1
  for (const p of sorted) {
    if (start === -1) { start = prev = p; continue }
    if (p === prev + 1) { prev = p; continue }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = prev = p
  }
  if (start !== -1) runs.push(start === prev ? `${start}` : `${start}–${prev}`)
  return runs.join(', ')
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run tests/unit/lib/utils.test.ts`

- [ ] **Step 5: Extend ExtractionResult and vision extraction**

In `src/lib/fileExtraction.ts`, add to `ExtractionResult`:

```ts
  failedPages?: number[] // absolute page numbers whose vision segment failed after retries
```

In `src/lib/visionExtraction.ts`, add a small helper above `extractViaVision`:

```ts
const segPages = (seg: { firstPage: number; lastPage: number }) =>
  Array.from({ length: seg.lastPage - seg.firstPage + 1 }, (_, i) => seg.firstPage + i)
```

In `extractViaVision`, after `const ok = results.filter(r => r.text)`:

```ts
  const failedPages = results.filter(r => !r.text).flatMap(r => segPages(r.seg))
```

and add `failedPages` to the returned object.

In `extractPagesViaVision`, change the return type's `failed: number` to also expose pages — full new signature:

```ts
): Promise<{ segments: { firstPage: number; lastPage: number; text: string }[]; failed: number; failedPages: number[]; truncated: boolean; skippedPages: number }> {
```

with (after `const ok = results.filter(r => r.text)`):

```ts
  const failedPages = results.filter(r => !r.text).flatMap(r => segPages(r.seg))
```

returned alongside the existing fields (`failed: results.length - ok.length` stays).

- [ ] **Step 6: Write the failing vision failed-pages test**

Create `tests/unit/lib/visionExtraction-failed-pages.test.ts` — mock the AI SDK so one segment fails. Follow the mocking pattern of existing `tests/unit/lib/` vision tests if present; otherwise:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateTextMock = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => () => 'model' }))
vi.mock('@/lib/settings', () => ({ getGeminiApiKey: async () => 'key' }))
vi.mock('@/lib/pdfSegments', () => ({
  splitPdfIntoSegments: async () => ({
    segments: [
      { bytes: new Uint8Array(), firstPage: 1, lastPage: 2 },
      { bytes: new Uint8Array(), firstPage: 3, lastPage: 4 },
    ],
    pageCount: 4, skippedPages: 0,
  }),
  splitPdfPageRuns: async () => ({ segments: [], skippedPages: 0 }),
}))

describe('extractViaVision failed pages', () => {
  beforeEach(() => {
    vi.stubEnv('EXTRACTION_SEGMENT_RETRIES', '0')
    generateTextMock.mockReset()
  })
  it('records the page range of a segment that fails after retries', async () => {
    generateTextMock
      .mockResolvedValueOnce({ text: '# Page 1\nok', finishReason: 'stop' })
      .mockRejectedValueOnce(new Error('boom'))
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const r = await extractViaVision(Buffer.from(''))
    expect(r.failedPages).toEqual([3, 4])
    expect(r.partial).toBe(true)
  })
})
```

- [ ] **Step 7: Run to verify PASS** — `npx vitest run tests/unit/lib/visionExtraction-failed-pages.test.ts` (fails before Step 5's edit, passes after; adjust mock shape if the module imports differ — check the file's actual imports first)

- [ ] **Step 8: Plumb failedPages through persistence**

`src/app/actions.ts` — `updateDocumentStatus` updates type gains `failedPages?: number[] | null`. Find `commitDocumentReplacement` (grep `export async function commitDocumentReplacement`) and add `failedPages?: number[] | null` to its updates parameter the same way; both already spread `...updates` into `.set()`.

`src/lib/ingest.ts` — `opts` gains `failedPages?: number[] | null`; pass through:

```ts
    pageCount: opts.pageCount ?? null, pagesExtracted: opts.pagesExtracted ?? null,
    extractionPartial, failedPages: opts.failedPages ?? null,
```

`src/app/api/documents/process/route.ts`:
- After the extraction try/catch (around line 118), add: `let failedPages: number[] = extraction.failedPages ?? []`
- In the hybrid block, after `const hybrid = await extractPagesViaVision(buffer, sparse)`: `failedPages = [...failedPages, ...hybrid.failedPages]`
- Replace-flow `commitDocumentReplacement` call: add `failedPages: failedPages.length ? failedPages : null,` to its updates object.
- New-upload `ingestText` call: add `failedPages: failedPages.length ? failedPages : null` to opts.

- [ ] **Step 9: Surface in the client**

`src/types.ts` — add to `DocumentSummary`:

```ts
  failedPages: number[] | null
```

(The GET route spreads full rows, so the field flows automatically.)

`src/components/chat/DocumentCard.tsx` — the Partial badge `title` becomes:

```tsx
              title={doc.failedPages && doc.failedPages.length > 0
                ? `Vision failed on pages ${formatPageList(doc.failedPages)}`
                : doc.pagesExtracted != null && doc.pageCount != null && doc.pagesExtracted < doc.pageCount
                  ? `Extracted ${doc.pagesExtracted} of ${doc.pageCount} pages`
                  : 'Partial extraction — some content may be missing'}
```

with `import { formatPageList } from '@/lib/utils'` added (match the file's existing import style).

- [ ] **Step 10: Typecheck + full suite** — `npm run typecheck` then `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism` → green (fix any DocumentSummary consumers the typecheck flags by adding the field to test fixtures).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(documents): record and surface which pages failed vision extraction"
```

---

### Task 3: Chunk provenance tags for vision-derived text

**Files:**
- Modify: `src/lib/visionExtraction.ts`
- Modify: `src/app/api/documents/process/route.ts` (hybrid splice ~135–142)
- Test: `tests/unit/lib/visionExtraction-failed-pages.test.ts` (extend)

**Interfaces:**
- Produces: `visionRunHeader(first: number, last: number): string` exported from `src/lib/visionExtraction.ts`, format `[pages 12–14 · vision]` / `[page 7 · vision]`.

- [ ] **Step 1: Write the failing test** (append to the Task 2 test file)

```ts
import { visionRunHeader } from '@/lib/visionExtraction'

describe('visionRunHeader', () => {
  it('formats ranges and single pages', () => {
    expect(visionRunHeader(12, 14)).toBe('[pages 12–14 · vision]')
    expect(visionRunHeader(7, 7)).toBe('[page 7 · vision]')
  })
})

it('prefixes each successful segment with a provenance header', async () => {
  generateTextMock
    .mockResolvedValueOnce({ text: '# Page 1\nok', finishReason: 'stop' })
    .mockResolvedValueOnce({ text: '# Page 3\nok2', finishReason: 'stop' })
  const { extractViaVision } = await import('@/lib/visionExtraction')
  const r = await extractViaVision(Buffer.from(''))
  expect(r.text).toContain('[pages 1–2 · vision]\n# Page 1')
  expect(r.text).toContain('[pages 3–4 · vision]\n# Page 3')
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/unit/lib/visionExtraction-failed-pages.test.ts`

- [ ] **Step 3: Implement**

`src/lib/visionExtraction.ts`:

```ts
/** Provenance header prepended to vision-derived text runs so it lands inside
 * chunk content and flows into retrieval context (same pattern as web ingest's
 * Source: header). */
export function visionRunHeader(first: number, last: number): string {
  return first === last ? `[page ${first} · vision]` : `[pages ${first}–${last} · vision]`
}
```

In `extractViaVision`, change the joined text to:

```ts
    text: ok.map(r => `${visionRunHeader(r.seg.firstPage, r.seg.lastPage)}\n${r.text}`).join('\n\n'),
```

In `src/app/api/documents/process/route.ts` hybrid splice, change `if (seg) parts.push(seg.text)` to:

```ts
              if (seg) parts.push(`${visionRunHeader(seg.firstPage, seg.lastPage)}\n${seg.text}`)
```

with `visionRunHeader` added to the existing `@/lib/visionExtraction` import.

- [ ] **Step 4: Run to verify PASS**, then full suite, then commit

```bash
git add -A
git commit -m "feat(documents): provenance headers on vision-derived text runs"
```

---

### Task 4: Keyword search (FTS + trigram ILIKE)

**Files:**
- Create: `src/lib/keywordSearch.ts`
- Test: `tests/unit/lib/keywordSearch.test.ts`

**Interfaces:**
- Consumes: `content_tsv` + trigram index (Task 1); `@/db` (mocked to PGlite in tests).
- Produces: `findChunksByKeyword(query: string, projectId: number, topN: number): Promise<KeywordChunk[]>` where `KeywordChunk = { content: string; chunkId: number; documentId: number; filename: string; embedding: null }`; `identifierTokens(query: string, max?: number): string[]` (exported for tests).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/keywordSearch.test.ts` (mock `@/db` with the PGlite getter pattern used by `tests/unit/actions/` tests — copy the exact `vi.mock('@/db', ...)` block from an existing actions test):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() { return testDb },
}))

import { findChunksByKeyword, identifierTokens } from '@/lib/keywordSearch'

async function seed() {
  await createTestDb()
  const { projects, documents, documentChunks } = await import('@/db/schema')
  const [p] = await testDb.insert(projects).values({ name: 'p' }).returning()
  const [d] = await testDb.insert(documents).values({
    projectId: p.id, filename: 'plans.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
  }).returning()
  await testDb.insert(documentChunks).values([
    { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'Storm drain profile sheet SW-101 with general notes' },
    { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'Electrical single line diagram E-203 panel schedule' },
    { documentId: d.id, projectId: p.id, chunkIndex: 2, content: 'Landscape irrigation legend and plant schedule' },
  ])
  return { projectId: p.id }
}

describe('identifierTokens', () => {
  it('extracts sheet-number-like tokens only', () => {
    expect(identifierTokens('what does note 7 on SW-101 say about E-203?')).toEqual(['SW-101', 'E-203'])
    expect(identifierTokens('list every storm sheet')).toEqual([])
  })
})

describe('findChunksByKeyword', () => {
  beforeEach(async () => { await seed() })

  it('finds chunks by FTS phrase', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('storm drain', projectId, 10)
    expect(r.length).toBe(1)
    expect(r[0].content).toContain('SW-101')
    expect(r[0].filename).toBe('plans.pdf')
    expect(r[0].embedding).toBeNull()
  })

  it('finds identifier chunks via ILIKE even when FTS misses', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('what is on SW-101', projectId, 10)
    expect(r.some(c => c.content.includes('SW-101'))).toBe(true)
  })

  it('scopes to the project', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('storm drain', projectId + 999, 10)
    expect(r).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/unit/lib/keywordSearch.test.ts` → module not found

- [ ] **Step 3: Implement `src/lib/keywordSearch.ts`**

```ts
// Keyword leg of hybrid retrieval: Postgres FTS over the generated content_tsv
// column plus trigram-indexed ILIKE for identifier tokens ("SW-101") that both
// the FTS tokenizer and embeddings mangle. Results fuse with vector search via
// RRF in retrieval.ts. content_tsv lives only in migration SQL (0016), so both
// queries are raw sql`` — normalize rows across postgres-js (array) and PGlite
// ({ rows }) drivers.
import { sql } from 'drizzle-orm'
import { db } from '@/db'

export interface KeywordChunk {
  content: string
  chunkId: number
  documentId: number
  filename: string
  embedding: null
}

type Row = { chunk_id: number; content: string; document_id: number; filename: string }

const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : (r as { rows: Row[] }).rows) as Row[]

// Sheet-number-ish: 1-4 letters, optional separator, digits, optional suffix.
const IDENTIFIER_RE = /\b[A-Za-z]{1,4}[-.]?\d{1,5}(?:\.\d+)?[A-Za-z]?\b/g

export function identifierTokens(query: string, max = 5): string[] {
  const out: string[] = []
  for (const m of query.match(IDENTIFIER_RE) ?? []) {
    if (!/\d/.test(m) || !/[A-Za-z]/.test(m)) continue
    if (!out.includes(m)) out.push(m)
    if (out.length >= max) break
  }
  return out
}

export async function findChunksByKeyword(
  query: string,
  projectId: number,
  topN: number,
): Promise<KeywordChunk[]> {
  const fts = rowsOf(await db.execute(sql`
    SELECT dc.id AS chunk_id, dc.content, dc.document_id, d.filename
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.project_id = ${projectId}
      AND dc.content_tsv @@ websearch_to_tsquery('english', ${query})
    ORDER BY ts_rank_cd(dc.content_tsv, websearch_to_tsquery('english', ${query})) DESC
    LIMIT ${topN}`))

  const tokens = identifierTokens(query)
  let trg: Row[] = []
  if (tokens.length > 0) {
    const likes = sql.join(tokens.map(t => sql`dc.content ILIKE ${'%' + t + '%'}`), sql` OR `)
    trg = rowsOf(await db.execute(sql`
      SELECT dc.id AS chunk_id, dc.content, dc.document_id, d.filename
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE dc.project_id = ${projectId} AND (${likes})
      LIMIT ${topN}`))
  }

  const seen = new Set<number>()
  const out: KeywordChunk[] = []
  for (const r of [...fts, ...trg]) {
    if (seen.has(r.chunk_id)) continue
    seen.add(r.chunk_id)
    out.push({ content: r.content, chunkId: r.chunk_id, documentId: r.document_id, filename: r.filename, embedding: null })
    if (out.length >= topN) break
  }
  return out
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run tests/unit/lib/keywordSearch.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/keywordSearch.ts tests/unit/lib/keywordSearch.test.ts
git commit -m "feat(rag): keyword search - FTS + trigram ILIKE over document chunks"
```

---

### Task 5: RRF fusion into the retrieval pipeline

**Files:**
- Create: `src/lib/rrf.ts`
- Modify: `src/lib/ragConfig.ts`
- Modify: `src/lib/retrieval.ts` (documents path, ~lines 54–70)
- Test: `tests/unit/lib/rrf.test.ts`, extend `tests/unit/lib/ragConfig.test.ts` if present (else assertions go in rrf.test.ts)

**Interfaces:**
- Consumes: `findChunksByKeyword` (Task 4), existing `findSimilarDocumentChunks`, `mmr`, `rerankCandidates`.
- Produces: `rrfFuse<T extends { chunkId: number }>(lists: T[][], k?: number): (T & { rrfScore: number })[]`; `RagConfig` gains `hybridEnabled: boolean`, `rrfK: number`, `keywordTopN: number`.

- [ ] **Step 1: Write the failing RRF test**

Create `tests/unit/lib/rrf.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rrfFuse } from '@/lib/rrf'

const item = (chunkId: number, extra: object = {}) => ({ chunkId, ...extra })

describe('rrfFuse', () => {
  it('scores shared items above single-list items', () => {
    const a = [item(1), item(2)]
    const b = [item(2), item(3)]
    const fused = rrfFuse([a, b], 60)
    expect(fused[0].chunkId).toBe(2) // in both lists
    expect(fused.map(f => f.chunkId)).toEqual([2, 1, 3])
  })
  it('keeps the FIRST list\'s payload for shared ids', () => {
    const a = [item(1, { embedding: [0.1] })]
    const b = [item(1, { embedding: null })]
    const fused = rrfFuse([a, b])
    expect((fused[0] as { embedding: unknown }).embedding).toEqual([0.1])
  })
  it('computes standard RRF scores (1/(k+rank+1))', () => {
    const fused = rrfFuse([[item(1)], [item(1)]], 60)
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/unit/lib/rrf.test.ts`

- [ ] **Step 3: Implement `src/lib/rrf.ts`**

```ts
// Reciprocal Rank Fusion: merge ranked candidate lists (vector, keyword) into
// one ranking without score calibration. score(item) = Σ over lists 1/(k + rank + 1).
// Payload for duplicate ids comes from the FIRST list containing the id — pass
// the vector list first so fused items keep their embeddings for MMR.
export function rrfFuse<T extends { chunkId: number }>(
  lists: T[][],
  k = 60,
): (T & { rrfScore: number })[] {
  const byId = new Map<number, T & { rrfScore: number }>()
  for (const list of lists) {
    list.forEach((item, rank) => {
      const existing = byId.get(item.chunkId)
      const inc = 1 / (k + rank + 1)
      if (existing) existing.rrfScore += inc
      else byId.set(item.chunkId, { ...item, rrfScore: inc })
    })
  }
  return [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore)
}
```

- [ ] **Step 4: Run to verify PASS**

- [ ] **Step 5: Add config knobs to `src/lib/ragConfig.ts`**

`RagConfig` interface gains:

```ts
  hybridEnabled: boolean
  rrfK: number
  keywordTopN: number
```

`getRagConfig()` gains:

```ts
    hybridEnabled: bool(process.env.RAG_HYBRID_ENABLED, true),
    rrfK: num(process.env.RAG_RRF_K, 60),
    keywordTopN: num(process.env.RAG_KEYWORD_TOP_N, num(process.env.RAG_TOP_N, 20)),
```

- [ ] **Step 6: Wire fusion into `src/lib/retrieval.ts`**

Add imports:

```ts
import { findChunksByKeyword } from './keywordSearch'
import { rrfFuse } from './rrf'
```

Replace the body of `documentsP` (keep the try/catch + null-scope guard) with:

```ts
      try {
        const [vecCands, kwCands] = await Promise.all([
          findSimilarDocumentChunks(queryEmbedding, scope.projectId, cfg.topN, cfg.docThreshold, cfg.mmrEnabled),
          cfg.hybridEnabled
            ? findChunksByKeyword(query, scope.projectId, cfg.keywordTopN).catch(e => {
                // Keyword leg is best-effort: a failure degrades to vector-only.
                console.warn('[retrieval] keyword search failed:', e instanceof Error ? e.message : e)
                return []
              })
            : Promise.resolve([]),
        ])
        // Vector list FIRST so shared ids keep their embedding for MMR.
        let docCands: (typeof vecCands[number] | typeof kwCands[number])[] = rrfFuse(
          [vecCands as { chunkId: number }[] as typeof vecCands, kwCands as { chunkId: number }[] as typeof kwCands],
          cfg.rrfK,
        )
        if (cfg.mmrEnabled) {
          // MMR needs embeddings; keyword-only hits have none but are exact
          // matches by construction — keep them alongside the MMR picks.
          const embedded = docCands.filter(c => c.embedding != null)
          const keywordOnly = docCands.filter(c => c.embedding == null).slice(0, cfg.docTopK)
          const picked = mmr(embedded as (typeof vecCands[number] & MmrItem)[], cfg.docTopK * 2, cfg.mmrLambda)
          const seen = new Set(picked.map(c => c.chunkId))
          docCands = [...picked, ...keywordOnly.filter(c => !seen.has(c.chunkId))]
        }
        const docFinal = cfg.rerankEnabled ? await rerankCandidates(query, docCands, cfg.docTopK) : docCands.slice(0, cfg.docTopK)
        return docFinal.length > 0 ? docFinal.map(c => `[From: ${c.filename}]\n${c.content}`).join('\n---\n') : null
      } catch (e) {
```

(If the union-type cast fights `tsc`, define a local `type DocCand = { content: string; chunkId: number; documentId: number; filename: string; embedding: number[] | null }` and type both legs as `DocCand[]` — both shapes structurally satisfy it.)

- [ ] **Step 7: Typecheck + full suite** — `npm run typecheck` → 0 errors; full vitest green. Existing retrieval-related API tests must still pass: they mock `@/lib/embeddings`; add `vi.mock('@/lib/keywordSearch', () => ({ findChunksByKeyword: async () => [] }))` to any chat-route test that now fails with a DB access error.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(rag): RRF-fuse keyword and vector retrieval, always-on hybrid"
```

---

### Task 6: Window slicer for whole-document reads

**Files:**
- Create: `src/lib/documents/windowing.ts`
- Test: `tests/unit/lib/windowing.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DocWindow {
  text: string
  startOffset: number
  endOffset: number          // exclusive; === full.length when the doc is exhausted
  nextOffset: number | null  // null when exhausted
  firstPage: number | null   // first "# Page n" anchor inside the window
  lastPage: number | null
  totalAnchors: number       // anchors in the WHOLE document (0 = no page structure)
  pageFound: boolean         // false when fromPage was requested but no such anchor exists
}
export function sliceWindow(full: string, opts: { fromPage?: number; offset?: number; maxChars: number }): DocWindow
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/windowing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sliceWindow } from '@/lib/documents/windowing'

const paged = ['# Page 1', 'alpha'.repeat(10), '# Page 2', 'bravo'.repeat(10), '# Page 3', 'charlie'.repeat(10)].join('\n')

describe('sliceWindow', () => {
  it('reads from the start by default and reports anchors', () => {
    const w = sliceWindow(paged, { maxChars: 10_000 })
    expect(w.startOffset).toBe(0)
    expect(w.nextOffset).toBeNull()
    expect(w.firstPage).toBe(1)
    expect(w.lastPage).toBe(3)
    expect(w.totalAnchors).toBe(3)
  })
  it('starts at a requested page anchor', () => {
    const w = sliceWindow(paged, { fromPage: 2, maxChars: 10_000 })
    expect(w.text.startsWith('# Page 2')).toBe(true)
    expect(w.firstPage).toBe(2)
    expect(w.pageFound).toBe(true)
  })
  it('flags a missing page instead of guessing', () => {
    const w = sliceWindow(paged, { fromPage: 99, maxChars: 10_000 })
    expect(w.pageFound).toBe(false)
    expect(w.text).toBe('')
  })
  it('caps at maxChars and hands back a continuation offset', () => {
    const w = sliceWindow(paged, { maxChars: 20 })
    expect(w.text.length).toBe(20)
    expect(w.nextOffset).toBe(20)
    const w2 = sliceWindow(paged, { offset: w.nextOffset!, maxChars: 20 })
    expect(w2.startOffset).toBe(20)
  })
  it('handles anchor-less documents in pure offset mode', () => {
    const flat = 'x'.repeat(100)
    const w = sliceWindow(flat, { offset: 40, maxChars: 30 })
    expect(w.text).toBe('x'.repeat(30))
    expect(w.totalAnchors).toBe(0)
    expect(w.firstPage).toBeNull()
    expect(w.nextOffset).toBe(70)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/unit/lib/windowing.test.ts`

- [ ] **Step 3: Implement `src/lib/documents/windowing.ts`**

```ts
// Pure window slicer for read_document. Vision/hybrid extractions carry
// "# Page <n>" heading anchors (absolute page numbers — see segmentPrompt in
// visionExtraction.ts); text-path extractions have none, so the slicer supports
// both page-anchored and raw-offset navigation over the same string.

export interface DocWindow {
  text: string
  startOffset: number
  endOffset: number
  nextOffset: number | null
  firstPage: number | null
  lastPage: number | null
  totalAnchors: number
  pageFound: boolean
}

const ANCHOR_RE = /^# Page (\d+)\s*$/gm

function anchors(full: string): { page: number; index: number }[] {
  const out: { page: number; index: number }[] = []
  for (const m of full.matchAll(ANCHOR_RE)) out.push({ page: Number(m[1]), index: m.index ?? 0 })
  return out
}

export function sliceWindow(
  full: string,
  opts: { fromPage?: number; offset?: number; maxChars: number },
): DocWindow {
  const marks = anchors(full)
  let start = opts.offset ?? 0
  let pageFound = true
  if (opts.fromPage != null) {
    const hit = marks.find(a => a.page >= opts.fromPage!)
    if (!hit) {
      return { text: '', startOffset: 0, endOffset: 0, nextOffset: null, firstPage: null, lastPage: null, totalAnchors: marks.length, pageFound: false }
    }
    start = hit.index
  }
  start = Math.max(0, Math.min(start, full.length))
  const end = Math.min(start + opts.maxChars, full.length)
  const inWindow = marks.filter(a => a.index >= start && a.index < end)
  return {
    text: full.slice(start, end),
    startOffset: start,
    endOffset: end,
    nextOffset: end < full.length ? end : null,
    firstPage: inWindow.length ? inWindow[0].page : null,
    lastPage: inWindow.length ? inWindow[inWindow.length - 1].page : null,
    totalAnchors: marks.length,
    pageFound,
  }
}
```

- [ ] **Step 4: Run to verify PASS**, commit

```bash
git add src/lib/documents/windowing.ts tests/unit/lib/windowing.test.ts
git commit -m "feat(documents): pure window slicer for whole-document reads"
```

---

### Task 7: The `read_document` tool

**Files:**
- Create: `src/lib/documents/tool.ts`
- Test: `tests/unit/lib/readDocumentTool.test.ts`

**Interfaces:**
- Consumes: `sliceWindow` (Task 6), `downloadToBuffer` from `@/lib/storage`, `getDocumentById` from `@/app/actions`, `documents.failedPages` (Task 2).
- Produces: `createReadDocumentTool(ctx: { projectId: number })` — AI SDK v6 `tool()` named `read_document` in the chat route's tools object (Task 8). Success result shape: `{ documentId, filename, totalChars, text, startOffset, endOffset, nextOffset, firstPage, lastPage, totalAnchors, unavailablePages, note }`; error shape `{ error: string }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/readDocumentTool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const downloadMock = vi.fn()
const getDocMock = vi.fn()
vi.mock('@/lib/storage', () => ({ downloadToBuffer: (...a: unknown[]) => downloadMock(...a) }))
vi.mock('@/app/actions', () => ({ getDocumentById: (...a: unknown[]) => getDocMock(...a) }))

import { createReadDocumentTool } from '@/lib/documents/tool'

const doc = {
  id: 7, projectId: 3, filename: 'plans.pdf', revision: 1,
  status: 'ready', failedPages: [12, 13], charCount: 60,
}

describe('read_document tool', () => {
  beforeEach(() => { downloadMock.mockReset(); getDocMock.mockReset() })

  it('returns a window with continuation metadata', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockResolvedValue(Buffer.from('# Page 1\nhello world\n# Page 2\nmore text'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(downloadMock).toHaveBeenCalledWith('documents/3/7/extracted.txt')
    expect(r.text).toContain('# Page 1')
    expect(r.unavailablePages).toEqual([12, 13])
    expect(r.nextOffset).toBeNull()
  })

  it('uses the revision-scoped path for replaced documents', async () => {
    getDocMock.mockResolvedValue({ ...doc, revision: 3 })
    downloadMock.mockResolvedValue(Buffer.from('text'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(downloadMock).toHaveBeenCalledWith('documents/3/7/rev3/extracted.txt')
  })

  it('refuses documents outside the chat project', async () => {
    getDocMock.mockResolvedValue({ ...doc, projectId: 99 })
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.error).toMatch(/not found/i)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('degrades gracefully when extracted.txt is missing', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockRejectedValue(new Error('Object not found'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.error).toMatch(/re-upload/i)
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement `src/lib/documents/tool.ts`**

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { downloadToBuffer } from '@/lib/storage'
import { getDocumentById } from '@/app/actions'
import { sliceWindow } from './windowing'

const windowChars = () => Number(process.env.READ_DOC_WINDOW_CHARS) || 100_000

export function createReadDocumentTool(ctx: { projectId: number }) {
  return tool({
    description:
      'Read the FULL extracted text of a project document, one window at a time. ' +
      'Use this for set-wide or exhaustive questions that retrieval chunks cannot answer — "list every…", ' +
      '"summarize the whole document", counting items across a plan set — or when the provided chunks are ' +
      'clearly insufficient. For a targeted question already covered by the retrieved document context, just answer. ' +
      'The document manifest in your instructions lists the available documents and ids. ' +
      'Each call returns ONE window (capped) plus continuation info: call again with fromPage (when page anchors exist) ' +
      'or offset=nextOffset to keep reading. Stop reading as soon as you have what you need.',
    inputSchema: z.object({
      documentId: z.number().int().positive(),
      fromPage: z.number().int().positive().optional()
        .describe('Start at this page anchor (documents with page structure only)'),
      offset: z.number().int().min(0).optional()
        .describe('Start at this character offset — pass the previous call\'s nextOffset to continue'),
    }),
    execute: async ({ documentId, fromPage, offset }) => {
      try {
        const doc = await getDocumentById(documentId)
        if (!doc || doc.projectId !== ctx.projectId) {
          return { error: 'Document not found in this project. Use an id from the document manifest.' }
        }
        const path = `documents/${doc.projectId}/${doc.id}/${doc.revision > 1 ? `rev${doc.revision}/` : ''}extracted.txt`
        let full: string
        try {
          full = (await downloadToBuffer(path)).toString('utf-8')
        } catch {
          return { error: `Full text is unavailable for "${doc.filename}" (ingested before whole-document support). Ask the user to re-upload it to enable whole-document reading.` }
        }
        const w = sliceWindow(full, { fromPage, offset, maxChars: windowChars() })
        if (!w.pageFound) {
          return { error: `No page ${fromPage} in "${doc.filename}" — it has ${w.totalAnchors} page anchors. Use offset-based reading or a page within range.` }
        }
        const failedPages = (doc.failedPages as number[] | null) ?? []
        return {
          documentId: doc.id,
          filename: doc.filename,
          totalChars: full.length,
          text: w.text,
          startOffset: w.startOffset,
          endOffset: w.endOffset,
          nextOffset: w.nextOffset,
          firstPage: w.firstPage,
          lastPage: w.lastPage,
          totalAnchors: w.totalAnchors,
          unavailablePages: failedPages,
          note: w.nextOffset == null
            ? 'End of document.'
            : `Partial window — continue with offset=${w.nextOffset}${w.lastPage != null ? ` (or fromPage=${w.lastPage + 1})` : ''} if more is needed.`,
        }
      } catch (e) {
        console.warn('[read_document] failed:', e instanceof Error ? e.message : e)
        return { error: 'Failed to read the document.' }
      }
    },
  })
}
```

- [ ] **Step 4: Run to verify PASS**, then commit

```bash
git add src/lib/documents/tool.ts tests/unit/lib/readDocumentTool.test.ts
git commit -m "feat(chat): read_document tool - windowed whole-document reads"
```

---

### Task 8: Chat-route wiring — manifest, tool, guidance

**Files:**
- Modify: `src/app/api/chat/route.ts` (imports ~1–10, TOOL_GUIDANCE ~22–31, chatId block ~81–133)
- Test: extend the existing chat API test (`tests/unit/api/` — locate the chat route test file by grep `api/chat`)

**Interfaces:**
- Consumes: `createReadDocumentTool` (Task 7), `getProjectDocuments` from `@/app/actions` (existing), `formatPageList` (Task 2).
- Produces: `read_document` in the tools object for Claude project chats with ready documents; a `[Project documents]` manifest block appended to the system prompt.

**NOTE:** this file uses semicolons — match it.

- [ ] **Step 1: Add imports**

```ts
import { createReadDocumentTool } from '@/lib/documents/tool';
import { formatPageList } from '@/lib/utils';
```

and add `getProjectDocuments` to the existing `@/app/actions` import.

- [ ] **Step 2: Fetch documents concurrently**

Inside the `if (chatId)` block, extend the existing `Promise.all` to also fetch project documents (chat is already loaded above it):

```ts
      const [ctx, retrieved, projectDocs] = await Promise.all([
        chat?.projectId ? getProjectContext(chat.projectId) : Promise.resolve(null),
        retrieveContext(messages as unknown as UIMessage[], {
          chatId,
          projectId: chat?.projectId ?? null,
        }),
        chat?.projectId ? getProjectDocuments(chat.projectId).catch(() => []) : Promise.resolve([]),
      ]);
```

- [ ] **Step 3: Wire the tool + manifest into the Claude/storage branch**

Replace the section-4 block (currently `if (modelName.startsWith('claude') && isStorageConfigured())`) with:

```ts
      // 4. Merge Claude tools when Storage is configured. Prepend chat-first
      //    guidance so tools are reserved for explicit requests.
      if (modelName.startsWith('claude') && isStorageConfigured()) {
        const projectId = chat?.projectId ?? null;
        tools = {
          ...(providerTools ?? {}),
          generate_artifact: createGenerateArtifactTool({ chatId, projectId }),
          generate_image: createGenerateImageTool({ chatId, projectId }),
        };
        let guidance = TOOL_GUIDANCE;
        const readableDocs = projectDocs.filter(d => d.status === 'ready' && d.storagePath);
        if (projectId && readableDocs.length > 0) {
          tools.read_document = createReadDocumentTool({ projectId });
          const manifest = readableDocs
            .map(d => `- id=${d.id} "${d.filename}" — ${d.pageCount ?? '?'} pages, ${d.charCount.toLocaleString()} chars, ${d.extractionMethod ?? 'text'} extraction${d.extractionPartial ? ` (PARTIAL${d.failedPages?.length ? `; vision failed pages ${formatPageList(d.failedPages)}` : ''})` : ''}`)
            .join('\n');
          guidance += '\n\n' + READ_DOCUMENT_GUIDANCE + '\n[Project documents]\n' + manifest;
        }
        systemPrompt = systemPrompt ? `${guidance}\n\n${systemPrompt}` : guidance;
      }
```

And add the constant next to `TOOL_GUIDANCE`:

```ts
// Whole-document mode: retrieval chunks answer targeted questions; read_document
// exists for set-wide/exhaustive ones. Keep it chunks-first so ordinary questions
// stay fast and cheap.
const READ_DOCUMENT_GUIDANCE =
  'You can also read entire project documents with the read_document tool. Retrieved document chunks (above) answer most questions — prefer them. ' +
  'Call read_document ONLY when the question is set-wide or exhaustive ("list every…", "count all…", "summarize the whole document") or when the chunks clearly miss what the user asked about. ' +
  'Read additional windows (fromPage/offset) only while genuinely needed; stop as soon as you can answer.';
```

- [ ] **Step 4: Extend the chat API test**

In the existing chat route test file, existing mocks for `@/app/actions` must now also export `getProjectDocuments`. Add a test case: with a Claude model, storage configured (mock `isStorageConfigured` → true), a project chat, and one ready document `{ id: 1, status: 'ready', storagePath: 'p', filename: 'plans.pdf', pageCount: 4, charCount: 100, extractionMethod: 'hybrid', extractionPartial: false, failedPages: null }`, capture the `streamText` mock's call args and assert:

```ts
expect(streamTextMock.mock.calls[0][0].tools).toHaveProperty('read_document')
expect(streamTextMock.mock.calls[0][0].system).toContain('[Project documents]')
expect(streamTextMock.mock.calls[0][0].system).toContain('id=1 "plans.pdf"')
```

(Follow the file's existing `vi.resetModules()` + `vi.doMock()` + dynamic `import()` pattern exactly; the mock list must include `@/lib/settings`, `@/lib/embeddings`, providers, and now `@/lib/keywordSearch` per Task 5 Step 7.)

- [ ] **Step 5: Typecheck, run the chat API test file, then the full suite** — all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(chat): wire read_document tool + project document manifest into chat route"
```

---

### Task 9: "Reading documents…" stage

**Files:**
- Modify: `src/lib/chatStage.ts`
- Modify: `src/components/chat/ThinkingStatus.tsx` (STAGE_META ~10–15)
- Test: extend the existing chatStage test (`tests/unit/lib/` — grep `deriveAssistantStage`)

**Interfaces:**
- Consumes: `read_document` tool parts (`tool-read_document` / dynamic) from Task 8; `data-stage` parts from Task 10.
- Produces: `AssistantStage` union gains `'reading-documents'`.

- [ ] **Step 1: Write the failing tests** (append to the existing chatStage test file, matching its fixtures style)

```ts
it('maps an active read_document tool part to reading-documents', () => {
  const msg = { role: 'assistant', parts: [{ type: 'tool-read_document', state: 'input-available' }] }
  expect(deriveAssistantStage('streaming', msg)).toBe('reading-documents')
})

it('maps a data-stage part to reading-documents until content arrives', () => {
  const msg = { role: 'assistant', parts: [{ type: 'data-stage', data: { stage: 'reading-documents' } }] }
  expect(deriveAssistantStage('streaming', msg)).toBe('reading-documents')
  const withText = { role: 'assistant', parts: [...msg.parts, { type: 'text', text: 'Answer' }] }
  expect(deriveAssistantStage('streaming', withText)).toBe('writing')
})
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement in `src/lib/chatStage.ts`**

- Union: add `| 'reading-documents'` to `AssistantStage`.
- `StagePart` type gains `data?: { stage?: string }`.
- In the scan loop of `deriveAssistantStage`, inside the `if (toolName)` block add before the generic fallthrough:

```ts
      if (toolName === 'read_document') return 'reading-documents'
```

- After the tool block (still inside the loop), add:

```ts
    if (type === 'data-stage' && (p.data?.stage === 'reading-documents') && !hasAnswerText) return 'reading-documents'
```

- [ ] **Step 4: Add the stage copy in `ThinkingStatus.tsx`**

Add `BookOpen` to the existing `lucide-react` import and to `STAGE_META`:

```ts
  'reading-documents': { icon: BookOpen, label: 'Reading documents…' },
```

- [ ] **Step 5: Run to verify PASS**, full suite, commit

```bash
git add -A
git commit -m "feat(chat): reading-documents stage for read_document + retrieval pass"
```

---

### Task 10 (optional slice — attempt, but drop if the stream plumbing fights back): pre-stream `data-stage` part

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: Task 9's `data-stage` handling in chatStage.
- Produces: a `data-stage` part emitted before retrieval, so pre-stream RAG latency shows as "Reading documents…".

- [ ] **Step 1: Restructure the route response with `createUIMessageStream`**

Change the `ai` import to include `createUIMessageStream, createUIMessageStreamResponse`, then wrap: move everything from `const chat = await getChatWithContext(chatId)` through `const result = streamText({...})` into the stream executor, emitting the stage part after the chat is loaded and before the `Promise.all`:

```ts
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // ...existing chatId context-building block moved here...
        // Immediately after `const chat = await getChatWithContext(chatId)`:
        if (chat?.projectId) {
          writer.write({ type: 'data-stage', id: 'stage', data: { stage: 'reading-documents' }, transient: false });
        }
        // ...rest unchanged, ending with:
        const result = streamText({ /* unchanged args */ });
        writer.merge(result.toUIMessageStream({ sendSources: true, sendReasoning: true }));
      },
    });
    return createUIMessageStreamResponse({ stream });
```

The no-`chatId` path (quick chats) keeps the existing plain `result.toUIMessageStreamResponse(...)` return — only the `chatId` branch is wrapped. Verify the exact `toUIMessageStream` option names against AI SDK v6 docs via Context7 before editing.

- [ ] **Step 2: Verify** — `npm run typecheck`, chat API tests still green (they assert on `streamText` args, not the response wrapper; if a test reads the response class, update it to accept the new wrapper), full suite green. Manual: `npm run dev` is NOT used locally (access gate + prod DB) — this slice is verified on prod after deploy by watching a project chat show "Reading documents…" before first token.

- [ ] **Step 3: Commit** (or, if dropped, note the deferral in the CHANGELOG entry and spec)

```bash
git add -A
git commit -m "feat(chat): emit data-stage part during retrieval pre-pass"
```

---

### Task 11: Spec sync, docs, gate, release prep

**Files:**
- Modify: `docs/specs/2026-07-11-rag-phase3-whole-doc-hybrid-design.md`
- Modify: `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1: Spec sync — persistence guard.** In the spec's `read_document` section, replace the stubbing paragraph with the discovered reality (spec-is-contract rule):

> **Persistence guard (resolved during implementation):** `saveMessage` persists assistant TEXT only — tool outputs never reach the `messages` table, so no stubbing is needed. Window text lives only in the in-flight turn; reloads show the assistant's answer without the tool card (consistent with `web_search`).

Also record Task 10's outcome (shipped or deferred).

- [ ] **Step 2: CLAUDE.md updates** — in the env-knob and architecture sections: `READ_DOC_WINDOW_CHARS` (default 100000), `RAG_HYBRID_ENABLED`/`RAG_RRF_K`/`RAG_KEYWORD_TOP_N`, the `read_document` tool (chunks-first, manifest, windowed), migration range now `0000`–`0016`, `documents.failed_pages`, provenance headers, PGlite now loads `pg_trgm`.

- [ ] **Step 3: CHANGELOG entry** (next minor version) — summarize the five slices.

- [ ] **Step 4: Full verification gate**

```powershell
npm run typecheck        # 0 errors
npm run lint             # 0 errors (~25 baseline warnings fine)
npm run build
$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism
```

- [ ] **Step 5: Commit docs, then STOP for user approval** — applying migrations `0015`/`0016` to Supabase (`DIRECT_URL=... npx drizzle-kit migrate`) and pushing to `master` (auto-deploys) are prod actions: ask the user explicitly. After deploy, run the live acceptance test on the Drover project: **"list every storm sheet"** must enumerate completely; **"what does note 7 on SW-101 say"** must hit via the keyword path; a project chat shows "Reading documents…".

```bash
git add -A
git commit -m "docs: rag phase 3 - changelog, CLAUDE.md, spec sync"
```
