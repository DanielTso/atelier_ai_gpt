# RAG Phase 2: Extraction Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-page raster+call vision extraction with native-PDF segment extraction so 95 MB / 160-page construction plan sets ingest reliably, and fix the vision trigger so sparse-text plan sets actually reach it.

**Architecture:** Split large PDFs into ~20-page segments with `pdf-lib` (each far under Gemini's 50 MB-per-PDF request cap), send each segment **inline** as an AI SDK `file` part in ONE `generateText` call (bounded concurrency 2 + retry), and join results in page order. Vision fallback now triggers on per-page text density, not just an absolute floor. The Phase 1 `ExtractionResult{text,pageCount,pagesExtracted,partial}` contract and all `partial` semantics are preserved.

**Tech Stack:** Next.js 16 App Router, TypeScript, AI SDK v6 (`ai` + `@ai-sdk/google`), `pdf-lib` (existing dep), Vitest.

**Spec:** `docs/specs/2026-07-07-rag-phase2-extraction-upgrade-design.md` (approved). **Target release:** v4.45.0. **Branch:** `feat/rag-phase2-extraction` off `master`.

## Global Constraints

- **Code style:** hand-written **single-quote, no-semicolon**; match the file you are in. **NEVER run `prettier --write`** (no Prettier config exists; it would reformat whole files).
- **No new dependencies.** `pdf-lib` is already a dependency (artifact engine). `pdfjs-dist` + `@napi-rs/canvas` STAY installed (thumbnails use them) but are removed from `src/lib/visionExtraction.ts`.
- **No DB schema change, no migration.** Chunking, embeddings (`gemini-embedding-001` @ 768), `embedChunks`, the replace flow, `extracted.txt` persistence, and all `partial` UI surfaces are untouched.
- **AI SDK v6 naming:** `maxOutputTokens` (not `maxTokens`); file parts are `{ type: 'file', data, mediaType }` (`mediaType`, not `mimeType`).
- Extraction model default stays **`gemini-3.5-flash`** (env `EXTRACTION_MODEL`).
- Env knobs (exact names/defaults): `EXTRACTION_MAX_PAGES` **500** (was 60), `EXTRACTION_SEGMENT_PAGES` **20** (new), `EXTRACTION_SEGMENT_CONCURRENCY` **2** (new), `EXTRACTION_SEGMENT_MAX_BYTES` **47185920** (45 MB, new), `EXTRACTION_MAX_OUTPUT_TOKENS` **60000** (was 8000), `EXTRACTION_SEGMENT_RETRIES` **2** (new), `EXTRACTION_MIN_TEXT_CHARS` **100** (unchanged), `EXTRACTION_MIN_CHARS_PER_PAGE` **200** (new). `EXTRACTION_RENDER_SCALE` is **removed**.
- Tests: `npx vitest run <file>` per task; the definitive full run is `npx vitest run --no-file-parallelism` (parallel PGlite flake is known).
- Commits: Conventional Commits, imperative lowercase, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Commit to the feature branch; **never push** (user-gated).
- **Model tiering (user directive):** each task is tagged Fable / Opus / Sonnet below.

## File Structure

- `src/lib/concurrency.ts` — **new**: shared `mapWithConcurrency` (moved out of `embedChunks.ts`)
- `src/lib/pdfSegments.ts` — **new**: pdf-lib page-range splitting with size guard + page cap
- `src/lib/visionExtraction.ts` — **rework**: segment extraction replaces the per-page render loop; `extractViaVisionImage` unchanged
- `src/app/api/documents/process/route.ts` — **modify**: per-page density gate for the vision fallback
- `tests/unit/lib/concurrency.test.ts`, `tests/unit/lib/pdfSegments.test.ts` — **new**
- `tests/unit/lib/visionExtraction.test.ts` — **rewrite**; `tests/unit/api/documents-process.test.ts` — **extend**
- `CLAUDE.md`, `CHANGELOG.md` — **modify** (docs)

---

### Task 1: Shared bounded-concurrency pool (`src/lib/concurrency.ts`) — tier: Sonnet

`embedChunks.ts` has a private `mapWithConcurrency`. Task 3 needs the same pool. Extract it to a shared module (DRY), re-import in `embedChunks.ts`, behavior identical.

**Files:**
- Create: `src/lib/concurrency.ts`
- Modify: `src/lib/embedChunks.ts` (delete its local `mapWithConcurrency` at lines 31–49, import instead)
- Test: `tests/unit/lib/concurrency.test.ts`

**Interfaces:**
- Produces: `mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]>` — preserves index order; at most `concurrency` in flight; clamps to `[1, items.length]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/concurrency.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '@/lib/concurrency'

describe('mapWithConcurrency', () => {
  it('preserves index order regardless of completion order', async () => {
    const delays = [30, 0, 10]
    const out = await mapWithConcurrency(delays, 3, async (d, i) => {
      await new Promise(r => setTimeout(r, d))
      return `item-${i}`
    })
    expect(out).toEqual(['item-0', 'item-1', 'item-2'])
  })

  it('never exceeds the concurrency bound', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/concurrency.test.ts`
Expected: FAIL — cannot resolve `@/lib/concurrency`.

- [ ] **Step 3: Create `src/lib/concurrency.ts`**

Move the function verbatim from `embedChunks.ts:31-49`, exported:

```ts
// Bounded worker pool: at most `concurrency` tasks in flight; preserves index order.
// Shared by embedding (embedChunks) and segment vision extraction (visionExtraction).
export async function mapWithConcurrency<T, R>(
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
```

- [ ] **Step 4: Update `src/lib/embedChunks.ts`**

Delete its local `mapWithConcurrency` (the comment line `// Bounded worker pool...` through the closing brace, lines 31–49) and add to the imports at the top:

```ts
import { mapWithConcurrency } from '@/lib/concurrency'
```

Nothing else in the file changes.

- [ ] **Step 5: Run new + existing tests**

Run: `npx vitest run tests/unit/lib/concurrency.test.ts tests/unit/lib/ --no-file-parallelism`
Expected: concurrency tests PASS; all existing `tests/unit/lib/` tests (incl. embed/ingest) still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/concurrency.ts src/lib/embedChunks.ts tests/unit/lib/concurrency.test.ts
git commit -m "refactor(lib): extract shared bounded-concurrency pool" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PDF segmentation (`src/lib/pdfSegments.ts`) — tier: Fable

Split a PDF into page-range segments with pdf-lib. Enforces the page cap and the per-segment byte cap (recursive halving; a single page over the cap is skipped and counted).

**Files:**
- Create: `src/lib/pdfSegments.ts`
- Test: `tests/unit/lib/pdfSegments.test.ts`

**Interfaces:**
- Produces:
  - `interface PdfSegment { bytes: Uint8Array; firstPage: number; lastPage: number }` (1-based inclusive absolute page numbers)
  - `splitPdfIntoSegments(buffer: Buffer, pagesPerSegment: number, opts?: { maxPages?: number; maxSegmentBytes?: number }): Promise<{ segments: PdfSegment[]; pageCount: number; skippedPages: number }>`
  - `pageCount` = total pages in the source PDF. Segments cover pages `1..min(pageCount, maxPages)` except skipped ones. `skippedPages` = pages dropped because even a single-page segment exceeded `maxSegmentBytes`.
- Consumes: nothing from other tasks. Uses `pdf-lib` (`PDFDocument.load(..., { ignoreEncryption: true })`, `copyPages`, `save`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/pdfSegments.test.ts`. Fixtures are built in-test with pdf-lib (real parsing, no mocks):

```ts
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { splitPdfIntoSegments } from '@/lib/pdfSegments'

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200])
    page.drawText(`page ${i + 1}`, { x: 20, y: 100 })
  }
  return Buffer.from(await doc.save())
}

