# RAG Overhaul — Phase 2: Extraction Upgrade (design spec)

- **Date:** 2026-07-07
- **Status:** Draft — pending user review. **One locked brainstorm decision is revised** by doc verification (see "Decision change" below); everything else follows the locked decisions.
- **Target release:** v4.45.0
- **Program:** Phase 2 of the 5-phase RAG overhaul (Phase 1 = v4.44.0 ingestion fidelity, shipped).

## Problem / context

The user runs construction **plans and contracts** through RAG. Real plan sets are **up to 160 pages / 95 MB** (design envelope; the app-side upload cap stays 200 MB). Today's vision path (`src/lib/visionExtraction.ts`) renders each PDF page to a PNG via `pdfjs-dist` + `@napi-rs/canvas` (scale 3) and makes **one Gemini call per page, serially** — slow (120 pages ≈ 120 serial calls), memory-heavy (raster at scale 3), lossy (JPEG-of-a-page loses the text layer Gemini could read natively), and capped at 60 pages (`EXTRACTION_MAX_PAGES`).

Additionally, the vision path only triggers when the PDF's text layer is nearly empty (`< 100` chars **total**, `EXTRACTION_MIN_TEXT_CHARS`). A 120-page CAD plan set with a sparse text layer (a few hundred chars of title-block text) sails past that gate and ingests as garbage-thin "text" — the drawings are never seen. That is the actual product failure for plan sets.

**Scope guard (locked):** Claude STAYS the chat brain. This spec is RAG-ingestion only — extraction of PDFs/images into text for chunking + embedding. Chat, retrieval, and embeddings are untouched.

## Verification results (2026-07-07, official Gemini docs — resolves the brainstorm's ⚠️ caveat)

The brainstorm left one caveat: *does the 50 MB-per-PDF limit apply to Files-API processing, or only inline?* Verified against current docs:

