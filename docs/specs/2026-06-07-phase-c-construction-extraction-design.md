# Phase C — Construction plan / image extraction (multimodal)

**Status:** Approved design (2026-06-07). **Designed in the session that shipped A/B/B2; intended for FRESH-SESSION execution** (see "Fresh-session kickoff" at the bottom). **Program:** Part C of the Atelier Studio workhorse effort (A: Claude ✓ · B: pgvector ✓ · B2: advanced RAG ✓ · **C: extraction** · D: Excel/Word artifacts).

---

## Goal

Make construction **plans, drawings, and images** usable in the app — not just text PDFs. When a document has no usable text layer (scanned plan, vector drawing, image upload), render its pages to images and use a **vision model** to "read" them (transcribe text, dimensions, schedules; describe the drawing). The extracted text flows into the **existing** chunk → embed → pgvector pipeline unchanged, so plans become searchable/answerable exactly like text docs are today — and feed Phase D reports.

## Current state (what exists)

- `src/lib/fileExtraction.ts` + `/api/extract` + `/api/documents`: **text-only** extraction — `unpdf` (PDF text layer), `mammoth` (DOCX), `exceljs` (XLSX). A scanned/drawing PDF yields little or nothing.
- `/api/documents`: extract text → `chunkText` (2000/400) → embed (Gemini `gemini-embedding-001`) → store `documentChunks` (pgvector). **This downstream pipeline is reused as-is.**
- Attachments are stored as **base64 data URLs in the DB** (`messageAttachments`) — fine for small images, poor for large plans.
- On Supabase Postgres + pgvector (Phase B); advanced retrieval pipeline (Phase B2).

## Sequencing (decided)

**C2-spike → C2 → C-storage → C3.** C2 extraction renders pages **in-memory** and only persists *extracted text* (existing pipeline), so it does **not** depend on file storage. De-risk the uncertain vision part first; storage and UI come after.

## ⭐ Start here: the C2 spike (throwaway, do first)

Before any production code, prove the approach on a **real construction PDF page**:

1. Render one page of a real plan PDF to an image (try `unpdf`'s `renderPageAsImage` server-side first).
2. Send the image to a Gemini vision model with an extraction prompt (transcribe all text/labels/dimensions/schedules; describe what the drawing depicts).
3. Eyeball the output: does it capture dimensions, room/sheet labels, schedule tables, callouts usefully?

**This decides everything.** Outcomes:
- ✅ Usable → proceed to C2 with Gemini vision.
- ⚠️ Weak → switch `EXTRACTION_MODEL` to **Claude vision** (Opus/Sonnet have strong, high-res vision) and re-test; reconsider per-page prompt.
- ❌ `unpdf` can't render server-side → fall back to **client-side pdf.js** rendering (browser renders pages to canvas, uploads page images).

Keep the spike out of the production paths (a scratch script or a throwaway route); delete after.

## C2 — Vision extraction (the core)

**Design decisions:**
- **Vision model — Gemini, configurable.** Bulk page extraction is a "senses" task → cheap/fast Gemini vision (e.g. `gemini-3.1-pro-preview`, which has vision). Expose `EXTRACTION_MODEL` (env) so it can switch to a Claude vision model for hard drawings. **Verify the exact vision-capable Gemini model id + the AI SDK vision-input shape via Context7 at plan time.** Reuse the `createGoogleGenerativeAI` + `generateText` (image content part) pattern, like `classify`.
- **PDF → image:** `unpdf` exposes `renderPageAsImage(buffer, pageNo, { canvasImport, scale })`, BUT it requires the full **`pdfjs-dist`** build (via `definePDFJSModule(() => import('pdfjs-dist'))`) **and the native `@napi-rs/canvas`** package — i.e. two new deps, one native (verified via Context7). `@napi-rs/canvas` ships prebuilt Linux binaries (should work on Vercel Fluid Compute), but the native dep is a real risk. **The spike must confirm it renders both locally AND that it builds/runs on Vercel.** Strong fallback: **client-side pdf.js** rendering (browser → canvas, no native dep, no serverless risk) where the browser uploads page images.
- **Trigger:** in `/api/documents`, after the existing text extraction, if the text layer is empty/thin (e.g. < N chars per page or overall), fall back to per-page vision extraction. Text PDFs keep their fast path; only scanned/drawing/image inputs pay the vision cost. Image uploads (PNG/JPG) go straight to vision.
- **Downstream unchanged:** vision output is concatenated/per-page text → existing `chunkText` → embed → `documentChunks`. No retrieval changes.
- **Best-effort + async, with a page cap:** render+extract per page, tolerant of per-page failures (like embeddings today). Cap pages (env `EXTRACTION_MAX_PAGES`, default e.g. 50) and **log when capping** (no silent truncation). A 50-page plan = up to 50 vision calls → run them with bounded concurrency.
- **No schema change required.** (Optional later: `documents.extractionMethod` = `'text' | 'vision'` for UI badging — defer to C3.)

**Files (C2, approximate):** `src/lib/fileExtraction.ts` (or a new `src/lib/visionExtraction.ts`) for render+vision; `/api/documents` trigger logic; env knobs; tests (mock the vision model; assert fallback when text layer present, vision path when empty, page cap respected).

## C-storage — Supabase Storage (after C2)

Persist **original files + rendered thumbnails** so the user can view the source plan, and move large attachments off base64-in-DB.
- Add `@supabase/supabase-js` (Storage client only — DB stays on Drizzle). New env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side) or signed uploads.
- A Storage bucket for documents/images; store the original on upload; store a thumbnail (first page render).
- Migrate `messageAttachments` from base64 data URLs to Storage references (keep a fallback read path for old rows).

