# RAG Phase 2b: Per-Page Hybrid Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vision-extract the individual PDF pages whose text layer is title-block-thin (AutoCAD SHX sheets) and splice the results into the text extraction, so notes sheets inside text-rich plan sets stop ingesting as headings-without-bodies.

**Architecture:** `extractTextFromBuffer` exposes per-page text (`pageTexts`); the process route finds sparse pages (< 500 chars), groups them into contiguous runs, vision-extracts the runs through the existing v4.45.0 segment machinery (`splitPdfPageRuns` + `extractPagesViaVision`), rebuilds the document text page-by-page, and records `extraction_method: 'hybrid'`.

**Tech Stack:** TypeScript, AI SDK v6, pdf-lib, unpdf, Vitest. **Spec:** `docs/specs/2026-07-07-hybrid-page-extraction-design.md`. **Target:** v4.46.0. **Branch:** `feat/hybrid-page-extraction` off `master`.

## Global Constraints

- Code style: single-quote, no semicolons; match the file. NEVER prettier.
- No new dependencies, no migration (`extraction_method` is a plain text column).
- Env knobs: `EXTRACTION_HYBRID_PAGE_MIN_CHARS` default **500**; `EXTRACTION_HYBRID_MAX_PAGES` default **80**. All existing knobs unchanged.
- Vision/hybrid failures are NEVER fatal to ingestion: keep the text path, flag `extraction_partial` when hybrid ran and a run failed or truncated; a fully-failed hybrid (or cap-skip) keeps the plain text path with method `'text'` and no partial.
- `ExtractionResult` stays backward-compatible: `pageTexts` is optional; only the PDF text path sets it.
- AI SDK v6 shapes: `maxOutputTokens`; file parts `{ type: 'file', data, mediaType }`.
- Tests: `npx vitest run <file>` per task; definitive run `npx vitest run --no-file-parallelism`.
- Commits: Conventional Commits, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never push.
- Model tiering: tasks tagged Sonnet/Fable/Opus below.

## File Structure

- Modify: `src/lib/fileExtraction.ts` (+`pageTexts`), `src/lib/pdfSegments.ts` (+`splitPdfPageRuns`), `src/lib/visionExtraction.ts` (+`extractPagesViaVision`), `src/app/api/documents/process/route.ts` (hybrid merge), `src/types.ts` + `src/components/chat/DocumentCard.tsx` (`'hybrid'`), CLAUDE.md/CHANGELOG.
- Tests: extend `tests/unit/lib/fileExtraction.test.ts` (if absent, create), `tests/unit/lib/pdfSegments.test.ts`, `tests/unit/lib/visionExtraction.test.ts`, `tests/unit/api/documents-process.test.ts`.

---

### Task 1: `pageTexts` on the PDF text path — tier: Sonnet

**Files:** Modify `src/lib/fileExtraction.ts`; test `tests/unit/lib/fileExtraction.test.ts` (create if it does not exist; if it exists, append the new describe block following its conventions).

**Interfaces — Produces:** `ExtractionResult` gains `pageTexts?: string[]` (raw per-page text, index 0 = page 1, PDF path only, attached BEFORE any char-cap truncation of `text`). All other extractors leave it undefined.

- [ ] **Step 1: Failing test.** Add to `tests/unit/lib/fileExtraction.test.ts` (mock `unpdf` the way `visionExtraction.test.ts` mocks modules — `vi.resetModules()` + `vi.doMock` + dynamic import):

