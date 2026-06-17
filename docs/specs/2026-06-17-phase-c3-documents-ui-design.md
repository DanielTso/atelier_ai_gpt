# Phase C3 — Documents UI Design

**Status:** Approved design (2026-06-17). **Program:** final sub-phase of **Phase C** of the Atelier Studio workhorse effort (A ✓ · B ✓ · B2 ✓ · C2 ✓ · C-storage ✓ · **C3: this spec** · D: Artifacts). Branch: `phase-c-extraction`.

---

## Goal

Surface in the UI what C-storage now produces: per-document **first-page thumbnail** (signed `thumbnailUrl`), **original** (signed `url`), **status** (`uploading | processing | ready | error`), and **extraction method** (text vs vision). Make uploaded plans/drawings recognizable at a glance and previewable (original + extracted text), across the project **Files panel** and the **Documents dialog**. Also fix a regression where one uploader still calls the retired inline endpoint.

## Current state (what exists)

- **`ProjectLandingPage`** (right "Files" panel): thumbnail-less card grid (type badge, filename, chunk/size, status), drag-drop upload, click → `DocumentPreviewDialog`. **Its `handleUpload` still POSTs to the retired inline `/api/documents`** (broken since C-storage Stage 1 removed that POST).
- **`ProjectDocumentsDialog`**: list rows + status icons + delete; upload already migrated to the 3-step flow (the only place that logic lives).
- **`DocumentPreviewDialog`**: shows only reconstructed **extracted text** (via `getDocumentChunks` + overlap-dedup). No visual original.
- **`GET /api/documents`** already returns each doc with `url` + `thumbnailUrl` (signed). `documents` has no `extraction_method` column. The `Document` interface is duplicated across the 3 components (no `url`/`thumbnailUrl`/`extractionMethod`, status as bare `string`).
- Chat-image lightbox (`MessagesList`) already consumes signed URLs (Stage 2) — fine as-is.

## Locked decisions

- **Layout: thumbnail cards** (option A) for **both** the Files panel and the Documents dialog, via a shared `DocumentCard`. Thumbnail when present; **file-type tile fallback** for text/code/docx/xlsx (no thumbnail generated).
- **Preview: tabs** (option A) — "Preview" (visual original) + "Extracted text" (existing). **Preview tab only renders when a visual original exists** (PDF or image); for docx/xlsx/text/code the dialog shows extracted text only.
- **Method badge in scope** — `documents.extraction_method` (`'text' | 'vision'`), shown as a small chip (e.g. a "vision" chip when a plan was read by vision).
- **Fix the landing-page uploader** as part of C3 by extracting the 3-step flow into a shared unit both surfaces use (DRY).
- **Status `uploading`** gets a UI treatment (today it falls through with no icon).

## Architecture

### Shared units (DRY — the clean build)
- **`useDocumentUpload` hook** (`src/hooks/useDocumentUpload.ts`): encapsulates the 3-step flow — `POST /api/documents/upload-url` → browser `uploadToSignedUrl` (`src/lib/storageClient.ts`) → `POST /api/documents/process` — exposing `{ upload(file, projectId), uploading }`. Replaces the bespoke `handleUpload` in `ProjectDocumentsDialog` **and** the broken one in `ProjectLandingPage`. Single source of truth for uploads.
- **`DocumentCard` component** (`src/components/chat/DocumentCard.tsx`): one card for both surfaces. Renders: thumbnail (`thumbnailUrl`) with file-type-tile fallback; filename; status (`uploading`/`processing` spinner, `ready` check, `error` alert + message); **method chip** (`vision`/`text`); chunk count; delete affordance; click → opens preview. Props are a typed `DocumentSummary`.
- **`DocumentSummary` type** (`src/types.ts`): the single shared shape — `id, filename, mimeType, fileSize, chunkCount, status: 'uploading'|'processing'|'ready'|'error', errorMessage, url, thumbnailUrl, extractionMethod`. The 3 components stop redeclaring their own `Document` interfaces.

