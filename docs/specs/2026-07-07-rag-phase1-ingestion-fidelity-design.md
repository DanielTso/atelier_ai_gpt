# RAG Overhaul — Phase 1: Ingestion Reliability & Fidelity (design spec)

- **Date:** 2026-07-07
- **Status:** Approved (brainstorm complete) → ready for implementation plan
- **Target release:** v4.44.0
- **Program:** Phase 1 of a 5-phase RAG overhaul. This spec covers **Phase 1 only**.

## Problem / context

The user runs construction **plans and contracts** through the RAG system and needs it reliable above all. Investigation of the live system found the ingestion path silently loses content:

1. **Silent 100K-char truncation (already happening).** `MAX_TEXT_LENGTH = 100_000` (`src/lib/fileExtraction.ts:8`) truncates extracted text in both the PDF extractor (`fileExtraction.ts:67`) and the process route. Live DB check: both existing documents sit at the cap (`max_doc_char_count = 100000` exactly, `avg = 80,619`) — at least one real document has **already lost everything past 100K chars**, with no indication to the user.
2. **Silent 30-page vision cap.** `EXTRACTION_MAX_PAGES = 30` (`src/lib/visionExtraction.ts:16`) caps scanned/image PDFs at 30 pages and only `console.warn`s — the caller and user never learn pages were dropped.
3. **Silent embedding loss.** `ingestText` (`src/lib/ingest.ts:17`) fires **all** chunk embeddings concurrently. Removing truncation turns a long doc into hundreds of chunks → hundreds of simultaneous Gemini calls → 429s → chunks saved with `embedding: null` (invisible RAG holes). The replace path (`documents/process`) has the same unbounded fan-out.
4. **No fidelity signal.** Nothing tells the user whether a document was fully ingested or partially. `documents.status` only distinguishes `uploading|processing|ready|error`, not complete-vs-partial extraction.

**Environment (confirmed live):** pgvector **0.8.0**; native FTS + `pg_trgm` available (for later phases); scale is tiny (2 docs, 107 chunks) so throughput is not a concern — fidelity is.

## Goals

