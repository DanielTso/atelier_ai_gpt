# Session log — Phase D1: Artifact Engine (2026-06-17)

## Context

Continuing from Phase C (complete: C2 vision extraction + C-storage + C3 documents UI). Branch: `phase-c-extraction`. Goal for this session: build the Phase D1 artifact engine so Claude can generate downloadable XLSX, DOCX, and PDF files via a tool call.

## Brainstorm decisions

- **D1 = engine first, panel later.** Ship the rendering + Storage + tool-call plumbing as D1; the artifact workspace UI (panel, versioning, live preview, edit/regenerate) is D2. Keeps the diff reviewable and the blast radius small.
- **Formats: XLSX, DOCX, PDF.** Chosen for immediate construction-doc value and pure-JS serverless-safe libs: `exceljs` (already a dep), `docx`, `pdf-lib`. PPTX (`pptxgenjs`) deferred to D2+.
- **Tool-call trigger.** Claude decides when to produce an artifact — no UI export menu in D1. The `generate_artifact` AI SDK v6 `tool()` is included in the `/api/chat` `tools` object (alongside `web_search`) only when the model is Claude, a `chatId` exists, and Storage is configured (graceful degradation).
- **New `artifacts` table** (not reusing `documents`): different lifecycle, no chunking/embedding, different status set.
- **Storage path:** `artifacts/<projectId|standalone>/<artifactId>/<slug>.<ext>` in the existing private `atelier-files` bucket — reuses the C-storage pipeline with no new infra.
- **Chat-keyed in D1.** Artifacts are fetched by `chatId` and displayed as a group below the chat; per-message pinning is D2.

## Tasks + outcomes

| # | Task | Outcome |
|---|---|---|
| 1 | Schema + migration `0005` (`artifacts` table) | Done. `drizzle/0005_lyrical_onslaught.sql` applied to live Supabase. |
| 2 | Server actions (`createArtifact`, `getArtifactById`, `getChatArtifacts`, `updateArtifactStoragePath`, `deleteArtifact`) | Done in `src/app/actions.ts`. |
| 3 | Renderers (`src/lib/artifacts/`: `types.ts`, `toXlsx.ts`, `toDocx.ts`, `toPdf.ts`, `render.ts`) | Done. Pure-JS, no native deps. |
| 4 | `generate_artifact` tool (`src/lib/artifacts/tool.ts`) | Done. AI SDK v6 `tool()` with `execute` that renders → uploads → persists → returns signed URL. |
| 5 | Wire tool into `/api/chat` | Done. Added alongside `web_search` under the Claude branch; gated on `chatId` + `isStorageConfigured()`. |
| 6 | `/api/artifacts` route (`GET ?chatId=` + `DELETE ?id=`) | Done in `src/app/api/artifacts/route.ts`. |
| 7 | Client: `ArtifactSummary` type, `ArtifactCard`, `MessagesList` + `page.tsx` integration | Done. `ArtifactCard` renders icon/title/type/Download; `page.tsx` fetches on open + re-fetches after each assistant response. |

## Test counts

Full suite: **215 tests pass** (up from 203 in C3).

New tests (12 total):
- `tests/unit/lib/artifacts/render.test.ts` — 4 tests (xlsx/docx/pdf render + dispatch)
- `tests/unit/lib/artifacts/tool.test.ts` — 2 tests (tool execute happy path + Storage-not-configured skip)
- `tests/unit/actions/artifacts.test.ts` — 2 tests (create + getChatArtifacts)
- `tests/unit/api/artifacts-route.test.ts` — 2 tests (GET returns signed URLs, DELETE removes Storage + row)
- `tests/unit/components/ArtifactCard.test.ts` — 2 tests (renders title/type; Download link href)

## Schema

Migration `drizzle/0005_lyrical_onslaught.sql` applied to live Supabase. Migrations `0000`–`0005` are current. No pending USER migration action needed for D1.

## Live smoke

Chat-driven smoke (ask Claude to "generate a weekly construction schedule as an xlsx") is best run in-browser with the real Anthropic key + Supabase Storage configured. Unit tests cover the rendering and tool paths with mocked storage; no automated E2E covers the full round-trip.

## Verification gate

- `npm run lint` — 0 errors, 30 warnings (baseline; zero new)
- `npm run build` — clean
- `npm test` — 215 tests pass
- `npm run typecheck` — clean

## What's next (D2)

Artifact workspace panel: per-message artifact pinning, live preview (HTML/markdown in an iframe), versioning (regenerate → new row, picker to select version), edit/regenerate UX, PPTX support.
