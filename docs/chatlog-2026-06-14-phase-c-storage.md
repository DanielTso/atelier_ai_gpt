# Chatlog — 2026-06-14 — Phase C-storage Stage 1: document storage

## Goal

Move document uploads off the inline Vercel function body (was limited to 10 MB via `serverActions.bodySizeLimit`, and would fail on large construction PDFs) to **Supabase Storage**, with persisted originals and WebP thumbnails, so construction plans of any size flow cleanly through the existing extract → chunk → embed → pgvector RAG pipeline.

## Brainstorm decisions

- **Full scope, 2 stages.** Stage 1: documents (originals + thumbnails to Storage; 3-step upload flow). Stage 2: chat attachments (migrate off base64 inline storage — separate plan).
- **Private bucket + signed URLs.** Bucket is private; no public reads. Server mints short-lived signed upload tokens (one write only) and signed download URLs per request. Service-role key is server-only, never sent to client. Browser uses the anon key only to call `uploadToSignedUrl`.
- **Client-orchestrated 3-step flow.** Client calls `/api/documents/upload-url` (gets token), PUTs directly to Supabase Storage (bypasses Vercel body limit), then calls `/api/documents/process` (server downloads, extracts, thumbnails, chunks, embeds). This is the standard Supabase signed-upload pattern and the only way to handle files larger than Vercel's function body limit.
- **`@napi-rs/canvas` already in use** (C2 vision extraction). Thumbnail generation reuses it — no new native dependencies.
- **Thumbnails best-effort.** A thumbnail failure never blocks the upload; `thumbnail_path` can be null; `thumbnailUrl` in API responses is null if absent.

## Stage 1 tasks and outcomes

1. **Spec + plan authored** (`docs/specs/2026-06-14-phase-c-storage-design.md`, `docs/plans/2026-06-14-phase-c-storage-stage1-documents.md`). Scope, non-goals, access model, file layout, verification gate, pending USER actions documented. Done.
2. **`src/lib/storage.ts`** — server-only Supabase Storage wrapper. `isStorageConfigured`, `createSignedUploadUrl`, `uploadBuffer`, `downloadToBuffer`, `createSignedDownloadUrl`, `removeObjects`, `storageBucketName`. Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Bucket from `SUPABASE_STORAGE_BUCKET` (default `atelier-files`). Unit tests written with mocked `@supabase/supabase-js`. **Bug caught in Task 2**: test for `isStorageConfigured` was checking `process.env` after setting the module default-param; env-clear in `afterEach` wasn't restoring the mock. Fixed by resetting the module mock explicitly in `afterEach`. Done.
3. **`src/lib/thumbnails.ts`** — `generatePdfThumbnail(buffer)` renders page 1 at scale 1 via pdfjs-dist@5 legacy + `@napi-rs/canvas`; `generateImageThumbnail(buffer, mimeType)` downscales images. Both → WebP at `THUMBNAIL_WIDTH` (default 600px). Best-effort; failures logged and return `null`. Unit tests with mocked canvas. Done.
4. **`src/lib/storageClient.ts`** (browser) — anon-key `createClient` for `uploadToSignedUrl`. Uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Done.
5. **Schema migration `drizzle/0002_left_patriot.sql`** — adds `storage_path text` + `thumbnail_path text` to `documents`; extends `status` enum with `uploading` and `processing`. Done.
6. **New server actions** (`src/app/actions.ts`): `createUploadingDocument` (creates row with status `uploading`), `updateDocumentStoragePath`, `getDocumentById`; `updateDocumentStatus` widened (status union + optional `charCount`/`thumbnailPath`); `deleteDocument` returns the deleted row. Old `createDocument` retired. Done.
7. **`POST /api/documents/upload-url`** — validates name/type/size, creates `documents` row, returns `{documentId, path, token, bucket}`. Done.
8. **`POST /api/documents/process`** — downloads original from Storage, runs C2 extract pipeline, uploads thumbnail, chunks + embeds, sets `ready | error`. Old inline `POST /api/documents` retired. Done.
9. **`GET` + `DELETE /api/documents` updated** — GET returns signed `url` + `thumbnailUrl` per doc; DELETE removes Storage objects (original + thumbnail) before row delete. Done.
9. **Documentation** (this task) — CHANGELOG [4.3.0], CLAUDE.md env/routes/lib, session handoff, chatlog. Done.

## Test bug caught in Task 2

`tests/unit/lib/storage.test.ts` — the `isStorageConfigured` function checks `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The test was setting `process.env` values for the positive case and deleting them for the negative case, but the module cached the env-check result at import time via a default-param pattern. Fix: use `vi.resetModules()` + dynamic import per test group so each sub-test gets a fresh module evaluation with the intended env state.

## Pending Supabase setup (USER actions)

1. Create a **private** Supabase Storage bucket named `atelier-files` (or set `SUPABASE_STORAGE_BUCKET`).
2. Add to `.env.local` and Vercel dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Run `DIRECT_URL=… npx drizzle-kit migrate` to apply migration `0002`.
4. Live-Storage smoke: upload a document through the UI, confirm `ready` status, thumbnail, and signed URL work.

## What's next

Stage 2 (chat-attachment migration off base64 → Storage) — separate brainstorm → spec → plan. Then C3 UI (thumbnail display in project landing page, etc.).