## C3 — UI (last)

Thumbnails for documents/plans, page previews, an extraction status + method badge (text vs vision). Reuses the existing document list + lightbox patterns.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Vision quality on dense drawings unknown** | The spike (step one) settles it before investment; model is env-swappable to Claude vision |
| `unpdf` render-to-image may not work serverless | Spike verifies; client-side pdf.js fallback |
| Cost/latency on big plans | Page cap + bounded concurrency + async best-effort; only non-text docs trigger vision |
| Exact Gemini vision model id / AI SDK image-input shape | Verify via Context7 at plan time (don't guess) |
| Storage adds a new provider client + keys | Isolate to C-storage sub-phase; C2 doesn't need it |

## Non-goals (Phase C)

- Excel/Word **report generation** — that's Phase D.
- Re-architecting the chunk/embed/retrieval pipeline (reused unchanged).
- CAD/vector parsing of DWG/DXF (out of scope; we read rendered images).
- Fine-tuning a custom vision model.

## Definition of done (whole of C, across sub-phases)

- [ ] Spike validated vision extraction on a real plan; model + render approach chosen.
- [ ] Uploading a scanned/drawing PDF or an image produces useful extracted text in `documentChunks`, retrievable via the existing RAG pipeline.
- [ ] Text PDFs keep their fast text-only path; vision only triggers when needed; page cap enforced + logged.
- [ ] Originals + thumbnails in Supabase Storage; attachments off base64 (C-storage).
- [ ] UI shows thumbnails + extraction method (C3).
- [ ] Each sub-phase: full gate green (lint/build/test/e2e) + manual smoke; docs + chatlog updated.

---

## Fresh-session kickoff

A new session should:
1. `git checkout phase-c-extraction` (this spec lives here).
2. **Do the C2 spike first** (above) — a throwaway render+vision test on a real plan PDF. Report quality before writing production code.
3. Based on the spike, run `superpowers:writing-plans` for **C2** (vision extraction), verifying the `unpdf` render API + Gemini vision model id via Context7, then execute with `superpowers:subagent-driven-development`.
4. Then C-storage, then C3 — each its own plan → execute → merge.

Context for the new session: A (Claude provider), B (Supabase+pgvector), B2 (advanced RAG: `retrieval.ts` pipeline + `ragConfig`) are all merged to `master`. The deploy cutover (Supabase connection strings + `drizzle-kit migrate`) is still the user's to run. Embeddings are Gemini `gemini-embedding-001` (768-dim); chat brain is Claude.
