# Document Re-versioning (replace + retained history) — Design

**Status:** Approved design (2026-06-19). Branch: `feat/doc-reversioning` (off `master`, post v4.8.0). First of two deferred items; auto-memory is the second (separate spec later).

## Goal

Let a project document be **updated in place** when its source is revised (construction drawings/specs go Rev A → B → IFC), instead of forcing delete + re-upload. The **current revision** stays the active RAG knowledge (same document identity); **prior revisions are retained** (files kept in Storage + a metadata record) so an audit trail exists and a history/restore UI can be added later without data loss.

## Decisions (locked)

- **A+ : replace-in-place, retain history.** Current revision in `documents` (with chunks); superseded revisions in a new `document_revisions` table with their files retained but **no chunks** (RAG searches only the latest).
- **Capacity meter stays current-revision-only for now** (it under-counts retained files — accepted; Supabase Pro storage is ample). A revision-aware meter is a deferred follow-up.
- **History/restore/compare UI deferred** — the data is captured so it's additive later.

## Non-goals

- No restore/compare UI in this pass.
- No retention/pruning policy (revisions accumulate; revisit if storage balloons).
- No change to the fresh-upload path's behavior.
- Auto-memory is out of scope (separate feature).

## Current state

- **`documents`**: `id, projectId, filename, mimeType, fileSize, charCount, chunkCount, status, errorMessage, storagePath, thumbnailPath, extractionMethod, createdAt`. **`documentChunks`**: `documentId (FK cascade), projectId, chunkIndex, content, embedding(768)`.
- **3-step pipeline:** `POST /api/documents/upload-url` (validates, `createUploadingDocument` → row status `uploading`, returns `{documentId, path, token, bucket}`) → browser `uploadToSignedUrl` → `POST /api/documents/process {documentId}` (download from `doc.storagePath`, extract → chunk (`saveDocumentChunks`) → embed (`updateChunkEmbedding`) → thumbnail → `updateDocumentStatus(ready)`).
- **`DELETE /api/documents`** removes Storage objects + row (chunks cascade).
- **`useDocumentUpload`** hook drives the 3 steps. **`DocumentCard`** shows the card + hover delete. **`DocumentSummary`** type in `src/types.ts`.
- Validation: `uploadUrlRequestSchema {projectId, filename, contentType, size}`, `processDocumentRequestSchema {documentId}`.

## Data model — migration `0007` (additive, safe; live-apply gated)

```sql
ALTER TABLE "documents" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "documents" ADD COLUMN "updated_at" timestamptz;

CREATE TABLE "document_revisions" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "storage_path" text,
  "thumbnail_path" text,
  "char_count" integer,
  "chunk_count" integer,
  "extraction_method" text,
  "created_at" timestamptz DEFAULT now()
);
CREATE INDEX "idx_doc_revisions_document_id" ON "document_revisions"("document_id");
```
Schema added to `src/db/schema.ts` (`documents.revision`, `documents.updatedAt`, `documentRevisions` table). Authored with `drizzle-kit generate`.

## Flow

### upload-url (replace variant)
`uploadUrlRequestSchema` gains optional **`replaceDocumentId: number`**. When present:
- Validate the target document exists and belongs to a project; same name/type/size validation as a new upload.
- Compute the **new revision path**: `documents/<projectId>/<documentId>/rev<currentRevision + 1>/<sanitized-filename>`.
- Create a signed upload token for the new path. **Do not** mutate `documents.storagePath` (the old file must remain reachable until process succeeds). Set `documents.status = 'uploading'`.
- Return `{ documentId, path: newPath, token, bucket }` (same shape as new upload, but `documentId` is the existing one).

### process (replace variant)
`processDocumentRequestSchema` gains optional **`storagePath: string`** (the new revision path). When present (a replace):
1. Load the current document (`getDocumentById`). Capture old metadata + `storagePath`.
2. **Snapshot the superseded revision** → `createDocumentRevision({ documentId, projectId, revision: doc.revision, filename, mimeType, fileSize, storagePath: doc.storagePath, thumbnailPath, charCount, chunkCount, extractionMethod })`. (Old file is **retained**.)
3. Download the **new** file from the passed `storagePath`; run the existing extract → (vision fallback) → chunk pipeline.
4. **Delete old chunks**: `deleteDocumentChunks(documentId)` before saving the new ones (so RAG reflects only the new revision).
5. Save new chunks + embeddings; generate new thumbnail (uploaded to a new path).
6. **`applyDocumentReplacement(documentId, { filename, mimeType, fileSize, storagePath: newPath, thumbnailPath, charCount, chunkCount, extractionMethod, status, revision: doc.revision + 1, updatedAt: now })`**.
7. The **old file is kept** (referenced by the revision row); the old thumbnail is kept too. Failure path: set status `error`, leave the old revision intact (don't delete old chunks until the new extraction succeeds — do the chunk delete only after successful extraction).

Fresh-upload path is unchanged (no `storagePath` passed → reads `doc.storagePath` as today).

## Server actions (`src/app/actions.ts`)
- `createDocumentRevision(data)` — insert a `document_revisions` row.
- `deleteDocumentChunks(documentId)` — `db.delete(documentChunks).where(eq(documentId))`.
- `getDocumentRevisions(documentId)` — list revisions newest-first (for the future history UI; cheap to add now).
- `applyDocumentReplacement(documentId, fields)` — update the `documents` row with new metadata + `revision`/`updatedAt`.
- `getDocuments` extended to return `revision`, `updatedAt`.

## Types & UI
- **`DocumentSummary`** (`src/types.ts`) gains `revision: number`, `updatedAt: Date | null`.
- **`useDocumentUpload`** gains `replace(file, documentId)` — request replace-url (`replaceDocumentId`) → `uploadToSignedUrl` → process with the new `storagePath`.
- **`DocumentCard`** — a **"Replace / Update"** action (hover menu beside delete) opens a file picker → `replace(...)`. Shows a **"Rev N"** chip + **"Updated <short date>"** when `revision > 1`. Reuses the existing status icons.
- **`GET /api/documents`** returns `revision`/`updatedAt` (already returns the doc fields).

## Testing
- **Unit (actions, PGlite):** replace creates a `document_revisions` snapshot of the old state; `deleteDocumentChunks` clears prior chunks; `applyDocumentReplacement` bumps `revision` and sets `updatedAt` + new metadata; `getDocumentRevisions` returns the history.
- **Unit (process route, mocked extract/embed/storage):** replace path snapshots → deletes old chunks → saves new → increments revision; fresh-upload path unchanged.
- **Component (`DocumentCard`):** Rev chip + "Updated" shown when `revision > 1`; Replace action fires the picker/callback.
- All existing tests stay green; lint 0 errors, build clean. PGlite applies `0007`.

## Verification gate
`npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`. **Live `0007` apply is user-gated.** Manual smoke: upload a doc, "Replace" it with a new file → card shows Rev 2 / Updated; old chunks gone, new chunks searchable; a `document_revisions` row exists; the old file still in Storage.

## Risks / mitigations
- **Capacity meter under-counts retained revisions** — accepted (Pro storage ample); revision-aware meter deferred.
- **Storage growth** — unbounded retained revisions; a retention policy is a later option if it matters.
- **Replace failure mid-flow** — only delete old chunks *after* the new extraction succeeds; on failure mark `error` and keep the prior revision usable.
- **Migration `0007`** additive/nullable-safe; apply to live Supabase before the replace flow deploys.

## Definition of done
Replace updates a document in place (same id), latest revision is the active RAG knowledge, prior revisions retained (file + metadata), card shows Rev/Updated, gate green, `0007` applied.
