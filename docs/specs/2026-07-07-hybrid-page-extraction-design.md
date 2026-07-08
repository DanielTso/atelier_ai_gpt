# RAG Phase 2b: Per-Page Hybrid Extraction (design spec)

- **Date:** 2026-07-07
- **Status:** Approved (user "word", after live failure diagnosis on the Drover set)
- **Target release:** v4.46.0
- **Program:** Follow-up to Phase 2 (v4.45.0). Fixes the per-page extraction hole Phase 2's per-document density gate cannot see.

## Problem (observed live, 2026-07-07)

The Drover 90% DD set (259 pages, 184 MB) ingested `ready` via the **text** path (~4,900 chars/page average — sails past the 200 chars/page document-level density gate). But its Civil General Notes sheets (pages 2–3) are plotted with **AutoCAD SHX fonts**: their notes text is stroke geometry, not text objects, so the text layer contains only the TrueType title block + headings. Chat answers about those notes correctly reported the body text as missing. Measured per-page text-layer chars (unpdf, all 259 pages): median **2,517**; pages 2–5 = **401/375/317/444** (title block ≈ 300 alone); 63 pages < 600 chars. A **document-level** gate can never catch this: the document is text-rich on average while individual sheets are effectively empty.

## Fix

**Per-page hybrid extraction** on the PDF text path: detect pages whose individual text layer is title-block-thin, vision-extract just those pages through the existing v4.45.0 segment machinery, and splice the results into the text extraction in page order. TrueType pages keep exact text extraction; SHX pages get Gemini vision (which reads stroke text off the rendered page); `extraction_method` becomes `'hybrid'`.

## Locked decisions

| Decision | Choice |
|---|---|
| Sparse-page threshold | `EXTRACTION_HYBRID_PAGE_MIN_CHARS` default **500** (empirical: title-block-only ≈ 300–450; real sheets ≥ ~1,000) |
| Hybrid page cap | `EXTRACTION_HYBRID_MAX_PAGES` default **80**; more sparse pages than that → skip hybrid (log, no partial — the whole-doc density gate owns pervasively-sparse docs) |
| Splice granularity | **Per contiguous run**, not per page: sparse pages group into runs → one segment PDF per run chunk → the segment's vision text replaces that run's pages as a block. No fragile `# Page N` response parsing. |
| Vision failure on a run | Keep that run's (thin) original text, flag `extraction_partial = true` (fidelity hole surfaced, never silent) |
| `extraction_method` | New value `'hybrid'` (text column, **no migration**); UI chip like the existing `vision` chip |
| Scope | New-upload AND replace flows (both share the route's extraction section). Non-PDF paths, chunking, embedding, retrieval untouched. No new deps. |

## Design by component

**A — `src/lib/fileExtraction.ts`:** `ExtractionResult` gains optional `pageTexts?: string[]` (PDF text path only — unpdf already returns per-page text; attach the raw array). Existing `text` accumulation + `DOCUMENT_MAX_CHARS` cap unchanged.

**B — `src/lib/pdfSegments.ts`:** new `splitPdfPageRuns(buffer, pages: number[], opts { pagesPerSegment, maxSegmentBytes })` → same `{ segments, skippedPages }` shape as `splitPdfIntoSegments`, but segments are built from the **contiguous runs** of the given (sorted, 1-based) page list, each run chunked at `pagesPerSegment` and byte-cap-halved via the existing `emit` recursion.

**C — `src/lib/visionExtraction.ts`:** new `extractPagesViaVision(buffer, pages: number[]): Promise<{ segments: Array<{ firstPage, lastPage, text }>, failed: number, truncated: boolean }>` — same per-segment `generateText` call, prompt, retry, concurrency, and env knobs as `extractViaVision`; returns per-segment text (empty-text/failed segments counted in `failed`). No-key → `{ segments: [], failed: 0, truncated: false }`.

**D — `src/app/api/documents/process/route.ts`:** after the existing extraction + density-gate block, when the result is the text path with `pageTexts`: compute sparse pages (`trim().length < HYBRID_MIN`), and if `0 < count ≤ HYBRID_CAP` call `extractPagesViaVision`; rebuild `textContent` page-by-page (vision segment text at each run's first page, original text elsewhere, vision-covered pages skipped); set `extractionMethod = 'hybrid'` when ≥1 segment succeeded; `partial ||= failed > 0 || truncated`; re-apply the `DOCUMENT_MAX_CHARS` cap. Wrapped in the same non-fatal try/catch pattern as the vision fallback (hybrid failure keeps plain text).

**E — types/UI:** `extractionMethod` union gains `'hybrid'` (`src/types.ts`, `DocumentCard` chip, anywhere `'text' | 'vision'` is typed).

## Verification gate

Standard: typecheck 0 → lint 0 errors → build → `npx vitest run --no-file-parallelism`. Tests: pageTexts attach; page-run splitting (runs/chunking/byte-cap/skip); extractPagesViaVision (mocked: per-run calls, failure counting, truncation); route hybrid merge (sparse pages spliced, method `hybrid`, vision-failure → partial + text kept, cap-skip → plain text path). **Prod validation:** Replace the Drover doc after deploy → expect `hybrid` chip, General Notes text retrievable.

## Risks

- Threshold misses (a sparse-but-legit page vision-extracted needlessly): cost is a few extra Gemini calls; vision transcribes the same text — no accuracy downside.
- ~60 hybrid pages on Drover ≈ 5–10 extra segment calls at 2-concurrent — minutes, inside `maxDuration=800`.
- Local-dev note (unrelated to prod): this machine's network drops >1 MB uploads to Gemini; hybrid runs on Vercel egress.
