# Artifacts Gallery (Claude-style) — Design Spec

_Date: 2026-06-25. Status: approved (open decisions locked by the engineer per user delegation)._

## Goal

Bring the Atelier **Artifacts** page (`ArtifactsView`) up to the look and functionality of Claude.ai's Artifacts gallery: a responsive grid of rich cards with **rendered preview thumbnails**, a **search bar**, a **type filter**, per-card **metadata** (edited time + source chip), and a **New artifact** action that authors an artifact from scratch.

Reference: Claude.ai Artifacts page (card grid w/ live HTML thumbnails, search, "Filter by All", "New artifact ▾", per-card "Edited X ago" + source chip). Atelier's current page is a bare list of icon+title+Download tiles.

## Scope

In:
1. Redesigned `ArtifactsView` page chrome: title, **type filter** dropdown, **New artifact** dropdown, full-width **search**, responsive 2/3/4-col grid, loading + empty states preserved.
2. New `ArtifactGalleryCard` with a **lazy-mounted, non-interactive preview thumbnail** by type + metadata row + hover Download. (The existing chat-bubble `ArtifactCard` is unchanged.)
3. **Open** a gallery card into the existing `ArtifactWorkspace` (Preview/Edit/Versions/Download/regenerate) — wire the workspace to render in the `'artifacts'` view.
4. **New artifact** flow: pick a type → create a standalone host chat + blank-template artifact (v1) → open in the workspace Edit tab. All 5 types (HTML, PDF, DOCX, PPTX, XLSX).
5. Extend `getAllArtifacts`/`toArtifactSummary` with `editedAt`, `chatTitle`, `projectName` (no migration).
6. Client-side search + type filter (pure reducer, unit-tested).

Out (non-goals — no backing data model; do not invent):
- Published/Private visibility toggle or sharing.
- View counts / view tracking.
- Folders/tags/collections.
- Bulk select/delete in the gallery (single delete already exists via `DELETE /api/artifacts`).
- DB schema migrations (everything is achievable with query/join changes + new server actions).

## Locked decisions

- **Filter dimension:** `type` only (All / HTML / PDF / Spreadsheet=xlsx / Document=docx / Slides=pptx). Status is near-uniformly `ready`, so it is not offered.
- **New-artifact types:** all 5, HTML first in the dropdown. Blank templates rendered via the existing `renderArtifact`:
  - `html` → minimal styled HTML5 starter page (`<h1>` + paragraph).
  - `docx` / `pdf` / `pptx` → `format: 'markdown'`, content `"# Untitled\n\nStart writing your content here."`.
  - `xlsx` → `format: 'sheets'`, content = one `SheetSpec` with a header row + one empty row (exact shape verified against `src/lib/artifacts/types.ts` during implementation).
- **Host chat:** a normal standalone chat created via `createStandaloneChat`, titled after the artifact (default `"Untitled <TypeLabel> artifact"`). It appears in Recents as the artifact's home. Renaming the artifact title also renames the host chat. No hidden/flag column (that would require a migration).
- **Source chip:** `projectName` when `projectId` is set, else `chatTitle`; clicking opens that chat/project. Falls back to `"Chat"` if both are null.
- **Edited time:** `editedAt` = `MAX(artifact_versions.created_at)` for the artifact, falling back to `artifacts.created_at`. Computed via a join/grouped subquery in `getAllArtifacts` — no `updated_at` column.
- **Thumbnail perf:** previews are **lazy-mounted** via `IntersectionObserver` (only render when scrolled near the viewport) and **non-interactive** (sandboxed `<iframe srcDoc>` / `pointer-events: none`, scaled). `getAllArtifacts` keeps its `limit = 60`. Signed URLs batch-minted via `createSignedUrls` (the audit-noted optimization) where practical.

## Architecture & components

