# Chatlog — 2026-06-07 — Phase C2: Vision extraction

## Goal

Add a vision-extraction fallback so scanned/drawing PDFs and image uploads get their text read by a Gemini vision model and fed into the existing chunk → embed → pgvector RAG pipeline. Text-layer PDFs and all other file types are unchanged.

## Tasks and outcomes

1. **`visionExtraction.ts` module** — `extractViaVision(buffer)` renders each PDF page (pdfjs-dist@5 legacy + `@napi-rs/canvas`, scale 3) and calls `generateText` with an image content part against Gemini Flash, best-effort per page, capped at `EXTRACTION_MAX_PAGES`. `extractViaVisionImage(buffer, mimeType)` vision-extracts a single image. Both degrade to `''` if no Gemini key. Done.
2. **Documents-route vision wiring** — Image uploads (png/jpg/jpeg/webp by extension, or `image/*` MIME) routed to `extractViaVisionImage`; PDFs whose text layer is shorter than `EXTRACTION_MIN_TEXT_CHARS` fall back to `extractViaVision`. Other files unchanged. Done.
3. **`isImageExtension` helper** — `IMAGE_EXTENSIONS` set + `isImageExtension(ext)` added to `src/lib/fileExtraction.ts`. Images intentionally kept out of shared `SUPPORTED_EXTENSIONS`/`isSupported` because `/api/extract` has no image handling. Image acceptance is opt-in per route. Done.
4. **Deps promoted** — `pdfjs-dist@^5.7.284` and `@napi-rs/canvas@^0.1.100` moved from devDependencies to dependencies (needed at request time). Done.
5. **Tests** — `tests/unit/lib/visionExtraction.test.ts` (5 tests), `tests/unit/api/documents-route.test.ts` (3 tests). Full API suite: 39 tests green. Done.
6. **Documentation** (this task) — CHANGELOG [4.2.0], CLAUDE.md API Routes + vision-extraction section, session chatlog. Done.

## Regression caught

A draft that widened the global `isSupported` to include image extensions was caught in review — this would have caused `/api/extract` to accept image uploads and emit garbage (no image handler in that route). Fix: image acceptance localized to `/api/documents` only via the `isImageExtension` helper. Reverted before merge.

## Test counts

- `visionExtraction.test.ts`: 5 tests
- `documents-route.test.ts`: 3 new tests
- Full API suite: 39 tests green

## Open item — Task 6 (Vercel native-canvas verification)

Whether `@napi-rs/canvas` (a native Node addon) builds and runs on Vercel Fluid Compute has not been verified. Documented fallback if the native module is unavailable: client-side pdf.js rendering. Verification is the next task after docs.
