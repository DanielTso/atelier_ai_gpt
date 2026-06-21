# Phase D2 — Artifacts Workspace — Plan

Spec: `docs/specs/2026-06-21-d2-artifacts-workspace-design.md`. Each sub-phase: implement → gate (`npm run lint` 0 errors / `npm run typecheck` / `npm run build` / `npm test`) → commit → `--no-ff` merge → tag. Live migrations user-gated.

## D2.1 / v4.15.0 — Source storage + workspace panel + preview + PPTX

**Task 1 — Schema + migration `0010`** (`src/db/schema.ts`)
- `artifacts` += `content text`, `format text`, `currentVersion integer default 1`.
- New `artifact_versions`: `id` PK, `artifactId` (FK cascade), `version int`, `type text`, `title text`, `format text`, `content text`, `storagePath text`, `createdAt`. Index on `artifactId`.
- `npx drizzle-kit generate`. Gate via PGlite test. **Live apply gated.**

**Task 2 — PPTX renderer** (`src/lib/artifacts/`)
- `toPptx.ts` (`pptxgenjs`, markdown → slides: H1=new slide title, bullets, paragraphs). `types.ts` `ArtifactType += 'pptx'`. `render.ts` dispatch + contentType. `tool.ts` input enum += `pptx`. Add dep `pptxgenjs`. Tests: render returns a PPTX (ZIP magic `PK`).

**Task 3 — Actions + content/version persistence** (`src/app/actions.ts`)
- Extend `createArtifact` to accept+store `content`/`format` and insert `artifact_versions` v1 in a transaction.
- `getArtifactVersions(artifactId)`; extend `toArtifactSummary` → `format`, `content`, `version`, `versionCount`. Update `ArtifactSummary` (`src/types.ts`).
- Tests (PGlite): create stores content + seeds version 1; getArtifactVersions returns history.

**Task 4 — Tool wires content through** (`src/lib/artifacts/tool.ts`)
- `execute` passes `format` + stringified `content` into `createArtifact`. Tests: tool persists content/format.

**Task 5 — Preview component** (`src/components/chat/ArtifactPreview.tsx`)
- markdown → `react-markdown`; sheets (`SheetSpec[]`) → HTML `<table>` (first row bold); pdf → `<iframe>` of signed `downloadUrl`; xlsx/docx/pptx → the source-rendered HTML + "download for exact file" note. Label "Preview (approximate)". Component test: renders markdown + a sheet table.

**Task 6 — Workspace panel** (`src/components/chat/ArtifactWorkspace.tsx` + `page.tsx`)
- Right-side collapsible panel: header (title/type/version/versionCount), `<ArtifactPreview>`, download link, close. New `--artifact-panel-width` token in `globals.css`. `page.tsx`: `activeArtifactId` state; `ArtifactCard` click opens the panel; render panel beside the chat thread when open. Component test: opens with an artifact, close clears it.

**Task 7 — Gate + docs + release** — full gate; CHANGELOG `[4.15.0]`; bump version; merge; **pause for live `0010` apply**; tag `v4.15.0`; release.

## D2.2 / v4.16.0 — Edit + regenerate + version history
- `addArtifactVersion(...)` (transactional: render new binary → insert version → bump `currentVersion`).
- `POST /api/artifacts/:id/edit` (new source → re-render → version) and `POST /api/artifacts/:id/regenerate` (artifact + instruction → Claude → new content → version).
- UI: editable source in the panel; Regenerate (instruction); version switcher (list + restore).
- Tests: edit→v2 + current bumped; regenerate (mocked Claude)→version; restore. Gate → release v4.16.0.

## Deferred
WYSIWYG binary editing; version pruning; per-message pinning; collaborative editing.