```
src/components/chat/
  ArtifactsView.tsx          # REWRITE: chrome (title, filter, New-artifact, search) + grid + workspace mount
  ArtifactGalleryCard.tsx    # NEW: thumbnail + title + metadata row + hover Download
  ArtifactThumbnail.tsx      # NEW: lazy, non-interactive preview by type (reuses ArtifactPreview logic)
  ArtifactCard.tsx           # UNCHANGED (chat bubble)
src/lib/artifacts/
  templates.ts               # NEW: blankArtifactTemplate(type) -> { format, content, title }
  (render.ts, tool.ts, ...)  # UNCHANGED
src/lib/
  artifactFilter.ts          # NEW: pure filterArtifacts(list, { query, type }) reducer
src/app/actions.ts           # createBlankArtifact(type); getAllArtifacts/toArtifactSummary extended
src/app/page.tsx             # wire onOpen(id) -> activeArtifactId; render ArtifactWorkspace in 'artifacts' view
src/types.ts                 # ArtifactSummary += editedAt, chatTitle, projectName
```

### Data flow
- **List:** `getAllArtifacts()` → rows + `editedAt`/`chatTitle`/`projectName` + batch-signed `downloadUrl`. `ArtifactsView` holds the list; `artifactFilter` derives the visible subset from `{ query, type }` state.
- **Thumbnail:** `ArtifactThumbnail` mounts its preview only when visible. HTML → sandboxed scaled `srcDoc`; PDF → `<iframe src={downloadUrl}>`; xlsx → table snippet; docx/pptx → markdown snippet; else → branded type tile.
- **Open:** card click → `onOpen(id)` → `setActiveArtifactId(id)` in `page.tsx`; the existing `ArtifactWorkspace` renders as the side panel over the gallery.
- **New artifact:** dropdown → `createBlankArtifact(type)` server action:
  1. `createStandaloneChat("Untitled <TypeLabel> artifact")` → host chat.
  2. `blankArtifactTemplate(type)` → `{ format, content, title }`.
  3. `renderArtifact(type, title, content)` → buffer; `uploadBuffer` to `artifacts/standalone/<id>/…`.
  4. `createArtifact({ chatId, projectId: null, type, title, format, content, storagePath })` (+ seed v1).
  5. Return `{ artifactId, chatId }`; client opens the workspace Edit tab and refreshes the gallery.

### Error handling
- Storage not configured → `createBlankArtifact` returns a 503-style error; the dropdown shows a toast, no partial rows (host chat is created only after the template renders; on render/upload failure, roll back the host chat + any storage object, mirroring the edit/regenerate rollback pattern).
- Thumbnail render failure (bad content, expired URL) → falls back to the branded type tile; never throws into the grid.
- List load failure → existing empty/looks-clean handling.

## Testing
- `tests/unit/lib/artifactFilter.test.ts` — query + type filtering, case-insensitivity, empty states.
- `tests/unit/lib/artifacts/templates.test.ts` — each of the 5 types yields content that `renderArtifact` accepts (buffer + contentType + ext).
- `tests/unit/actions/blank-artifact.test.ts` (PGlite) — `createBlankArtifact(type)` creates a host chat + a ready artifact with v1 for each type; rollback on render failure leaves no orphan rows.
- `tests/unit/actions/all-artifacts.test.ts` — extend to assert `editedAt`/`chatTitle`/`projectName` shape (editedAt reflects the latest version).
- Existing artifact route/workspace tests stay green.

## Verification gate (per project cadence)
`npm run typecheck` (0 errors) · `npm run lint` (0 errors; ≤27 baseline warnings) · `npm run build` · `npm test` (all pass, new tests included) · manual `npm run dev` smoke: gallery renders thumbnails, search + filter work, a card opens the workspace, New artifact (each type) creates + opens an editable artifact, Download works.

## Risks / mitigations
- **Too many live iframes** (perf): lazy IntersectionObserver mounting + non-interactive sandboxed iframes; capped at 60.
- **Scratch chats cluttering Recents:** named after the artifact and behave as its home; same lifecycle as "New chat". Revisit a hidden flag only if it becomes a real annoyance (would need a migration).
- **`editedAt` subquery cost:** bounded by `limit 60`; uses indexed `artifact_versions.artifact_id`.
- **Opening the workspace from a non-chat view:** verify `ArtifactWorkspace` doesn't assume an active chat context; it reads the artifact + versions by id, so it should be context-independent — confirm during implementation.

## Definition of done
The Atelier Artifacts page visually and functionally mirrors the Claude reference within Atelier's data model: searchable, type-filterable grid of preview-thumbnail cards with edited-time + source chip; cards open the full workspace; New artifact authors any of the 5 types from scratch. Gate green; CHANGELOG + handoff updated; shipped per cadence.