describe('splitPdfIntoSegments', () => {
  it('splits 5 pages into 2-page segments with a remainder', async () => {
    const { segments, pageCount, skippedPages } = await splitPdfIntoSegments(await makePdf(5), 2)
    expect(pageCount).toBe(5)
    expect(skippedPages).toBe(0)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 2], [3, 4], [5, 5]])
    // each segment is a real, loadable PDF with the right page count
    const seg0 = await PDFDocument.load(segments[0].bytes)
    expect(seg0.getPageCount()).toBe(2)
  })

  it('one-page doc yields one segment', async () => {
    const { segments, pageCount } = await splitPdfIntoSegments(await makePdf(1), 20)
    expect(pageCount).toBe(1)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 1]])
  })

  it('applies the page cap before splitting', async () => {
    const { segments, pageCount } = await splitPdfIntoSegments(await makePdf(5), 2, { maxPages: 3 })
    expect(pageCount).toBe(5)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 2], [3, 3]])
  })

  it('recursively halves an oversize segment down to single pages', async () => {
    // Establish a threshold between a 1-page and a 4-page segment size.
    const onePage = await splitPdfIntoSegments(await makePdf(1), 1)
    const onePageBytes = onePage.segments[0].bytes.length
    const { segments, skippedPages } = await splitPdfIntoSegments(await makePdf(4), 4, {
      maxSegmentBytes: onePageBytes + 200, // 4-page segment is over; single pages are under
    })
    expect(skippedPages).toBe(0)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]])
  })

  it('skips (and counts) single pages that exceed the byte cap', async () => {
    const { segments, skippedPages } = await splitPdfIntoSegments(await makePdf(3), 2, { maxSegmentBytes: 10 })
    expect(segments).toEqual([])
    expect(skippedPages).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/pdfSegments.test.ts`
Expected: FAIL — cannot resolve `@/lib/pdfSegments`.

- [ ] **Step 3: Implement `src/lib/pdfSegments.ts`**

```ts
// Split a PDF into page-range segments for native Gemini document extraction.
// Gemini caps PDFs at 50MB per REQUEST (inline and Files API alike), and dense
// transcription output for a whole plan set exceeds the 65K output cap — so
// extraction is segmented: each segment is a small standalone PDF built with
// pdf-lib, sent inline in its own generateText call.
import { PDFDocument } from 'pdf-lib'

export interface PdfSegment {
  bytes: Uint8Array
  firstPage: number // 1-based, absolute in the source document
  lastPage: number // inclusive
}

const DEFAULT_MAX_SEGMENT_BYTES = 45 * 1024 * 1024 // headroom under Gemini's 50MB PDF cap

async function buildSegment(src: PDFDocument, firstPage: number, lastPage: number): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const indices = Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage - 1 + i)
  const pages = await out.copyPages(src, indices)
  for (const p of pages) out.addPage(p)
  return out.save()
}