- **No silent loss.** Every document ends `complete`, explicitly `partial` (with what was dropped), or `error`. The user always knows the fidelity.
- Ingest the **full** extracted text of real contracts/plans (raise the char ceiling far above any real document; chunk all of it).
- Embed reliably at that scale (bounded concurrency + retry) so no chunk is silently left unembedded.
- Extract more of scanned PDFs, and when capped, say so.
- Persist the full extracted text as a faithful artifact (also the input Phase 2's whole-document mode will consume).

## Non-goals (explicitly deferred to later phases)

- **Whole-document mode** (feed a full contract to the model, bypassing top-k) — Phase 2.
- **Structure-aware chunking** (by clause/section/table) — Phase 3.
- **Hybrid keyword+vector retrieval** — Phase 4.
- **Scale/index work** (`hnsw.iterative_scan`, ef_search, pagination, pgmq background ingestion) — Phase 5.
- **Prompt-injection delimiting** of retrieved doc content — that is retrieval/prompt-assembly time, tracked for the retrieval phase, not ingestion.
- **Bounded-concurrency vision** (parallel page rendering) — a perf item; pages stay serial here for memory safety.
- **New file-type support** (.doc/.xls/.pptx) — out of scope; the current supported set is unchanged.
- **Backfill** of the existing (already-truncated) documents — the user re-uploads if they want full fidelity on those; no automatic re-ingest.

## Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope | **Phase 1 alone** (ingestion reliability & fidelity) |
| Char ceiling | `DOCUMENT_MAX_CHARS` default **2,000,000** (env-configurable); chunk the full text; `partial` if exceeded |
| Vision page cap | `EXTRACTION_MAX_PAGES` default **60** (env-configurable), pages stay **serial** (memory-safe); `partial` if exceeded |
| Embedding | **Bounded concurrency ~5 + retry/backoff on 429**, shared by ingest + replace paths |
| Full extracted text | Stored as a **Storage artifact** (`documents/<proj>/<id>[/rev<N>]/extracted.txt`), best-effort |
| Fidelity signal | Migration `0014` adds `page_count`, `pages_extracted`, `extraction_partial`; amber **"Partial"** badge in the UI |

## Design by component

### Component A — Full-text fidelity

**Files:** `src/lib/fileExtraction.ts`, `src/app/api/documents/process/route.ts`.

- Rename/replace `MAX_TEXT_LENGTH` (100K) with **`DOCUMENT_MAX_CHARS`** — `Number(process.env.DOCUMENT_MAX_CHARS) || 2_000_000`. Apply the same ceiling in `extractTextFromBuffer` (PDF page-accumulation loop) and the process route's post-extract truncation.
- Chunk the **full** extracted text (up to the 2M ceiling), not the first 100K.
- **Partial detection:** the extractors return whether the ceiling was hit (text path) — see the shared `ExtractionResult` shape in Component D.
- **Memory note:** raising 100K→2M adds ~≤2MB of string alongside the ≤200MB file buffer already in memory — negligible. A doc exceeding 2M chars of *text* is extraordinary (~300–400 pages); it ingests the first 2M and is marked `partial`.

### Component B — Reliable embedding

**Files:** new `src/lib/embedChunks.ts` (or a helper in `src/lib/ingest.ts`), `src/lib/ingest.ts`, `src/app/api/documents/process/route.ts` (replace path).

- Extract a shared **`embedChunks(chunks, { concurrency, retries })`** helper: a bounded worker pool (default concurrency **5**) that embeds each chunk with **retry + exponential backoff on 429/rate-limit** (e.g. 3 attempts). Returns per-chunk `{ id, embedding | null }` so failures are counted, not lost.
- `ingestText` and the process route's replace path both call it (replacing their ad-hoc `Promise.allSettled(map(...))`).
- Status reflects embedding fidelity: `error` if **zero** chunks embed; otherwise `ready` — and if *some* chunks failed after retries, the doc is flagged `extraction_partial = true` with the failed count (a partial RAG index is a fidelity issue, surfaced not hidden).
- Env: `EMBED_CONCURRENCY` (default 5), `EMBED_MAX_RETRIES` (default 3).

### Component C — Scanned-PDF vision

**Files:** `src/lib/visionExtraction.ts`.

- Raise `EXTRACTION_MAX_PAGES` default **30 → 60** (already env-driven via `cfg()`).
- Change `extractViaVision(buffer)` to return the full **`ExtractionResult`** (`{ text, pageCount, pagesExtracted, partial }`) — it already knows `pdf.numPages` and the capped `total`, and sets `partial = pagesExtracted < pageCount`. `extractViaVisionImage` returns `{ text, pageCount: 1, pagesExtracted: 1, partial: false }`.
- Each extractor owns its own `partial` (text extractor → char-truncation; vision → page-capping). The process route then **OR-combines** it with the embedding-failure case from Component B before persisting.
- Pages stay **serial** (memory-safe on Fluid; paired with the shipped `maxDuration = 800` + stale-processing reaper).

### Component D — Extraction transparency (schema + status threading + UI)

**Migration `0014`** (author via `drizzle-kit generate` from `schema.ts`): add to `documents`:
- `page_count integer` (nullable — total pages/units in the source; null for plain text)
- `pages_extracted integer` (nullable)
- `extraction_partial boolean NOT NULL DEFAULT false`

**Status threading:** define `ExtractionResult = { text: string; pageCount: number | null; pagesExtracted: number | null; partial: boolean }`. The extractors (`extractTextFromBuffer`, `extractViaVision`, `extractViaVisionImage`) return it; the process route threads it into `ingestText`/replace, which persist the new columns via an extended `updateDocumentStatus(..., { pageCount, pagesExtracted, extractionPartial })` and `commitDocumentReplacement`.

**Full-text artifact:** the process route uploads the full extracted text to Storage at `documents/<projectId>/<docId>[/rev<N>]/extracted.txt` via `uploadBuffer(path, Buffer.from(text, 'utf-8'), 'text/plain')` — best-effort (logged on failure; does not fail ingestion, since chunks are the retrieval path).

**API + UI:**
- `GET /api/documents` (+ `DocumentSummary` in `src/types.ts`) surface `pageCount`, `pagesExtracted`, `extractionPartial`.
- `DocumentCard.tsx` renders an amber **"Partial"** badge when `extractionPartial`, tooltip derived honestly from the fields: **"Extracted {pagesExtracted} of {pageCount} pages"** when `pagesExtracted < pageCount`, otherwise the generic **"Partial extraction — some content may be missing"** (covers char-truncation and embedding-failure cases, which the columns don't distinguish). Sits beside the existing `vision` badge.
- `DocumentPreviewDialog.tsx` shows the same notice.

## Data / migration summary

- Migration `0014`: 3 columns on `documents` (`page_count`, `pages_extracted`, `extraction_partial`). No data migration; existing rows default to `extraction_partial = false`, `page_count`/`pages_extracted` null (unknown — not re-derived).
- New Storage object per document: `extracted.txt`. `deleteDocument`/replace cleanup should include it (best-effort) alongside the original + thumbnail.

## Verification gate

`npm run typecheck` (0) → `npm run lint` (0 errors; ≤ baseline warnings) → `npm run build` → `npm test` (incl. new tests) → CI `drizzle-kit migrate` + Playwright. UI change is additive (a badge); e2e unaffected.

## Test plan (unit, Vitest / PGlite)

1. **No-truncation chunking** — a document text longer than the *old* 100K but under 2M chunks fully (chunk count reflects full length; `extraction_partial = false`).
2. **Over-ceiling → partial** — text over `DOCUMENT_MAX_CHARS` ingests the ceiling's worth and sets `extraction_partial = true`.
3. **`embedChunks` bounded + retry** — never exceeds the concurrency cap; retries a simulated 429 then succeeds; a permanently-failing chunk is counted (embedding null) and, if all fail, status `error`; if some fail, `extraction_partial = true`.
4. **Vision partial** — `extractViaVision` returns `pageCount`/`pagesExtracted`; when `numPages > maxPages`, the process route persists `pages_extracted < page_count` and `extraction_partial = true`.
5. **Migration `0014`** — the three columns exist with correct defaults (PGlite catalog assertion, mirroring `migration-0013.test.ts`).
6. **`updateDocumentStatus`** persists the new fields.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Full-doc chunking → many embeddings → 429s | Component B (bounded concurrency + retry) is in the same phase, precisely to cover this. |
| 60 serial vision pages exceed `maxDuration` | Reaper (shipped) marks a timed-out row `error`; user retries. Cap is env-tunable down. Bounded-concurrency vision deferred. |
| `extracted.txt` upload fails | Best-effort + logged; chunks (the retrieval path) still saved; document still usable. |
| 2M-char string memory on Fluid | ≤2MB alongside the ≤200MB buffer already held — negligible; a real ceiling still bounds pathological input. |
| Existing truncated docs stay truncated | Out of scope by decision; user re-uploads for full fidelity (badge will show old ones as non-partial since we don't re-derive — acceptable). |

## Definition of done

- No document is silently truncated: over-ceiling text and over-cap page counts both produce a visible `partial` state; the char ceiling is 2M (env-tunable).
- A long contract (e.g. > 100K chars, < 2M) ingests in full — chunk count reflects the whole document, all chunks embedded (bounded + retried), full text stored as `extracted.txt`.
- `documents` carries `page_count`/`pages_extracted`/`extraction_partial`; the UI shows a "Partial" badge + tooltip when set.
- Full gate green with the new tests; migration `0014` applied to live Supabase (user-gated); shipped as v4.44.0.

## Follow-ups (the rest of the program)

- **Phase 2 — Whole-document mode** (reads `extracted.txt`; the biggest contract-analysis win).
- **Phase 3 — Structure-aware chunking.** **Phase 4 — Hybrid keyword+vector retrieval.** **Phase 5 — Scale/index hardening + prompt-injection delimiting.**