```ts
import { describe, it, expect, vi } from 'vitest'

describe('extractTextFromBuffer pageTexts', () => {
  it('attaches raw per-page text for PDFs', async () => {
    vi.resetModules()
    vi.doMock('unpdf', () => ({
      extractText: () => Promise.resolve({ totalPages: 3, text: ['page one text', 'p2', 'page three text'] }),
    }))
    const { extractTextFromBuffer } = await import('@/lib/fileExtraction')
    const out = await extractTextFromBuffer(Buffer.from('pdf'), 'pdf')
    expect(out.pageTexts).toEqual(['page one text', 'p2', 'page three text'])
    expect(out.text).toContain('page one text')
    expect(out.pageCount).toBe(3)
  })

  it('leaves pageTexts undefined for non-PDF', async () => {
    vi.resetModules()
    const { extractTextFromBuffer } = await import('@/lib/fileExtraction')
    const out = await extractTextFromBuffer(Buffer.from('plain text'), 'txt')
    expect(out.pageTexts).toBeUndefined()
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/unit/lib/fileExtraction.test.ts` → new test FAILS (`pageTexts` undefined for PDFs).
- [ ] **Step 3: Implement.** In `src/lib/fileExtraction.ts`: add `pageTexts?: string[]` to `ExtractionResult`. In the `pdf` branch of `extractTextFromBuffer`, after `const pages = Array.isArray(result.text) ? result.text : [String(result.text)]`, capture `pageTexts` and include it in the return: return `{ text, pageCount, pagesExtracted: null, partial: truncated, pageTexts: extension === 'pdf' ? pages : undefined }` — implement by declaring `let pageTexts: string[] | undefined` before the if/else, setting `pageTexts = pages` inside the pdf branch, and adding `pageTexts` to the return object.
- [ ] **Step 4:** Re-run test file → PASS. Run `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(rag): expose per-page text from the pdf extractor`.

---

### Task 2: `splitPdfPageRuns` — tier: Fable

**Files:** Modify `src/lib/pdfSegments.ts`; extend `tests/unit/lib/pdfSegments.test.ts`.

**Interfaces — Produces:** `splitPdfPageRuns(buffer: Buffer, pages: number[], opts?: { pagesPerSegment?: number; maxSegmentBytes?: number }): Promise<{ segments: PdfSegment[]; skippedPages: number }>` — `pages` is 1-based, deduped+sorted internally; contiguous runs are chunked at `pagesPerSegment` (default 20) and each chunk goes through the same byte-cap halving/skip as `splitPdfIntoSegments`.

- [ ] **Step 1: Failing tests.** Append to `tests/unit/lib/pdfSegments.test.ts` (reuse its `makePdf` helper):

```ts
import { splitPdfPageRuns } from '@/lib/pdfSegments'

describe('splitPdfPageRuns', () => {
  it('groups contiguous pages into run segments', async () => {
    const { segments, skippedPages } = await splitPdfPageRuns(await makePdf(10), [2, 3, 7, 8, 9])
    expect(skippedPages).toBe(0)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[2, 3], [7, 9]])
  })

  it('chunks a long run at pagesPerSegment', async () => {
    const { segments } = await splitPdfPageRuns(await makePdf(8), [1, 2, 3, 4, 5, 6], { pagesPerSegment: 4 })
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 4], [5, 6]])
  })

  it('sorts and dedupes the page list', async () => {
    const { segments } = await splitPdfPageRuns(await makePdf(6), [5, 2, 2, 4, 5])
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[2, 2], [4, 5]])
  })

  it('applies the byte cap with skip accounting', async () => {
    const { segments, skippedPages } = await splitPdfPageRuns(await makePdf(4), [1, 2], { maxSegmentBytes: 10 })
    expect(segments).toEqual([])
    expect(skippedPages).toBe(2)
  })
})
```