export async function splitPdfIntoSegments(
  buffer: Buffer,
  pagesPerSegment: number,
  opts: { maxPages?: number; maxSegmentBytes?: number } = {},
): Promise<{ segments: PdfSegment[]; pageCount: number; skippedPages: number }> {
  const maxSegmentBytes = opts.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES
  const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })
  const pageCount = src.getPageCount()
  const limit = Math.min(pageCount, Math.max(1, opts.maxPages ?? pageCount))
  const per = Math.max(1, pagesPerSegment)

  const segments: PdfSegment[] = []
  let skippedPages = 0

  // Emit the range [first, last]; if its serialized bytes exceed the cap, halve
  // recursively. A single page still over the cap is skipped and counted — the
  // caller surfaces it as partial (no silent loss).
  async function emit(firstPage: number, lastPage: number): Promise<void> {
    const bytes = await buildSegment(src, firstPage, lastPage)
    if (bytes.length <= maxSegmentBytes) {
      segments.push({ bytes, firstPage, lastPage })
      return
    }
    if (firstPage === lastPage) {
      console.warn(`[pdfSegments] page ${firstPage} exceeds ${maxSegmentBytes} bytes — skipped`)
      skippedPages++
      return
    }
    const mid = Math.floor((firstPage + lastPage) / 2)
    await emit(firstPage, mid)
    await emit(mid + 1, lastPage)
  }

  for (let first = 1; first <= limit; first += per) {
    await emit(first, Math.min(first + per - 1, limit))
  }
  return { segments, pageCount, skippedPages }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/pdfSegments.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdfSegments.ts tests/unit/lib/pdfSegments.test.ts
git commit -m "feat(rag): add pdf page-range segmentation with byte-cap guard" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Native segment extraction (rework `src/lib/visionExtraction.ts`) — tier: Fable

Replace the per-page render loop with: split (Task 2) → one `generateText` per segment with the PDF inline → bounded-concurrent (Task 1) with retry → join in order. Deletes `pdfjs-dist`/`unpdf`/`@napi-rs/canvas` usage from this file. `extractViaVisionImage` is unchanged.