### Preview dialog
`DocumentPreviewDialog` gains a tab strip. **Preview tab** (only when `mimeType` is image/* or pdf): images → `<img src={url}>`; PDFs → `<iframe src={url}>` (browser-native PDF render of the signed URL). **Extracted-text tab**: the existing chunk reconstruction. An "Open original" link (the signed `url`) is always available. Needs `url` + `mimeType` passed in (currently only metadata is passed).

### Backend / data (small slice)
- **Migration `0004`**: `ALTER TABLE documents ADD COLUMN extraction_method text;` (nullable).
- **`/api/documents/process`**: set `extraction_method` when updating status to `ready` — `'vision'` if the vision path (image vision, or the thin-PDF vision fallback that beat the text layer) produced the content, else `'text'`.
- **`GET /api/documents`**: unchanged code — `extraction_method` flows through automatically once the column exists (route returns the row spread + signed URLs).
- **Schema in `src/db/schema.ts`**: add `extractionMethod: text('extraction_method')` to `documents`.

## File layout

| File | Change |
|---|---|
| `src/db/schema.ts` + `drizzle/0004_*` | add `documents.extraction_method` |
| `src/app/api/documents/process/route.ts` | set `extractionMethod` in the final `updateDocumentStatus` |
| `src/app/actions.ts` | `updateDocumentStatus` updates accept `extractionMethod` |
| `src/types.ts` | new `DocumentSummary` type |
| `src/hooks/useDocumentUpload.ts` (new) | shared 3-step upload hook |
| `src/components/chat/DocumentCard.tsx` (new) | shared thumbnail card |
| `src/components/ui/ProjectDocumentsDialog.tsx` | use the hook + `DocumentCard` grid; show `uploading` |
| `src/components/chat/ProjectLandingPage.tsx` | use the hook (fixes broken uploader) + `DocumentCard` grid; add images to `accept` |
| `src/components/ui/DocumentPreviewDialog.tsx` | tabbed Preview + Extracted text; accept `url`/`mimeType` |
| Tests | `DocumentCard`, preview tabs (jsdom); `/process` extraction_method unit |
| `CLAUDE.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`, chatlog | docs |

## Verification gate

`npm run lint && npm run build && npm test` — 0 errors, 0 new warnings, all green. Manual smoke against the live Supabase: upload a PDF → thumbnail card appears, status transitions to `ready` with a **vision** badge, clicking opens the tabbed preview (PDF renders + extracted text); upload from the **project landing page** (drag-drop) now works; delete still cleans up.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Signed-URL expiry on a long-open Files panel (thumbnails 403) | URLs are minted per `GET /api/documents` load; re-fetch on dialog open / panel mount. Acceptable for a session. |
| PDF `<iframe>` rendering varies by browser | Always offer "Open original" link as the fallback; preview is a convenience. |
| `extraction_method` for pre-C3 rows is null | Badge simply hidden when null (no backfill). |
| Duplicated `Document` interfaces drift during refactor | The shared `DocumentSummary` type is introduced first; all three consumers switch to it. |

## Non-goals

- Artifacts generation/export — **Phase D**.
- Multi-page PDF page-flipping in preview (first page + "open original" only).
- Reworking the chat-image lightbox (already correct on signed URLs).
- Backfilling `extraction_method` for existing rows.

## Definition of done

- [ ] Thumbnail-card grid (shared `DocumentCard`) on both Files panel + Documents dialog, with status (incl. `uploading`) + method chip.
- [ ] Tabbed preview (visual original + extracted text) via signed URLs.
- [ ] Landing-page uploader fixed via the shared `useDocumentUpload` hook.
- [ ] `extraction_method` column + populated in `/process` + surfaced in the badge.
- [ ] Full gate green + manual smoke; docs updated. Closes Phase C.
