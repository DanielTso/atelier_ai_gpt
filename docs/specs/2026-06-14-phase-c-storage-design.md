# Phase C-storage — Supabase Storage for documents & attachments

**Status:** Approved design (2026-06-14). **Program:** Part C of the Atelier Studio workhorse effort (A: Claude ✓ · B: pgvector ✓ · B2: advanced RAG ✓ · **C2: vision extraction ✓** · **C-storage: this spec** · C3: UI · D: Excel/Word artifacts). Branch: `phase-c-extraction`.

---

## Goal

Persist uploaded files instead of discarding originals and stuffing images into the DB as base64:

1. **Document originals + first-page thumbnails** in Supabase Storage, so users can view the source plan (and C3 can show thumbnails).
2. **Direct-to-Storage upload** — the client uploads straight to Storage via a signed URL, so large construction plans bypass the Vercel function request-body limit (the real fix the 50 MB app cap can't escape).
3. **Migrate chat attachments** (`message_attachments`) off base64 `dataUrl` to Storage references, with a backward-compatible read path for existing rows.

The C2 extraction pipeline (render → vision → chunk → embed → pgvector) is reused unchanged; only *where the bytes come from* changes (downloaded from Storage instead of read from the request body).

## Current state (what exists)

- `documents` stores metadata + extracted text → `document_chunks` only. **The original file is never persisted.** Upload is inline: `POST /api/documents` reads the file from the request body, runs the C2 pipeline synchronously, returns.
- `message_attachments` stores images (user-attached + Nano-Banana-generated) as base64 `dataUrl` (`NOT NULL`), saved via `saveMessageAttachments()` and reconstructed as `file` parts on load.
- DB is Supabase Postgres via Drizzle/postgres-js (Phase B). No Storage client yet. App has **no user auth**.

## Locked decisions

- **Full scope, two execution stages, one spec.** Stage 1 = Storage foundation + Documents. Stage 2 = chat-attachments migration. They share only `src/lib/storage.ts`; Stage 1 ships and is verified before Stage 2 (Stage 2 touches the live chat-image display path → more regression risk).
- **Private bucket + signed URLs.** One private bucket (`atelier-files`) with `documents/…` and `attachments/…` prefixes. Uploads via short-lived signed *upload* URLs; downloads via short-lived signed *GET* URLs minted server-side on demand. Nothing is publicly reachable (construction plans can be confidential).
- **Service-role key, server-only.** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are new env vars; the service-role key is added to the sensitive-keys denylist and never reaches client code. All privileged Storage ops (mint URLs, download, thumbnail upload, delete) are server-side.
- **Browser direct-upload uses the anon key.** The PUT to a signed upload URL is performed by `@supabase/supabase-js` in the browser via `uploadToSignedUrl(path, token, file)` — verified against current Supabase docs (a raw PUT still needs the project `apikey`, so the SDK is the robust path). This needs two **public** env vars: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key is public-safe). Security holds: the signed upload *token* authorizes only that single write into the private bucket; the anon key alone can neither read nor list private objects. All reads go through server-minted signed GET URLs.
- **Client-orchestrated 3-step upload flow** (no Storage webhooks): mint upload URL → client PUT → client calls process endpoint. Simplest, no extra Supabase config, fully testable.
- **DB stays on Drizzle/postgres-js.** `@supabase/supabase-js` is used for the **Storage API only**.
- **Document upload now requires Storage configured** (it rides on the same Supabase project as the DB). `isStorageConfigured()` gives a clear error when it isn't, rather than crashing.
- **Thumbnails are best-effort** — failure → `status: ready` with `thumbnailPath = null` (same posture as embeddings today). No silent failures: log them.
- **No backfill** of existing base64 attachment rows — the dual read-path covers them.

## Architecture

### Shared foundation — `src/lib/storage.ts`
Server-only module wrapping `@supabase/supabase-js` (Storage API only; no DB access — storage and persistence stay cleanly separated). Lazily constructs a singleton client from env (per-request safe, like the AI providers). Exposes:
- `isStorageConfigured(): boolean`
- `createSignedUploadUrl(path): Promise<{ signedUrl, token, path }>`
- `uploadBuffer(path, buffer, contentType): Promise<void>` — server-side uploads (thumbnails, migrated attachments)
- `downloadToBuffer(path): Promise<Buffer>` — fetch the original for processing
- `createSignedDownloadUrl(path, ttlSeconds): Promise<string>` — for the UI
- `removeObjects(paths: string[]): Promise<void>` — delete cleanup

Each helper throws a sanitized error on failure (caught by routes via the existing `apiError`).