**Files:**
- Modify: `src/lib/visionExtraction.ts` (full rework of `extractViaVision` + `cfg()`; keep `extractImage` + `extractViaVisionImage` as-is)
- Test: `tests/unit/lib/visionExtraction.test.ts` (rewrite the `extractViaVision` describe block; keep the image test)

**Interfaces:**
- Consumes: `splitPdfIntoSegments(buffer, pagesPerSegment, { maxPages, maxSegmentBytes })` → `{ segments: PdfSegment[], pageCount, skippedPages }` (Task 2); `mapWithConcurrency(items, concurrency, task)` (Task 1); existing `getGeminiApiKey()` and `ExtractionResult` from `@/lib/fileExtraction`.
- Produces: `extractViaVision(buffer: Buffer): Promise<ExtractionResult>` — same signature and contract as today (Task 4's route change relies on it being drop-in).

- [ ] **Step 1: Rewrite the failing tests**

Replace `tests/unit/lib/visionExtraction.test.ts` with (image test preserved at the end):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockSplit = vi.fn()

const seg = (firstPage: number, lastPage: number) => ({ bytes: new Uint8Array([1]), firstPage, lastPage })

function setup(key: string | null = 'k') {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
  vi.doMock('@/lib/pdfSegments', () => ({ splitPdfIntoSegments: (...a: unknown[]) => mockSplit(...a) }))
}

describe('extractViaVision (segmented)', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
    mockSplit.mockReset()
    process.env.EXTRACTION_SEGMENT_RETRIES = '0' // keep failure tests fast
  })

  it('sends one call per segment with the pdf inline and joins in page order', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2), seg(3, 4)], pageCount: 4, skippedPages: 0 })
    mockGenerateText
      .mockResolvedValueOnce({ text: 'SEG ONE', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'SEG TWO', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text.indexOf('SEG ONE')).toBeLessThan(out.text.indexOf('SEG TWO'))
    expect(out).toMatchObject({ pageCount: 4, pagesExtracted: 4, partial: false })
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
    const content = mockGenerateText.mock.calls[0][0].messages[0].content
    expect(content[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' })
    // prompt carries the absolute page range so headings use real page numbers
    expect(content[0].text).toContain('pages 1-2')
  })

  it('returns empty result without touching the pdf when no API key', async () => {
    setup(null)
    const { extractViaVision } = await import('@/lib/visionExtraction')
    expect((await extractViaVision(Buffer.from('pdf'))).text).toBe('')
    expect(mockSplit).not.toHaveBeenCalled()
  })

  it('a segment that fails after retries drops its pages and flags partial', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2), seg(3, 4)], pageCount: 4, skippedPages: 0 })
    mockGenerateText
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ text: 'SEG TWO', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text).toBe('SEG TWO')
    expect(out).toMatchObject({ pagesExtracted: 2, partial: true })
  })

  it('retries a failed segment before giving up', async () => {
    process.env.EXTRACTION_SEGMENT_RETRIES = '1'
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 2, skippedPages: 0 })
    mockGenerateText
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ text: 'RECOVERED', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text).toBe('RECOVERED')
    expect(out.partial).toBe(false)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  it('output truncation (finishReason length) keeps text but flags partial', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 2, skippedPages: 0 })
    mockGenerateText.mockResolvedValue({ text: 'TRUNCATED TEXT', finishReason: 'length' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out.text).toBe('TRUNCATED TEXT')
    expect(out.partial).toBe(true)
  })

  it('skipped pages from the splitter flag partial', async () => {
    setup()
    mockSplit.mockResolvedValue({ segments: [seg(1, 2)], pageCount: 3, skippedPages: 1 })
    mockGenerateText.mockResolvedValue({ text: 'OK', finishReason: 'stop' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out).toMatchObject({ pageCount: 3, pagesExtracted: 2, partial: true })
  })
})

