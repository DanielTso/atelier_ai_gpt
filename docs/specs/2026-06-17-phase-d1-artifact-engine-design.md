# Phase D1 — Artifact Engine Design

**Status:** Approved design (2026-06-17). **Program:** Phase D (Artifacts) of the Atelier Studio workhorse effort (A ✓ · B ✓ · B2 ✓ · C ✓ · **D1: this spec** · D2: artifact workspace UI). Branch: `phase-c-extraction` (Phase C merged-pending; D1 builds on it).

---

## Goal

Let Claude generate **downloadable artifacts** — real `.xlsx` / `.docx` / `.pdf` files — the way Claude.ai does: when you ask for a report, schedule, or write-up, the model calls a `generate_artifact` tool with structured content; the server renders the binary, stores it in the `atelier-files` Supabase bucket, and returns a downloadable artifact that renders inline in chat as a card. The chat *model* can't emit binaries, but the *app* can.

D1 is the **engine**. The rich workspace panel (live preview, versioning, edit/regenerate) is **D2** — out of scope here.

## Current state (what D1 builds on)

- **Chat** streams via `streamText` in `src/app/api/chat/route.ts`; tools come from `createProvider` (`src/lib/providers.ts`) — Claude gets `web_search`. Adding a custom AI SDK `tool()` to the `tools` object is the integration point.
- **Storage** (C-storage): `src/lib/storage.ts` (`uploadBuffer`, `createSignedDownloadUrl`, `removeObjects`, private `atelier-files` bucket). Reused as-is.
- **DB**: Drizzle/postgres-js; migrations `0000`→`0004` applied live. `exceljs` already a dependency (reads xlsx today; writes too).
- **Client**: `MessagesList` renders message `parts`; `DocumentCard` is the card visual language to mirror.

## Locked decisions

