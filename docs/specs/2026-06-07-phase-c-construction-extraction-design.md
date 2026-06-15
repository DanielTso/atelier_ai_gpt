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

## ✅ C2 spike — DONE (2026-06-07). Result: GO.

Ran `scripts/spike-vision-extract.mjs` against a real IFC plan (`GradingPlanIFC.pdf`, a 26-page Kimley-Horn Site Civil Package). **Outcome: vision extraction works very well.** `gemini-3.5-flash` accurately read both a text-heavy cover sheet (full 223-row sheet index + title block + PE stamp) and a dense overall site-plan drawing (building zones, parking counts, scattered dimensions, stormwater basins, utilities) and produced coherent summaries. Validated recipe → folded into the C2 decisions below: **model `gemini-3.5-flash`** (not the reasoning-heavy `gemini-3.1-pro-preview`), **`maxOutputTokens` ≥ 8000**, **render scale 3**, `pdfjs-dist@^5` legacy build + `@napi-rs/canvas@^0.1.x`. The render+vision plumbing is proven. Remaining unknowns are operational, not feasibility: Vercel native-canvas build, multi-page concurrency/cost, and prompt tuning per sheet type.

<details><summary>Original spike definition (kept for reference)</summary>

Before any production code, prove the approach on a **real construction PDF page**:

1. Render one page of a real plan PDF to an image (try `unpdf`'s `renderPageAsImage` server-side first).
2. Send the image to a Gemini vision model with an extraction prompt (transcribe all text/labels/dimensions/schedules; describe what the drawing depicts).
3. Eyeball the output: does it capture dimensions, room/sheet labels, schedule tables, callouts usefully?

**This decides everything.** Outcomes:
- ✅ Usable → proceed to C2 with Gemini vision.
- ⚠️ Weak → switch `EXTRACTION_MODEL` to **Claude vision** (Opus/Sonnet have strong, high-res vision) and re-test; reconsider per-page prompt.
- ❌ `unpdf` can't render server-side → fall back to **client-side pdf.js** rendering (browser renders pages to canvas, uploads page images).

Keep the spike out of the production paths (a scratch script or a throwaway route); delete after.

</details>

## C2 — Vision extraction (the core)

**Design decisions:**
- **Vision model — `gemini-3.5-flash` (VALIDATED by the spike, 2026-06-07).** Spike result on a real IFC plan: `gemini-3.5-flash` extracted a text-heavy cover sheet AND a dense site-plan drawing **excellently** — verbatim text, the full 223-row sheet-index table, scattered dimensions, spatial labels, parking counts, and a coherent summary. **Do NOT use `gemini-3.1-pro-preview`** — it's a heavy-reasoning model that burned ~1,900 of 2,000 output tokens on thinking and produced almost no text. **Set `maxOutputTokens` ≥ 8000** (drawings are output-heavy; Flash still spends roughly half its output on reasoning tokens). Render at **scale 3** for sharp small text on large-format sheets. Keep `EXTRACTION_MODEL` an env knob (Claude vision as an option for unusually hard sheets — not needed for typical IFC plans). Uses the `createGoogleGenerativeAI` + `generateText` image-content-part pattern (like `classify`), confirmed working in the spike.
- **PDF → image: server-side `unpdf` render — VALIDATED locally (2026-06-07 spike).** `renderPageAsImage(buffer, pageNo, { canvasImport, scale })` works with these **exact** versions (other versions fail): **`pdfjs-dist@^5`** imported via the **legacy** build `definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))`, plus **`@napi-rs/canvas@^0.1.69`** (0.1.x — unpdf 1.4.0's peer). Pitfalls the spike hit and resolved: `pdfjs-dist@6` → `@napi-rs/canvas` "Value is none of these types" error (use v5); default (non-legacy) pdfjs build → `DOMMatrix is not defined` in Node (use legacy); `@napi-rs/canvas@1.0.0` → ERESOLVE (pin 0.1.x). Rendered a real PDF page to a valid PNG. **Still to verify in C2: that `@napi-rs/canvas` (native) builds/runs on Vercel Fluid Compute** — prebuilt Linux binaries should, but confirm in a preview deploy. Fallback if Vercel chokes: **client-side pdf.js** render (browser → canvas, no native dep). In C2, promote `pdfjs-dist`/`@napi-rs/canvas` from devDeps to `dependencies`.
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