### Stage 1 — Document flow (replaces inline `POST /api/documents` upload)
1. **`POST /api/documents/upload-url`** — validates `filename`/`type`/`size` (size capped by `MAX_FILE_SIZE`). Insert a `documents` row (`status: 'uploading'`) to obtain `documentId`, then compute `storagePath = documents/<projectId>/<documentId>/<sanitizedFilename>` and update the row with it (one extra UPDATE; keeps the human-readable integer id in the path). Mint the signed upload URL for that path and return `{ documentId, signedUrl }`.
2. **Client PUT** the file to `signedUrl` (direct to Storage).
3. **`POST /api/documents/process` `{ documentId }`** — loads the row, `downloadToBuffer(storagePath)`, runs the C2 pipeline (`extractTextFromBuffer` / `extractViaVision` / `extractViaVisionImage` by type, same thin-text fallback + image branch as today), renders + uploads a thumbnail, `chunkText` → embed → `document_chunks`, updates `status: ready|error` + `charCount`/`chunkCount`/`thumbnailPath`.
- **`GET /api/documents`** — mints short-lived signed URLs (original + thumbnail) per row for the UI.
- **`DELETE /api/documents`** — `removeObjects([storagePath, thumbnailPath])` then deletes the row (chunks cascade).

The old inline `POST /api/documents` upload is retired in favor of this flow (its processing logic moves into `/process`).

### Thumbnails
A small helper renders **page 1 only** at a low scale (~600px wide) to **WebP** via the already-present `@napi-rs/canvas`; for image uploads it downscales the image itself. Separate from the C2 scale-3 vision render (different purpose/size). Best-effort.

### Stage 2 — Chat attachments migration
- **Write:** `saveMessageAttachments()` uploads each image's bytes to `attachments/<chatId>/<messageId>/<filename>`, stores `storagePath`, leaves `dataUrl` null.
- **Read (dual, backward-compatible):** on load, if `storagePath` present → mint signed GET URL for the `file` part; else fall back to `dataUrl`. `MessagesList`/lightbox already consume a URL string → no UI change.
- **Delete cleanup:** removing a message/chat removes its Storage objects (DB rows cascade).

## Schema changes (additive migration via `drizzle-kit generate` → `migrate`)

- `documents`: add `storage_path text`, `thumbnail_path text` (nullable). `status` gains value `'uploading'` (free-text column → no enum migration).
- `message_attachments`: add `storage_path text` (nullable); make `data_url` **nullable** (was `NOT NULL`).

## File layout

| File | Change |
|---|---|
| `src/lib/storage.ts` (new) | Supabase Storage client + 6 helpers; env accessor; `isStorageConfigured` |
| `src/lib/thumbnails.ts` (new) | page-1 / image downscale → WebP buffer (best-effort) |
| `src/db/schema.ts` | add `storage_path`/`thumbnail_path` to `documents`; `storage_path` + nullable `data_url` on `message_attachments` |
| `drizzle/` | generated additive migration |
| `src/app/api/documents/upload-url/route.ts` (new) | mint signed upload URL + create row |
| `src/app/api/documents/process/route.ts` (new) | download → C2 pipeline → thumbnail → chunk/embed |
| `src/app/api/documents/route.ts` | `GET` mints signed URLs; `DELETE` removes objects; retire inline `POST` |
| `src/app/actions.ts` | `saveMessageAttachments` → Storage; attachment read helper mints signed URLs |
| client (`page.tsx` upload flow) | 3-step upload (upload-url → PUT → process); consume signed URLs |
| `src/lib/validation.ts` | Zod schemas for the new endpoints |
| Tests | `storage.ts`, upload-url/process routes, attachments dual-read, delete cleanup |
| `CLAUDE.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`, chatlog | docs |

## Verification gate (per stage)

`npm run lint && npm run build && npm test && npm run test:e2e`, zero errors/zero new warnings, plus a manual smoke once Supabase Storage is configured: upload a plan → it lands in Storage, processes to `ready`, thumbnail + original are viewable via signed URLs, chat can cite it; delete removes the objects.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Storage misconfigured | `isStorageConfigured()` → clear actionable error, not a crash |
| Large-file processing time (download + N vision calls) | Within the 300s function budget + existing `EXTRACTION_MAX_PAGES` cap; bounded |
| Orphaned objects (client uploads, never calls `/process`) | The `uploading` row is the marker; a periodic cleanup sweep is a deferred, logged nicety |
| Stage 2 regresses chat-image display | Dual read-path keeps old rows working; Stage 1 ships/verifies first; signed-URL swap is behind the same URL-string interface |
| Vercel native-canvas runtime (shared with C2) | Still pending the C2 preview-deploy check; thumbnails reuse the same `@napi-rs/canvas` |

## Non-goals

- The C3 thumbnail/preview UI (this phase produces + serves the data; C3 displays it).
- Resumable/multipart uploads; CDN/cache tuning.
- Backfilling existing base64 attachment rows.
- User auth / per-user access control (no auth in the app yet).

## Pending USER actions (not blocking build — tests mock Storage)

1. Create a **private** bucket `atelier-files` in the Supabase project.
2. Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server) and `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser direct-upload) in `.env.local` (and Vercel) — same project as the DB.
3. Apply the new migration: `DIRECT_URL=… npx drizzle-kit migrate`.

## Definition of done

- [ ] Stage 1: documents upload direct-to-Storage; originals + thumbnails persisted; `GET` serves signed URLs; `DELETE` cleans up; C2 pipeline runs from the downloaded buffer; large plans no longer hit the body limit.
- [ ] Stage 2: new chat attachments in Storage; old base64 rows still render via dual read-path; delete cleans up.
- [ ] Additive migration authored; schema matches.
- [ ] Per-stage: full gate green + manual smoke; docs + chatlog updated.