- [ ] **Step 2:** Run file → new tests FAIL (export missing). Existing 5 tests still pass.
- [ ] **Step 3: Implement.** Refactor minimally so the byte-cap recursion is shared: extract the current `emit` closure body into a module-level `async function emitRange(src, firstPage, lastPage, maxSegmentBytes, segments, onSkip)` used by both functions (preserve exact behavior — `splitPdfIntoSegments`'s existing tests are the guard), then:

```ts
export async function splitPdfPageRuns(
  buffer: Buffer,
  pages: number[],
  opts: { pagesPerSegment?: number; maxSegmentBytes?: number } = {},
): Promise<{ segments: PdfSegment[]; skippedPages: number }> {
  const maxSegmentBytes = opts.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES
  const per = Math.max(1, opts.pagesPerSegment ?? 20)
  const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })
  const pageCount = src.getPageCount()
  const wanted = [...new Set(pages)].filter(p => p >= 1 && p <= pageCount).sort((a, b) => a - b)

  const segments: PdfSegment[] = []
  let skippedPages = 0
  // walk contiguous runs
  let i = 0
  while (i < wanted.length) {
    let j = i
    while (j + 1 < wanted.length && wanted[j + 1] === wanted[j] + 1) j++
    const first = wanted[i]
    const last = wanted[j]
    for (let start = first; start <= last; start += per) {
      await emitRange(src, start, Math.min(start + per - 1, last), maxSegmentBytes, segments, () => { skippedPages++ })
    }
    i = j + 1
  }
  return { segments, skippedPages }
}
```

- [ ] **Step 4:** Run file → 9/9 PASS. `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(rag): split arbitrary pdf page runs into vision segments`.

---

### Task 3: `extractPagesViaVision` — tier: Fable

**Files:** Modify `src/lib/visionExtraction.ts`; extend `tests/unit/lib/visionExtraction.test.ts`.

**Interfaces — Consumes:** `splitPdfPageRuns` (Task 2). **Produces:** `extractPagesViaVision(buffer: Buffer, pages: number[]): Promise<{ segments: Array<{ firstPage: number; lastPage: number; text: string }>; failed: number; truncated: boolean }>` — one `generateText` per run segment (same prompt builder, cfg knobs, retry loop, and `mapWithConcurrency` bound as `extractViaVision`); a segment failed after retries or returning empty text counts in `failed` and is omitted from `segments`; no key → `{ segments: [], failed: 0, truncated: false }` without touching the PDF.

- [ ] **Step 1: Failing tests.** Append a describe block to `tests/unit/lib/visionExtraction.test.ts` (reuse `setup()`/mocks; add `const mockSplitRuns = vi.fn()` and mock `splitPdfPageRuns` alongside `splitPdfIntoSegments` in `setup()`'s `vi.doMock('@/lib/pdfSegments', ...)`):

```ts
describe('extractPagesViaVision', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockSplitRuns.mockReset(); process.env.EXTRACTION_SEGMENT_RETRIES = '0' })

  it('extracts each run segment and returns per-segment text', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 3), seg(7, 9)], skippedPages: 0 })
    mockGenerateText
      .mockResolvedValueOnce({ text: 'NOTES A', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'NOTES B', finishReason: 'stop' })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    const out = await extractPagesViaVision(Buffer.from('pdf'), [2, 3, 7, 8, 9])
    expect(out.segments).toEqual([
      { firstPage: 2, lastPage: 3, text: 'NOTES A' },
      { firstPage: 7, lastPage: 9, text: 'NOTES B' },
    ])
    expect(out.failed).toBe(0)
  })

  it('counts a failed run and omits it', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 3), seg(7, 9)], skippedPages: 0 })
    mockGenerateText
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ text: 'NOTES B', finishReason: 'stop' })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    const out = await extractPagesViaVision(Buffer.from('pdf'), [2, 3, 7, 8, 9])
    expect(out.segments).toEqual([{ firstPage: 7, lastPage: 9, text: 'NOTES B' }])
    expect(out.failed).toBe(1)
  })

  it('flags truncation', async () => {
    setup()
    mockSplitRuns.mockResolvedValue({ segments: [seg(2, 3)], skippedPages: 0 })
    mockGenerateText.mockResolvedValue({ text: 'PARTIAL NOTES', finishReason: 'length' })
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    expect((await extractPagesViaVision(Buffer.from('pdf'), [2, 3])).truncated).toBe(true)
  })

  it('returns empty without a key', async () => {
    setup(null)
    const { extractPagesViaVision } = await import('@/lib/visionExtraction')
    expect(await extractPagesViaVision(Buffer.from('pdf'), [2])).toEqual({ segments: [], failed: 0, truncated: false })
    expect(mockSplitRuns).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** Run file → new tests FAIL. Existing 7 still pass.
- [ ] **Step 3: Implement.** In `visionExtraction.ts`, refactor the per-segment call loop of `extractViaVision` into a shared helper `async function extractSegments(segments, cfg, apiKey)` returning `{ results: Array<{ seg, text }>, truncated }` (behavior identical — existing tests are the guard), then:

```ts
/** Vision-extract specific pages (contiguous runs) of a PDF — the hybrid path for
 * SHX/thin-text-layer sheets inside otherwise text-rich sets. Best-effort. */
export async function extractPagesViaVision(
  buffer: Buffer,
  pages: number[],
): Promise<{ segments: { firstPage: number; lastPage: number; text: string }[]; failed: number; truncated: boolean }> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey || pages.length === 0) return { segments: [], failed: 0, truncated: false }
  const c = cfg()
  const { segments } = await splitPdfPageRuns(buffer, pages, {
    pagesPerSegment: c.segmentPages, maxSegmentBytes: c.segmentMaxBytes,
  })
  const { results, truncated } = await extractSegments(segments, c, apiKey)
  const ok = results.filter(r => r.text)
  return {
    segments: ok.map(r => ({ firstPage: r.seg.firstPage, lastPage: r.seg.lastPage, text: r.text })),
    failed: results.length - ok.length,
    truncated,
  }
}
```

- [ ] **Step 4:** Run file → 11/11 PASS. Full lib dir + typecheck clean.
- [ ] **Step 5: Commit** `feat(rag): vision-extract targeted page runs (hybrid path)`.

---

### Task 4: Route hybrid merge + `'hybrid'` type/UI — tier: Opus

**Files:** Modify `src/app/api/documents/process/route.ts`, `src/types.ts`, `src/components/chat/DocumentCard.tsx`; extend `tests/unit/api/documents-process.test.ts`. READ each file first and adapt to its current shape (the route gained a try/catch around the vision fallback in d95c0ed).

**Interfaces — Consumes:** `extraction.pageTexts` (Task 1), `extractPagesViaVision` (Task 3). **Produces:** `extractionMethod` may now be `'hybrid'`; no API contract change otherwise.

- [ ] **Step 1: Failing tests.** Add to the route test file (mirror the existing mock/req patterns; add `extractPagesViaVision` to the `@/lib/visionExtraction` mock object):

```ts
it('hybrid: sparse pages inside a dense doc are vision-spliced, method hybrid', async () => {
  // 3 pages: page 2 is title-block-thin (<500), pages 1/3 dense
  m.extractTextFromBuffer.mockResolvedValue(extRes('D'.repeat(4000), {
    pageCount: 3, pageTexts: ['D'.repeat(2000), 'thin', 'E'.repeat(2000)],
  }))
  m.extractPagesViaVision.mockResolvedValue({ segments: [{ firstPage: 2, lastPage: 2, text: 'VISION NOTES BODY' }], failed: 0, truncated: false })
  const res = await POST(req(30) as never)
  expect(res.status).toBe(200)
  expect(m.extractPagesViaVision).toHaveBeenCalledWith(expect.anything(), [2])
  const call = m.updateDocumentStatus.mock.calls.find((c: unknown[]) => c[1] === 'ready')
  expect(call?.[2]).toMatchObject({ extractionMethod: 'hybrid' })
})