1. **The 50 MB PDF limit applies everywhere — but only per Gemini request, never to the user's upload.** "Gemini supports PDF files up to 50MB or 1000 pages. **This limit applies to both inline data and Files API uploads.**" ([document-processing](https://ai.google.dev/gemini-api/docs/document-processing), [files](https://ai.google.dev/gemini-api/docs/files)). The research claim that the Files API (2 GB/file general cap) ingests a large PDF directly is **refuted** — any >50 MB plan set **must be split** before it reaches Gemini, no matter the input method. The user's upload limit stays `MAX_FILE_SIZE` = 200 MB; splitting is server-side plumbing the user never sees.
2. **Inline request cap is now 100 MB** (Jan 2026 update); PDFs still 50 MB. Pre-signed HTTP URLs are also accepted as direct input (100 MB payload cap) ([file-input-methods](https://ai.google.dev/gemini-api/docs/file-input-methods)).
3. **Token cost:** each PDF page = 258 input tokens (image modality); on Gemini 3 models, tokens from the PDF's **native text layer are not charged**. Pages are auto-scaled up to 3072×3072 px — higher fidelity than our scale-3 raster path for typical sheet sizes, and Gemini reads the embedded text layer natively (ideal for CAD PDFs: vector drawing rendered + text layer read verbatim).
4. **Model:** `gemini-3.5-flash` is the **current top stable Gemini model** (1M input / 65K output tokens); `gemini-3.1-pro` exists but is **preview-only** — wrong risk profile for a production ingestion pipeline. The brainstorm's "upgrade the extraction model" resolves to: **keep `gemini-3.5-flash`** — the upgrade is the *input method* (native PDF pages instead of per-page rasters), not the model ID. `EXTRACTION_MODEL` stays env-overridable for when a stable successor lands.
5. **Output is the real constraint, not input.** 160 pages ≈ 41K input tokens (trivial vs 1M), but dense transcription output for 160 pages far exceeds the 65K output cap. Extraction must be **segmented** for output-bounding even if size didn't force it.

## Decision change (requires sign-off — supersedes one locked decision)

**Locked was:** "Extraction approach = Gemini Files API (2 GB/file ingests 78 MB directly, no split)." Its premise is refuted (verification #1): splitting is mandatory for >50 MB PDFs regardless.

**Revised decision: native-PDF *segment* extraction, sent inline via the existing AI SDK.**

- Split the PDF into page-range segments with **`pdf-lib`** (already a dependency, artifact engine). Each 20-page segment of a 95 MB/160-page set is ~12 MB — comfortably under both the 50 MB PDF cap and the 100 MB request cap, so segments go **inline** as AI SDK `file` parts (`mediaType: 'application/pdf'`).
- The Files API would now add pure cost with no benefit: it still enforces 50 MB per PDF, it is **not exposed by `@ai-sdk/google`** (it would require adding the separate `@google/genai` SDK — a second Google client), and it brings upload → poll-ACTIVE → 48 h-TTL lifecycle handling. Splitting already solves the only problem it was chosen for.
- Everything the Files API decision was *for* is preserved: native Gemini document OCR (text/tables/diagrams), no per-page render, no `@napi-rs/canvas` in the primary path, one provider (Gemini) for vision + embeddings.

All other locked decisions stand unchanged: Gemini as the single vision+embedding provider; keep `gemini-embedding-001` @ 768-dim; keep the Phase 1 `ExtractionResult{text,pageCount,pagesExtracted,partial}` contract and partial semantics; keep single-function `maxDuration=800` + stale reaper (no Workflow DevKit / pgmq).

## Goals

- Ingest a **95 MB / 160-page plan set** through vision extraction reliably, well inside the 800 s budget (headroom to the full 200 MB upload cap).
- **Native PDF understanding** replaces per-page raster+call: one Gemini call per N-page segment, bounded-concurrent.
- **Fix the vision trigger** so sparse-text plan sets actually take the vision path (per-page density, not absolute total).
- Raise the effective page ceiling 60 → 500 (Gemini caps at 1000/request; segments keep us far under).
- No new silent-loss paths: segment failures and output truncation surface as `partial`, per the Phase 1 contract.

## Non-goals (deferred)

- Whole-document mode (feed a full contract to the chat model, bypassing top-k) — later phase, enabled by `extracted.txt` (already persisted since Phase 1).
- Structure-aware chunking (Phase 3), hybrid retrieval (Phase 4), scale/index work (Phase 5).
- Files API / GCS / signed-URL input paths — revisit only if a future need (e.g. >100 MB single segments) appears.
- Changing embeddings, chunking, the replace flow, non-PDF extractors (docx/xlsx/text/images), or `MAX_FILE_SIZE` (200 MB).
- Backfill / auto-re-ingest of existing documents (user re-uploads if they want plan sets re-extracted).

## Design by component

### Component A — PDF segmentation (`src/lib/pdfSegments.ts`, new)

`splitPdfIntoSegments(buffer, pagesPerSegment) → Promise<Array<{ bytes: Uint8Array, firstPage: number, lastPage: number }>>`

- `pdf-lib`: `PDFDocument.load(buffer)` → `copyPages` page ranges into fresh documents → `save()`.
- Default segment size `EXTRACTION_SEGMENT_PAGES = 20` (120 pp → 6 segments; per-segment output ≈ 20 pages × ~1–2K tokens, safely under the 65K output cap).
- **Size guard:** if a saved segment exceeds `EXTRACTION_SEGMENT_MAX_BYTES` (default 45 MB — headroom under the 50 MB PDF cap), recursively halve its page range; a single page still over the cap is skipped and counted as unextracted (→ `partial`). (At 78 MB/120 pp ≈ 0.65 MB/page average this is a corrupt-file edge, not a real case.)
- Page cap applies before splitting: only the first `EXTRACTION_MAX_PAGES` (new default **500**) pages are segmented; beyond → `partial` (existing semantics).

### Component B — Native segment extraction (rework `src/lib/visionExtraction.ts`)

`extractViaVision(buffer)` becomes: read page count (via `pdf-lib`, dropping the pdfjs dependency from this path) → split (Component A) → for each segment, **one** `generateText` call with the segment as an inline `file` part:

- Message content: `[{ type: 'text', text: SEGMENT_PROMPT }, { type: 'file', data: segment.bytes, mediaType: 'application/pdf' }]`. Prompt = the existing transcription prompt, adapted: transcribe ALL legible text per page verbatim (sheet numbers, dimensions, notes, schedules as markdown tables), emit `# Page <absolute page number>` headings using the segment's `firstPage` offset, plus a short per-page description of what the drawing depicts.
- **Bounded concurrency** across segments (reuse the Phase 1 worker-pool + retry/backoff pattern from `embedChunks.ts`; `EXTRACTION_SEGMENT_CONCURRENCY` default **2**, retries on 429/5xx). Order is preserved when joining.
- `maxOutputTokens = EXTRACTION_MAX_OUTPUT_TOKENS`, new default **60000** (was 8000/page; now per ~20-page segment, under the 65 K model cap). If `finishReason === 'length'`, the segment's text is kept but the document is flagged `partial` (output truncation is a fidelity hole — surface it).
- A segment that fails after retries is logged and skipped; its pages count as unextracted → `pagesExtracted` reflects only successful segments' pages, `partial = pagesExtracted < pageCount` (unchanged contract).
- `extractViaVisionImage` (single images) is unchanged. The **legacy per-page render path is deleted, not kept as a fallback** — native PDF input is a first-class documented capability; if a specific PDF fails both paths would fail. `EXTRACTION_RENDER_SCALE` env dies with it. (`pdfjs-dist` + `@napi-rs/canvas` remain deps — thumbnails still use them.)

### Component C — Vision trigger fix (`src/app/api/documents/process/route.ts`)

Replace the absolute gate with a **per-page density** gate:

- Today: vision fires only if `textContent.trim().length < 100` total.
- New: vision fires if `trimmedLength < MIN_TEXT` (keep, absolute floor) **or** `pageCount > 0 && trimmedLength / pageCount < EXTRACTION_MIN_CHARS_PER_PAGE` (new, default **200**). A 120-page plan set with 5K chars of title-block text (≈42 chars/page) now correctly routes to vision; a real text contract (~1,500+ chars/page) never does.
- The existing better-of-both guard stays: vision output replaces text output only when longer.
- `maxDuration = 800` unchanged. Worst case 500 pages = 25 segments ÷ 2 concurrent ≈ manageable; typical 120 pp = 6 segments ≈ 2–4 min.

### Component D — Config & docs

- Env knobs (all in `visionExtraction.ts` `cfg()` / route): `EXTRACTION_MODEL` (default `gemini-3.5-flash`), `EXTRACTION_MAX_PAGES` (**60 → 500**), `EXTRACTION_SEGMENT_PAGES` (**new, 20**), `EXTRACTION_SEGMENT_CONCURRENCY` (**new, 2**), `EXTRACTION_SEGMENT_MAX_BYTES` (**new, 45 MB**), `EXTRACTION_MAX_OUTPUT_TOKENS` (**8000 → 60000**), `EXTRACTION_MIN_TEXT_CHARS` (unchanged, 100), `EXTRACTION_MIN_CHARS_PER_PAGE` (**new, 200**). `EXTRACTION_RENDER_SCALE` removed.
- No schema change, no migration. No new dependencies. `extracted.txt`, chunking, `embedChunks`, replace flow, and all `partial` UI surfaces are untouched.
- CLAUDE.md: update the "Vision-extraction fallback (Phase C2)" paragraph to describe the segment pipeline + new knobs; CHANGELOG entry.

## Verification gate

`npm run typecheck` (0) → `npm run lint` (0 errors) → `npm run build` → `npm test` (definitive run: `npx vitest run --no-file-parallelism`). E2E in CI.

**Tests (new/updated):**
- `pdfSegments`: split boundaries (120 pp/20 → 6 segments, remainder segment, 1-page doc), page-cap interaction, oversize-segment halving (synthetic fixture), absolute page numbering.
- `visionExtraction`: mocked `generateText` — segment fan-out + order preservation, per-segment retry, failed-segment → `partial` + correct `pagesExtracted`, `finishReason: 'length'` → `partial`, no-key degrade to empty result (unchanged).
- Process route: density-gate cases (thin absolute, sparse-per-page plan set, normal contract stays text path), better-of-both guard.
- **Manual smoke (user-run, prod):** upload the real 95 MB/160-page plan set; expect `ready`, `vision` badge, no `Partial` badge, plausible chunk count, retrieval hit on a known sheet note.

## Risks

- **Per-segment quality vs per-page:** one call transcribing 20 dense sheets could skim vs a dedicated per-page call. Mitigations: `# Page N` headings demanded in the prompt; `EXTRACTION_SEGMENT_PAGES` is a knob (drop to 10/5 if quality disappoints); `finishReason` truncation surfaces as `partial`. Worst case the knob goes to 1 (per-page native calls — still no raster, still bounded-concurrent, still better than today).
- **Native OCR fidelity on CAD drawings** (dense linework at 3072 px max) vs our scale-3 raster: docs cap auto-scaling at 3072×3072, which for ARCH D/E sheets is comparable-or-better than today's practical raster; Gemini also reads the vector text layer natively (raster path destroyed it). Judged at the manual smoke; media-resolution provider options are a follow-up knob if needed.
- **429s from 2-concurrent long-input calls:** retry/backoff (proven pattern from `embedChunks`), concurrency knob to 1 if needed.
- **pdf-lib on exotic/corrupt PDFs:** `PDFDocument.load(..., { ignoreEncryption: true })`; a load failure falls through to the existing catch → status `error` (same as today's extractor throw).

## Definition of done

- A sparse-text 95 MB/160-page plan set routes to vision via the density gate, extracts through segmented native-PDF calls, ingests `ready` without `partial`, and its content is retrievable in project chat.
- Per-page raster loop is gone from extraction; no call-per-page; wall-clock for 160 pp is minutes, not the prior serial-page budget.
- All fidelity semantics from Phase 1 preserved (`partial` on page-cap / segment failure / output truncation / char ceiling / embed failure).
- Gate green; CHANGELOG + CLAUDE.md updated; released as v4.45.0 (user-gated).
