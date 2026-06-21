# Phase D2 — Artifacts Workspace — Design

**Status:** Approved-by-delegation (2026-06-21). Sr-engineer decisions recorded here; build follows the phased plan `docs/plans/2026-06-21-d2-artifacts-workspace.md`. Branch per sub-phase off `master`.

## Goal

Turn artifacts from "a download card under a message" into a **workspace**: a dedicated panel where you can **preview** a generated artifact inline, **see its versions**, **edit/regenerate** it, and export — including **PPTX**. Builds on the D1 engine (`generate_artifact` tool → render → Storage → `artifacts` row).

## The architectural hinge (why a schema change is needed)

D1 stores only the **rendered binary** (`storagePath`) — not the source. But this app's artifact types (xlsx/docx/pdf) **can't be rendered live in the browser** from their binaries. So preview, edit, and regenerate all require the **source content** that produced the file:

- `docx`/`pdf` ← a Markdown string
- `xlsx` ← a `SheetSpec[]` (JSON)

**Decision:** persist the source `content` + `format` on the artifact (and per version). Preview then renders the *source* to HTML in-browser (Markdown via the existing `react-markdown`; sheets → an HTML `<table>`); the binary stays the downloadable export. PDFs additionally get the existing signed-URL `<iframe>` preview.

## Locked decisions

- **Source-of-truth = content.** Store `content` (text: markdown or JSON-stringified sheets) + `format` (`markdown`|`sheets`) per version. Re-render to binary on demand/regenerate.
- **Versioning via a child table** `artifact_versions` (not a denormalized column) — each create/edit/regenerate appends a version; `artifacts.current_version` points at the active one. Prior versions retained (files kept in Storage), mirroring the document-revisioning pattern (v4.9.0).
- **Preview is HTML-from-source**, not binary conversion (no headless Office). PDF also iframes the signed URL. xlsx → HTML table; docx → rendered markdown.
- **Workspace panel = right-side pane on the chat view** (Option A from the subsystem map), opened when you click an artifact card; collapsible. Reuses layout width tokens (`--rail-width` sibling, new `--artifact-panel-width`). The existing full-screen `ArtifactsView` (global gallery) stays.
- **Edit** = edit the source in the panel → re-render → new version (no Claude call). **Regenerate** = send the artifact + an instruction back to Claude → new version (Claude call).
- **PPTX** = new pure-JS `toPptx.ts` (`pptxgenjs`), wired into `render.ts` + the tool enum, same shape as docx/pdf (markdown → slides) — additive, low risk.
- **Keep `generate_artifact` for creation**; add a separate server action/route for edit + regenerate (don't overload the tool).

## Non-goals (this phase)

- Live collaborative editing; real-time multi-cursor.
- True WYSIWYG docx/xlsx editing (we edit the *source*, not the binary).
- Per-message artifact pinning (artifacts stay chat-scoped).
- Retention/pruning of old versions (kept; revisit if Storage balloons — same stance as doc revisions).

## Phasing (each its own release + gate)

### D2.1 / v4.15.0 — Source storage + workspace panel + preview + PPTX
- **Migration `0010`:** add `content text`, `format text` to `artifacts`; new `artifact_versions` table (`id, artifact_id (cascade), version, type, title, format, content, storage_path, created_at`) + `artifacts.current_version int default 1`. (Live apply gated.)
- **Engine:** `toPptx.ts` (`pptxgenjs`); `render.ts` + `types.ts` (`ArtifactType` += `'pptx'`); `tool.ts` enum += `pptx`; `tool.execute` also persists `content`+`format` and writes the first `artifact_versions` row.
- **Actions:** extend `createArtifact` to store content/format + seed version 1; `getArtifactVersions(artifactId)`; `getArtifactWithCurrent(id)`. `toArtifactSummary` gains `format`, `content`, `version`, `versionCount`.
- **API/Types:** `GET /api/artifacts?chatId=` returns the richer summary; `ArtifactSummary` extended.
- **UI:** new `ArtifactWorkspace.tsx` right-side panel — header (title/type/version), **preview** (markdown→HTML / sheets→table / pdf→iframe), download, close. `ArtifactCard` click opens it (wire panel state in `page.tsx`). New `ArtifactPreview.tsx` (the source→HTML renderer).
- **Tests:** toPptx render; createArtifact stores content + version row; getArtifactVersions; ArtifactPreview renders markdown + sheets; ArtifactWorkspace opens/closes.

### D2.2 / v4.16.0 — Edit + regenerate + version history
- **Actions/API:** `POST /api/artifacts/:id/edit` (new source → re-render binary → new version + bump `current_version`); `POST /api/artifacts/:id/regenerate` (artifact + instruction → Claude → new content → re-render → new version). New action `addArtifactVersion(...)` (transactional, like `commitDocumentReplacement`).
- **UI:** edit affordance in the panel (editable source textarea for markdown / simple grid for sheets), Regenerate (instruction prompt), **version switcher** (list + restore). 
- **Tests:** edit creates v2 and bumps current; regenerate path (mocked Claude) creates a version; version switch/restore.

## Verification (per phase + final)
- Gate each phase: `npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`.
- Live migrations (`0010`) user-gated.
- Manual smoke: generate an artifact → workspace panel opens with inline preview → download works; (D2.2) edit → v2; regenerate → v3; switch versions.

## Risks / mitigations
- **Preview fidelity** — HTML-from-source ≠ the exact binary layout. Accepted; the binary download is the faithful artifact; preview is for quick review. Label it "Preview (approximate)".
- **`pptxgenjs` serverless-safety** — pure-JS, no native deps; should match the docx/pdf path. Verify in the D2.1 build + a Vercel preview.
- **Storage growth from versions** — retained, no pruning (consistent with doc revisions); revisit later.
- **Migration `0010`** additive/safe; gated live apply.

## Definition of done
Generating an artifact opens a workspace panel with an inline preview + download; PPTX is a supported type; (D2.2) artifacts can be edited and regenerated into new versions with history. Gates green; `0010` applied; released v4.15.0 → v4.16.0.