it('hybrid: a failed run keeps the thin text and flags partial', async () => {
  m.extractTextFromBuffer.mockResolvedValue(extRes('D'.repeat(4000), {
    pageCount: 3, pageTexts: ['D'.repeat(2000), 'thin', 'E'.repeat(2000)],
  }))
  m.extractPagesViaVision.mockResolvedValue({ segments: [], failed: 1, truncated: false })
  const res = await POST(req(31) as never)
  expect(res.status).toBe(200)
  const call = m.updateDocumentStatus.mock.calls.find((c: unknown[]) => c[1] === 'ready')
  expect(call?.[2]).toMatchObject({ extractionMethod: 'text', partial: true })
})
```

(Adapt `extRes`, `req`, ids, and the exact `updateDocumentStatus` assertion shape to the file's existing conventions — e.g. if `partial` threads via `ingestText` options rather than `updateDocumentStatus`, assert on the mocked `ingestText` call instead. Intent governs: hybrid success → method `hybrid`; hybrid run-failure → method stays `text`, partial true, thin text retained.)

- [ ] **Step 2:** Run route tests → new ones FAIL (extractPagesViaVision never called).
- [ ] **Step 3: Implement route.** Module-level next to the other knobs:

```ts
const HYBRID_MIN_CHARS = Number(process.env.EXTRACTION_HYBRID_PAGE_MIN_CHARS) || 500
const HYBRID_MAX_PAGES = Number(process.env.EXTRACTION_HYBRID_MAX_PAGES) || 80
```

After the existing vision-fallback block (only when `extractionMethod` is still `'text'` and `extraction.pageTexts` exists), non-fatal like the vision fallback:

```ts
// Per-page hybrid: a text-rich set can still contain SHX sheets whose notes text
// is stroke geometry (title-block-only text layer). Vision-extract just those
// pages and splice them in — never fatal, plain text path survives any failure.
if (ext === 'pdf' && extractionMethod === 'text' && extraction.pageTexts) {
  const sparse = extraction.pageTexts
    .map((t, i) => ({ page: i + 1, len: t.trim().length }))
    .filter(p => p.len < HYBRID_MIN_CHARS)
    .map(p => p.page)
  if (sparse.length > 0 && sparse.length <= HYBRID_MAX_PAGES) {
    try {
      const hybrid = await extractPagesViaVision(buffer, sparse)
      if (hybrid.segments.length > 0) {
        const byStart = new Map(hybrid.segments.map(s => [s.firstPage, s]))
        const covered = new Set(hybrid.segments.flatMap(s =>
          Array.from({ length: s.lastPage - s.firstPage + 1 }, (_, k) => s.firstPage + k)))
        const parts: string[] = []
        extraction.pageTexts.forEach((t, i) => {
          const page = i + 1
          const seg = byStart.get(page)
          if (seg) parts.push(seg.text)
          else if (!covered.has(page)) parts.push(t)
        })
        textContent = parts.join('\n')
        extractionMethod = 'hybrid'
      }
      if (hybrid.failed > 0 || hybrid.truncated) extraction = { ...extraction, partial: true }
    } catch (e) {
      console.warn('[documents/process] hybrid extraction failed:', e instanceof Error ? e.message : e)
    }
  } else if (sparse.length > HYBRID_MAX_PAGES) {
    console.warn(`[documents/process] ${sparse.length} sparse pages > cap ${HYBRID_MAX_PAGES} — hybrid skipped`)
  }
}
```

Then ensure the existing `DOCUMENT_MAX_CHARS` re-cap still runs AFTER this block (it already sits below the extraction section — verify order). Import `extractPagesViaVision`.

- [ ] **Step 4: Types/UI.** `src/types.ts`: widen the `extractionMethod` union to `'text' | 'vision' | 'hybrid'` wherever it is typed (search repo for `'vision'` unions — expect `types.ts`, possibly the route/actions). `DocumentCard.tsx`: render the existing chip style with label `hybrid` when `extractionMethod === 'hybrid'` (same visual treatment as the `vision` chip).
- [ ] **Step 5:** Route tests all green; `npm run typecheck` 0; `npx vitest run tests/unit/ --no-file-parallelism` green.
- [ ] **Step 6: Commit** `feat(rag): per-page hybrid extraction splices vision text into sparse sheets`.

---

### Task 5: Docs + full gate — tier: Sonnet

- [ ] **Step 1:** CLAUDE.md: in the vision-extraction paragraph, append two sentences describing hybrid: per-page splice for SHX/thin sheets inside text-rich sets, `EXTRACTION_HYBRID_PAGE_MIN_CHARS` (500) / `EXTRACTION_HYBRID_MAX_PAGES` (80) knobs, `extraction_method: 'hybrid'`.
- [ ] **Step 2:** CHANGELOG 4.46.0 entry (mirror 4.45.0 format): hybrid per-page extraction, the Drover SHX diagnosis as motivation, knobs, `hybrid` chip, no migration.
- [ ] **Step 3:** Full gate: typecheck 0 / lint 0 err / build / `npx vitest run --no-file-parallelism` all green.
- [ ] **Step 4: Commit** `docs: describe per-page hybrid extraction (rag phase 2b)`.

---

## After all tasks

Final whole-branch review (Opus) → user-gated release: merge `--no-ff` → `npm version minor` (4.46.0) → tag → push → `gh release create` → CI → Vercel. Then **Replace the Drover document** in the app: expect `hybrid` chip and the Civil General Notes retrievable in chat.