describe('extractViaVisionImage', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockSplit.mockReset() })

  it('sends a single image directly', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: 'IMAGE TEXT' })
    const { extractViaVisionImage } = await import('@/lib/visionExtraction')
    const out = await extractViaVisionImage(Buffer.from('img'), 'image/png')
    expect(out.text).toBe('IMAGE TEXT')
    expect(out.pageCount).toBe(1)
    expect(mockSplit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/visionExtraction.test.ts`
Expected: FAIL — current implementation mocks `unpdf` (removed), renders pages, and never calls `splitPdfIntoSegments`.

- [ ] **Step 3: Rework `src/lib/visionExtraction.ts`**

Full new content (keeps `extractImage` + `extractViaVisionImage`; single-quote, no semicolons):

```ts
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'
import { splitPdfIntoSegments } from './pdfSegments'
import { mapWithConcurrency } from './concurrency'
import type { ExtractionResult } from './fileExtraction'

const IMAGE_PROMPT =
  'You are reading a single page of a construction document (plan/drawing/schedule). ' +
  'Transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
  'notes, callouts, and any schedule/table contents (preserve table structure as markdown). ' +
  'Then add a short paragraph describing what the drawing depicts. Do not invent content.'

function segmentPrompt(firstPage: number, lastPage: number): string {
  return (
    `You are reading pages ${firstPage}-${lastPage} of a construction document (plans/drawings/schedules/contract). ` +
    'For EACH page: transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
    'notes, callouts, and any schedule/table contents (preserve table structure as markdown) — then add a short ' +
    'paragraph describing what the page depicts. ' +
    `Start each page with a heading line "# Page <n>" using the page's ABSOLUTE number: the first page of this file is page ${firstPage}. ` +
    'Do not invent content.'
  )
}

function num(v: string | undefined, d: number) { const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d }

function cfg() {
  return {
    model: process.env.EXTRACTION_MODEL || 'gemini-3.5-flash',
    maxPages: num(process.env.EXTRACTION_MAX_PAGES, 500),
    segmentPages: num(process.env.EXTRACTION_SEGMENT_PAGES, 20),
    segmentConcurrency: num(process.env.EXTRACTION_SEGMENT_CONCURRENCY, 2),
    segmentMaxBytes: num(process.env.EXTRACTION_SEGMENT_MAX_BYTES, 45 * 1024 * 1024),
    maxOutputTokens: num(process.env.EXTRACTION_MAX_OUTPUT_TOKENS, 60000),
    retries: num(process.env.EXTRACTION_SEGMENT_RETRIES, 2),
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function extractImage(image: Uint8Array, model: string, maxOutputTokens: number, apiKey: string): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({
    model: google(model),
    messages: [{ role: 'user', content: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image', image }] }],
    maxOutputTokens,
  })
  return text.trim()
}

/**
 * Native-PDF segment extraction: split into page-range segments (each far under
 * Gemini's 50MB-per-request PDF cap), one generateText call per segment with the
 * segment inline as a file part, bounded-concurrent with retry. Gemini reads the
 * embedded text layer natively AND sees each page as an image — no rasterizing.
 * Best-effort; empty result if no key. Fidelity: a failed segment, a skipped
 * oversize page, output truncation, or the page cap all surface as partial.
 */
export async function extractViaVision(buffer: Buffer): Promise<ExtractionResult> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return { text: '', pageCount: null, pagesExtracted: null, partial: false }
  const { model, maxPages, segmentPages, segmentConcurrency, segmentMaxBytes, maxOutputTokens, retries } = cfg()
  const { segments, pageCount, skippedPages } = await splitPdfIntoSegments(buffer, segmentPages, {
    maxPages, maxSegmentBytes: segmentMaxBytes,
  })
  if (pageCount > maxPages) console.warn(`[visionExtraction] capping at ${maxPages}/${pageCount} pages`)
  const google = createGoogleGenerativeAI({ apiKey })

  let truncated = false
  const results = await mapWithConcurrency(segments, segmentConcurrency, async seg => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { text, finishReason } = await generateText({
          model: google(model),
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: segmentPrompt(seg.firstPage, seg.lastPage) },
              { type: 'file', data: seg.bytes, mediaType: 'application/pdf' },
            ],
          }],
          maxOutputTokens,
        })
        if (finishReason === 'length') {
          console.warn(`[visionExtraction] segment ${seg.firstPage}-${seg.lastPage} hit the output cap`)
          truncated = true
        }
        return { seg, text: text.trim() }
      } catch (err) {
        if (attempt === retries) {
          console.warn(`[visionExtraction] segment ${seg.firstPage}-${seg.lastPage} failed:`, err instanceof Error ? err.message : err)
          return { seg, text: '' }
        }
        await sleep(500 * 2 ** attempt)
      }
    }
    return { seg, text: '' }
  })

  const ok = results.filter(r => r.text)
  const pagesExtracted = ok.reduce((n, r) => n + (r.seg.lastPage - r.seg.firstPage + 1), 0)
  return {
    text: ok.map(r => r.text).join('\n\n'),
    pageCount,
    pagesExtracted,
    partial: truncated || skippedPages > 0 || pagesExtracted < pageCount,
  }
}

