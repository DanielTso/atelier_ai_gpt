# Batch B (perf) + Batch C (cleanup) + RAG deferreds — design spec

- **Date:** 2026-07-12 (overnight autonomous session)
- **Status:** Implemented overnight per the 2026-07-12 handoff's autonomous-session ground rules; **pending user review in the morning** (local commits only, nothing pushed)
- **Target release:** v4.51.0 (tag/release user-gated)
- **Source:** 2026-07-06 deep-dive audit (Batch B/C items, as summarized in `SESSION_HANDOFF_2026-07-07.md` §audit backlog) + RAG Phase 1/2b deferred items (`.superpowers/sdd/progress.md`). All findings **re-verified against HEAD `811ea4b`** this session — see Deviations for what changed since the audit.

## Problem / context

The 2026-07-06 audit left two follow-up batches queued behind Batch A (shipped v4.41.0):

- **Batch B (P1 perf):** the db client has no pool/timeout config and no `DATABASE_URL` guard; chat-list server actions ship full rows (incl. `summary`, `systemPrompt`) where the client uses 4 fields; the per-turn artifact re-fetch fires on **every** assistant message; 4 plain handlers in `page.tsx` sit in the `sidebarActions` `useMemo` dep array, so the `actions` prop changes identity every render and defeats `memo(Sidebar)` on every streamed token. (Batch B's 2 security one-liners already shipped earlier on 2026-07-12.)
- **Batch C (P2):** a dead sidebar component cluster survives from the pre-decomposition sidebar; 1 dead server action; 2 unused devDeps; 6 dead `@theme` color exports; `TECH_STACKS.md` still describes the retired Turso/Qwen stack; `useLocalStorage` has no in-tab cross-instance sync (latent stale-persona bug).
- **RAG deferreds:** the document-replace path still swaps in an unembedded revision when **all** embeddings fail (destroying the last good chunk index); the P2b hybrid-splice route tests don't assert spliced text content.

## Goals

- Bounded, explicit db connection behavior; fail fast on missing `DATABASE_URL`.
- Chat-list payloads carry only what the client reads.
- Artifact re-fetch only on turns that actually produced an artifact.
- `memo(Sidebar)` actually holds during streaming.
- Delete only **re-verified** dead code; fix the docs + `useLocalStorage` bugs.
- Replace never destroys the last good chunk index on total embed failure.
- Full verification gate green after every task; one commit per task.

## Non-goals (explicitly deferred)

- **Artifact-list `content` slimming — DEFERRED (deviation from the audit).** Re-verification showed `ArtifactWorkspace` relies **solely** on list-provided `content` (no per-id fetch route exists) and gallery `ArtifactThumbnail` renders live html/sheets/docx previews from it. Dropping `content` requires a new `GET /api/artifacts/[id]` JSON route + fetch-on-open loading states in the workspace + lazy thumbnail hydration — a UX-affecting design change for a daytime session. The expensive part of the finding (per-turn re-fetch) is fixed here instead.
- Batch D (dependency currency), archived-chats resurrect UI, artifact-renderer warm re-skin — later, own specs.
- Any prod-touching action (push, migrations, tags, env) — user-gated, morning.

## Re-verified findings & deviations from the 2026-07-06 audit

| Audit claim | HEAD status | Action |
|---|---|---|
| Sidebar cluster dead: `ProjectsSection`, `QuickChatsSection`, `ArchivedSection`, `ProjectItem`, `useCollapseState` | **Confirmed dead** (Sidebar renders `CollapsedSidebar`/`SidebarHeader`/`SidebarNav`/`RecentsSection`/`SidebarFooter` only) | Delete (+ `useCollapseState` test) |
| `LoadingSkeletons` dead | **FALSE POSITIVE** — imported by 5 live components (ArtifactsView, ImagesView, ProjectLandingPage, MessagesList, ProjectContextRail) | Keep |
| `deleteDocumentChunks` dead | **FALSE POSITIVE** — live via `src/lib/ingest.ts:15` | Keep |
| `getDocumentChunksForProject` dead | Confirmed (zero callers) | Delete |
| 2 unused devDeps | Identified: `@vitejs/plugin-react` (vitest.config has no plugins array), `@testing-library/jest-dom` (no setupFiles, no imports) | Remove |
| Dead CSS vars | The 6 `@theme` exports `--color-navy/steel-blue/canvas/soft-mist/muted-line/slate-text` have 0 utility usages; the underlying `--brand-*` vars are **live** via the semantic `:root` mapping | Delete the 6 `@theme` lines only |
| `useCallback` "4 plain handlers" | Confirmed: `handleCreateProject`, `handleCreateChat`, `handleCreateChatInProject`, `handleCreateStandaloneChat` — all in the `sidebarActions` `useMemo` dep array (page.tsx:1125). Shared helper `createChatForProject` is also plain and must be wrapped first. Everything they close over is identity-stable (`dialogs.*` controllers, `getPersonaById` are useCallback'd). | Wrap all 5 |
| Artifact list w/o `content` + gate re-fetch | `content` drop deferred (see Non-goals); re-fetch gate confirmed trivial (`hasArtifactOutput` already computed at useChatPersistence.ts:66, unused for the fetch at :171) | Gate only |
| `ArchivedSection` note | Dead, but it is the **only built UI** for the approved future "resurrect archived chats" item; `page.tsx` still loads `archivedChats` (used for rename lookup) and `Sidebar` accepts-but-drops the prop | Delete per handoff's explicit sweep list; recovery = this commit's parent. The `archivedChats` data plumbing in page.tsx/SidebarProps is left intact for the future resurrect feature. |
| `getChats(projectId)` (not in audit) | No production callers (tests only) | Keep — it is the natural API for the resurrect feature and is exercised by tests; noted, not deleted |

## Design by task

### B1 — db pool config + guard (`src/db/index.ts`)

```ts
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — configure it in .env.local (see CLAUDE.md).')
}

// Supabase transaction pooler requires prepare:false (no prepared statements).
// Bounded client-side pool: Fluid Compute reuses instances, so idle connections
// linger without idle_timeout; max_lifetime rotates connections under the
// pooler's own recycling horizon. Units are seconds (postgres-js).
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 10,               // postgres-js default, made explicit
  idle_timeout: 20,      // close idle connections after 20s
  connect_timeout: 10,   // fail a hung dial in 10s instead of 30s
  max_lifetime: 60 * 30, // rotate connections after 30min
})
```

Verified against postgres-js docs (options `max`/`idle_timeout`/`connect_timeout`/`max_lifetime`, seconds). Tests are unaffected: the suite mocks `@/db` with PGlite.

### B2 — slim chat-list payloads (`src/app/actions.ts`)

`getChats`, `getAllProjectChats`, `getStandaloneChats`, `getArchivedChats` switch from `db.select().from(chats)` to an explicit column set `{ id, projectId, title, archived, createdAt }` (drops `summary`, `systemPrompt`, `summaryUpToMessageId` — the client `Chat` type is `{ id, projectId, title, archived }`; `systemPrompt` is loaded per-chat via `getChatWithContext`). `getProjectChatPreviews`'s inner select slims the same way (it maps to `{ id, title, preview, createdAt }`). Existing behavior tests (`tests/unit/actions/chats.test.ts`) keep passing — they assert filtering/ordering, not dropped fields.

### B3 — gate the per-turn artifact re-fetch (`src/hooks/useChatPersistence.ts`)

The re-fetch block (`fetch('/api/artifacts?chatId=…')` at :171) becomes `if (hasArtifactOutput) { … }`. `loadMessages` still fetches artifacts on every chat open, and `page.tsx`'s `onChanged` re-fetch after workspace edits is untouched — so the only lost trigger is turns with no artifact output, where the fetch was a no-op by definition. Unit test updated/extended: artifact-producing turn → fetch fires; plain text turn → no `/api/artifacts` fetch.

### B4 — useCallback pass (`src/app/page.tsx`)

Wrap `createChatForProject` (deps: `[getPersonaById]` — all setters/refs stable; verify any URL-sync-wrapped setters during implementation), then `handleCreateProject` (deps `[dialogs.createProject]`), `handleCreateChat` (`[activeProjectId, createChatForProject]`), `handleCreateChatInProject` (`[createChatForProject]`), `handleCreateStandaloneChat` (`[]` or the stable setters lint demands). Result: every entry in the `sidebarActions` `useMemo` dep array is identity-stable → `actions` is stable during streaming → `memo(Sidebar)` holds. No behavior change; this is render-identity only.

### C1 — dead-code sweep

Delete: `src/components/chat/sidebar/ProjectsSection.tsx`, `QuickChatsSection.tsx`, `ArchivedSection.tsx`, `ProjectItem.tsx`, `src/hooks/useCollapseState.ts`, `tests/hooks/useCollapseState.test.tsx`, `getDocumentChunksForProject` (actions.ts), the 6 dead `@theme` exports in `globals.css`, and devDeps `@vitejs/plugin-react` + `@testing-library/jest-dom` (`npm uninstall` so the lockfile stays in sync). Nothing else — the false positives above stay.

### C2 — TECH_STACKS.md rewrite

Replace the Turso/Qwen residue (lines 27/30/31/37: `@ai-sdk/openai`+DashScope, `@libsql/client`, `drizzle-orm/libsql` + `dialect: "turso"`) with the current stack: Anthropic (chat brain) + Google Gemini (vision/embeddings/housekeeping) via AI SDK v6, Drizzle on `postgres-js` against Supabase Postgres + pgvector (`dialect: "postgresql"`), Tavily web ingestion, Supabase Storage, Vercel.

### C3 — useLocalStorage in-tab sync (`src/hooks/useLocalStorage.ts`)

The `storage` event only fires in **other** tabs; two hook instances sharing a key in one tab never sync (live consequence: editing custom personas in Settings leaves `PersonaSelector`'s `usePersonas('custom-personas')` instance stale until reload; same class of bug for `artifact-panel-width` across page.tsx/ArtifactsView). Fix: after writing in `setValue`, dispatch `window.dispatchEvent(new CustomEvent('local-storage', { detail: { key } }))`; the existing listener effect additionally subscribes to `'local-storage'` and re-reads the key (same handler body as the `storage` path, filtered by `detail.key`). Loop-safe: re-reading sets state to an equal value decoded from storage; React bails on `Object.is`-equal state, and for reference types one extra echo render is harmless (no re-dispatch on the listener path — only `setValue` dispatches). jsdom test: two instances, same key, set in one → other updates.

### R1 — replace-abort when `embedded === 0` (`src/app/api/documents/process/route.ts`)

In the replace branch: if `embedded === 0 && textChunks.length > 0`, **abort before any destructive write** (no `createDocumentRevision`, no `commitDocumentReplacement`): restore `updateDocumentStatus(doc.id, 'ready')` (the prior revision is still fully intact and active) and return **502** `{ error: 'Replace failed: embeddings unavailable; the previous revision is still active.' }`. The client's existing error path surfaces it as an upload error toast. New-revision Storage objects already written this request (source upload, `rev<N>/thumb.webp`, `rev<N>/extracted.txt`) are left as orphans — consistent with the documented Stage-1 orphan-sweep deferral; a retry re-uploads cleanly under `rev<N>` again (same next revision number, paths overwrite). Route test: total-embed-failure replace → 502, old chunks untouched, doc row unchanged (`status='ready'`, old revision/chunkCount), no revision row created.

### R2 — P2b splice test breadth (`tests/unit/api/documents-process.test.ts`)

Add an assertion that the hybrid splice's final ingested text contains the vision-extracted sparse-page content **in page order** between the surrounding text-path pages (locks the merge order contract flagged in the P2b review).

## Verification gate

Per task: `npm run typecheck` (0) → `npm run lint` (0 errors, ≤26-warning baseline) → `npm run build` → `npx vitest run --no-file-parallelism` (definitive green; TZ pinned per gotcha). One conventional commit per task, local only.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `idle_timeout` churns connections under bursty traffic | 20s is the postgres-js-documented serverless norm; pooler (:6543) absorbs reconnects; revert is one line |
| Slimmed selects break an unnoticed field consumer | Client `Chat` type + grep verified; tests + build catch stragglers |
| useCallback dep mistakes reintroduce stale closures | Handlers read refs or stable controllers; `react-hooks/exhaustive-deps` lint enforced by the gate |
| ArchivedSection deletion vs. future resurrect feature | Data plumbing kept; component recoverable at this commit's parent; called out in handoff for the user's morning review |
| Replace-abort leaves `processing` docs on new failure modes | Abort path explicitly restores `ready`; the Batch A reaper still backstops anything missed |
| in-tab sync event echoes loop | Only `setValue` dispatches; listeners only `setStoredValue` — no re-dispatch |

## Definition of done

- All tasks committed locally (one commit each), full gate green after each.
- Nothing pushed; no migrations; no tags. CHANGELOG updated under an Unreleased/4.51.0 heading; SDD ledger + SESSION_HANDOFF updated for the morning review.