- **Formats: XLSX, DOCX, PDF.** Source content: **Markdown** for DOCX/PDF; a **typed sheet JSON** for XLSX. **PPTX deferred** (easy add later via `pptxgenjs`; not core to construction reports/schedules).
- **Trigger: a server-executed `generate_artifact` tool** Claude calls. No separate "export this chat" button in D1 (that's a later nicety).
- **Inline result: an artifact card** in the assistant message (icon, title, type, Download) — mirrors `DocumentCard`. Full preview panel = D2.
- **Persistence: a new `artifacts` table** — generated outputs are distinct from uploaded `documents`. Migration `0005`.
- **New deps:** `docx`, `pdf-lib` (both pure-JS, serverless-safe). `exceljs` already present. (Avoid puppeteer/Chromium.)
- **Best-effort + graceful:** if Storage isn't configured, the tool returns an error result the model can relay (artifacts require Storage, like documents).

## Architecture

### Rendering (`src/lib/artifacts/`)
- `types.ts` — `ArtifactType = 'xlsx' | 'docx' | 'pdf'`; `SheetSpec` (`{ name: string; rows: (string|number)[][] }[]`) for xlsx; markdown string for docx/pdf.
- `render.ts` — `renderArtifact(type, title, content): Promise<{ buffer: Buffer; contentType: string; ext: string }>` dispatching to:
  - `toXlsx.ts` — `exceljs`: one worksheet per `SheetSpec` entry, header row bold.
  - `toDocx.ts` — `docx`: minimal Markdown → headings/paragraphs/lists/tables → `.docx`.
  - `toPdf.ts` — `pdf-lib`: render the Markdown as laid-out text (headings larger/bold, paragraphs wrapped, simple bullet lists). (Not full HTML/CSS — a clean text document, sufficient for reports.)
- Each renderer is a pure function (buffer in/out), unit-testable without network/DB.

### The tool (`src/lib/artifacts/tool.ts`)
- `createGenerateArtifactTool(ctx: { chatId, projectId })` returns an AI SDK `tool({ description, inputSchema, execute })`.
- `inputSchema` (zod): `{ type: 'xlsx'|'docx'|'pdf', title: string, format: 'markdown'|'sheets', content: string | SheetSpec }`.
- `execute`: `renderArtifact` → `uploadBuffer('artifacts/<projectId|standalone>/<artifactId>/<slug>.<ext>')` → insert `artifacts` row (status `ready`) → return `{ artifactId, title, type, downloadUrl }` (signed). On failure: mark `error`, return `{ error }`.
- Wired into the chat route's `tools` alongside `web_search` (only when the model is Claude and Storage is configured).

### Endpoints / actions
- `src/app/actions.ts`: `createArtifact`, `getChatArtifacts` (with signed `downloadUrl`), `deleteArtifact` (removes Storage object + row).
- `GET /api/artifacts?chatId=` — list with signed URLs (for reload). `DELETE /api/artifacts?id=` — cleanup. (Mirrors the documents route shape.)

### Client
- `src/types.ts`: `ArtifactSummary` (`id, chatId, type, title, downloadUrl, status, createdAt`).
- `src/components/chat/ArtifactCard.tsx`: icon by type, title, type label, **Download** (anchor to signed URL). Mirrors `DocumentCard`.
- `MessagesList`: when an assistant message has a `generate_artifact` tool result, render an `ArtifactCard`. On chat load, artifacts reattach via `getChatArtifacts` keyed by message/chat (D1: key by chat; precise message-pinning is a D2 refinement).

## Schema (migration 0005, additive)

```
artifacts(
  id            integer PK generated always as identity,
  chat_id       integer references chats(id) on delete cascade not null,
  project_id    integer references projects(id) on delete cascade,
  type          text not null,        -- 'xlsx' | 'docx' | 'pdf'
  title         text not null,
  storage_path  text not null,
  status        text not null default 'ready',  -- 'ready' | 'error'
  error_message text,
  created_at    timestamptz default now()
)  -- index on chat_id
```

## File layout

| File | Responsibility |
|---|---|
| `package.json` | add `docx`, `pdf-lib` |
| `src/db/schema.ts` + `drizzle/0005_*` | `artifacts` table |
| `src/lib/artifacts/types.ts` (new) | shared artifact types |
| `src/lib/artifacts/toXlsx.ts` / `toDocx.ts` / `toPdf.ts` (new) | per-format renderers |
| `src/lib/artifacts/render.ts` (new) | dispatch renderer |
| `src/lib/artifacts/tool.ts` (new) | `generate_artifact` AI SDK tool |
| `src/app/api/chat/route.ts` | wire the tool into `tools` (Claude + Storage configured) |
| `src/app/actions.ts` | `createArtifact`, `getChatArtifacts`, `deleteArtifact` |
| `src/app/api/artifacts/route.ts` (new) | GET (signed URLs) + DELETE |
| `src/types.ts` | `ArtifactSummary` |
| `src/components/chat/ArtifactCard.tsx` (new) | inline artifact card |
| `src/components/chat/MessagesList.tsx` | render artifact tool-results |
| Tests | renderers, tool execute, artifacts actions, route |
| `CLAUDE.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`, chatlog | docs |

## Verification gate

`npm run lint && npm run build && npm test` — 0 errors, 0 new warnings, all green. Manual smoke (live Supabase): ask the chat "make me an Excel schedule of these tasks…" → the assistant returns an artifact card → Download yields a valid `.xlsx`; repeat for a DOCX/PDF report.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Mixing a custom tool with Claude's native `web_search` in one `tools` object | AI SDK v6 supports multiple tools; verify via Context7 at plan time; if conflict, gate web_search off when artifact tool is active |
| Model emits malformed content (e.g. bad sheet JSON) | zod `inputSchema` validates; renderer guards + the tool returns a clean error result the model relays |
| Token cost of large artifact content in tool args | Acceptable for D1; chunked/streamed authoring is a D2 concern |
| Markdown→PDF fidelity (pdf-lib is low-level) | D1 targets clean text reports, not pixel-perfect layout; documented non-goal |
| Storage not configured | Tool returns an error result; artifacts require Storage (consistent with documents) |

## Non-goals (D1)

- The artifact **workspace panel**, live preview, **versioning**, edit/regenerate — **D2**.
- PPTX; HTML/React artifact rendering; charts/images inside artifacts.
- A manual "export this conversation/document" button.
- Precise per-message artifact pinning across reloads (D1 keys by chat).

## Definition of done

- [ ] `generate_artifact` tool produces valid XLSX/DOCX/PDF, stored in `atelier-files`, returned as a downloadable card inline in chat.
- [ ] `artifacts` table + migration `0005`; GET/DELETE route; actions with signed URLs + cleanup.
- [ ] Renderers + tool + route unit-tested; full gate green; live smoke (Claude → downloadable file).
- [ ] Docs updated. (D2 — workspace UI — is the next sub-phase.)