/** Vision-extract a single uploaded image. Best-effort; empty result if no key. */
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

Note: `EXTRACTION_MAX_OUTPUT_TOKENS` also feeds `extractViaVisionImage` — 60000 is fine there (single image can't produce that much; it's a ceiling, not a target).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/visionExtraction.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 5: Check nothing else imported the removed internals**

Run: `npx vitest run tests/unit/ --no-file-parallelism` and `npm run typecheck`
Expected: all PASS / 0 errors (the process-route tests mock `@/lib/visionExtraction` wholesale, so they are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/lib/visionExtraction.ts tests/unit/lib/visionExtraction.test.ts
git commit -m "feat(rag): native-pdf segment vision extraction replaces per-page raster" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Per-page density gate (`src/app/api/documents/process/route.ts`) — tier: Opus

A 120-page CAD set with a few hundred chars of title-block text never reaches vision today (absolute `< 100` chars gate). Add a per-page density condition. The better-of-both guard (vision output only replaces text output when longer) stays.

**Files:**
- Modify: `src/app/api/documents/process/route.ts` (the gate at lines 20 and 87)
- Test: `tests/unit/api/documents-process.test.ts` (add 2 cases)

**Interfaces:**
- Consumes: `extractViaVision(buffer)` (Task 3, drop-in same signature); `extraction.pageCount` from `extractTextFromBuffer` (already returned for PDFs via unpdf `totalPages`).
- Produces: no API contract change.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/api/documents-process.test.ts`, add after the existing `'thin-text PDF falls back to vision'` test (reuse the file's existing `m` mocks, `extRes` helper, and request-builder exactly as the neighboring tests do — read them first):

```ts
it('sparse-per-page PDF (plan set) falls back to vision via the density gate', async () => {
  // 120 pages, 5000 chars total ≈ 42 chars/page — passes the absolute floor (>=100)
  // but fails the 200 chars/page density gate.
  m.extractTextFromBuffer.mockResolvedValue(extRes('T'.repeat(5000), { pageCount: 120 }))
  m.extractViaVision.mockResolvedValue(extRes('V'.repeat(6000), { pageCount: 120, pagesExtracted: 120 }))
  const res = await postProcess({ documentId: 9 })
  expect(res.status).toBe(200)
  expect(m.extractViaVision).toHaveBeenCalled()
  expect(m.updateDocumentStatus).toHaveBeenCalledWith(9, 'ready', expect.objectContaining({ extractionMethod: 'vision' }))
})

it('dense text PDF (contract) does NOT trigger the vision fallback', async () => {
  // 10 pages, 20000 chars ≈ 2000 chars/page — clears both gates.
  m.extractTextFromBuffer.mockResolvedValue(extRes('T'.repeat(20000), { pageCount: 10 }))
  const res = await postProcess({ documentId: 9 })
  expect(res.status).toBe(200)
  expect(m.extractViaVision).not.toHaveBeenCalled()
})
```

(If the file's helper names differ — e.g. the POST invocation is built inline per test — copy the invocation pattern of the `'thin-text PDF falls back to vision'` test verbatim and only change the mock setups and assertions as above.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/unit/api/documents-process.test.ts`
Expected: the sparse-per-page test FAILS (vision not called — density gate doesn't exist yet); the dense-contract test passes already (it documents the boundary).

- [ ] **Step 3: Implement the density gate**

In `src/app/api/documents/process/route.ts`, next to `MIN_TEXT` (line 20) add:

```ts
const MIN_CHARS_PER_PAGE = Number(process.env.EXTRACTION_MIN_CHARS_PER_PAGE) || 200
```

Replace the gate at line 87:

```ts
if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
```

with:

```ts
// Vision fallback when the text layer is thin ABSOLUTELY (scanned doc) or thin
// PER PAGE (CAD plan set: 120 pages of drawings with only title-block text —
// enough chars to pass an absolute floor, but the drawings were never read).
const trimmedLen = textContent.trim().length
const sparsePerPage = extraction.pageCount != null && extraction.pageCount > 0 &&
  trimmedLen / extraction.pageCount < MIN_CHARS_PER_PAGE
if (ext === 'pdf' && (trimmedLen < MIN_TEXT || sparsePerPage)) {
```

The body of the `if` (call `extractViaVision`, keep the longer output) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api/documents-process.test.ts`
Expected: ALL PASS (new 2 + all pre-existing, incl. `'thin-text PDF falls back to vision'` and the partial-threading cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documents/process/route.ts tests/unit/api/documents-process.test.ts
git commit -m "feat(rag): per-page density gate routes sparse-text plan sets to vision" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs + full verification gate — tier: Sonnet

**Files:**
- Modify: `CLAUDE.md` (the "Vision-extraction fallback (Phase C2)" paragraph under Architecture Overview)
- Modify: `CHANGELOG.md` (new 4.45.0 entry at the top, matching the existing entry format — read the 4.44.0 entry first and mirror its structure)

- [ ] **Step 1: Update CLAUDE.md**

Replace the paragraph beginning `**Vision-extraction fallback (Phase C2)**` with:

```markdown
**Vision extraction (Phase C2, reworked in RAG Phase 2 v4.45.0)** — `src/lib/visionExtraction.ts` handles two paths: `extractViaVision(buffer)` splits the PDF into page-range segments via `src/lib/pdfSegments.ts` (**pdf-lib**; default 20 pages/segment, each kept under Gemini's 50MB-per-request PDF cap with recursive halving) and sends each segment **inline as a native PDF** (`file` part) in one Gemini call — bounded concurrency (`src/lib/concurrency.ts`) + retry; Gemini reads the embedded text layer natively and sees each page as an image (no per-page rasterizing; `pdfjs-dist`/`@napi-rs/canvas` remain only for thumbnails). `extractViaVisionImage(buffer, mimeType)` vision-extracts a single image. Both degrade to `''` if no Gemini key. The vision fallback triggers on thin text **absolute** (`EXTRACTION_MIN_TEXT_CHARS`, default `100`) **or per page** (`EXTRACTION_MIN_CHARS_PER_PAGE`, default `200` — catches CAD plan sets whose only text layer is title blocks). Env knobs: `EXTRACTION_MODEL` (default `gemini-3.5-flash`), `EXTRACTION_MAX_PAGES` (default `500`), `EXTRACTION_SEGMENT_PAGES` (default `20`), `EXTRACTION_SEGMENT_CONCURRENCY` (default `2`), `EXTRACTION_SEGMENT_MAX_BYTES` (default 45MB), `EXTRACTION_MAX_OUTPUT_TOKENS` (default `60000`; `finishReason==='length'` flags the doc partial), `EXTRACTION_SEGMENT_RETRIES` (default `2`). A failed segment, skipped oversize page, output truncation, or page-capping all surface as `extraction_partial` — never silent. Once text is extracted the downstream chunk → embed → pgvector RAG pipeline is unchanged.
```

Also remove the now-stale `EXTRACTION_RENDER_SCALE` mention anywhere else in CLAUDE.md if present (search for it).

- [ ] **Step 2: Add the CHANGELOG entry**

Add a `## [4.45.0]` section at the top following the file's existing format, covering: native-PDF segment extraction (pdf-lib splitting, inline file parts, bounded concurrency + retry, per-page raster loop removed), the per-page density vision gate, page cap 60→500, output cap 8000→60000/segment, new env knobs, `EXTRACTION_RENDER_SCALE` removed, no migration.

- [ ] **Step 3: Run the full verification gate**

```bash
npm run typecheck   # expect 0 errors
npm run lint        # expect 0 errors (~25 baseline warnings fine)
npm run build       # expect success
npx vitest run --no-file-parallelism   # definitive full suite — expect all green
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: describe segmented native-pdf vision extraction (rag phase 2)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## After all tasks

Release is **user-gated** (do not do this without explicit approval): merge `--no-ff` to `master` → `npm version minor` (4.45.0) → tag → push `--follow-tags` → `gh release create` → watch CI → Vercel auto-deploys. No migration to apply. Then the **manual prod smoke** from the spec: upload the real 95 MB/160-page plan set; expect `ready` + `vision` badge, no `Partial` badge, retrieval hit on a known sheet note.
