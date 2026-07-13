# Batch B/C + RAG deferreds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the audit's Batch B perf items, Batch C cleanup, and the two RAG deferreds as seven gated local commits (overnight; nothing pushed).

**Architecture:** No new subsystems — targeted edits to the db client, server actions, two hooks, page.tsx handler memoization, dead-file deletion, and the document-replace abort path. Spec: `docs/specs/2026-07-12-batch-bc-perf-cleanup-design.md` (the contract; deviations there override the 2026-07-06 audit).

**Tech Stack:** Next.js 16 / Drizzle on postgres-js / Vitest + PGlite (`tests/helpers/test-db.ts`) / React 19.

## Global Constraints

- Single-quote, no-semicolon style; match the file you're in (older files vary). **Never run prettier.**
- Gate after EVERY task: `npm run typecheck` (0) → `npm run lint` (0 errors, ≤26 warnings) → `npm run build` → `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism` (all pass).
- One Conventional Commit per task, local only. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- DO NOT: push, migrate, tag, touch Vercel env.

---

### Task 1: db pool config + DATABASE_URL guard

**Files:** Modify: `src/db/index.ts`

- [ ] Replace the client creation with the guarded, configured version (exact code in spec §B1: guard throw + `max: 10, idle_timeout: 20, connect_timeout: 10, max_lifetime: 60 * 30`, keep `prepare: false`).
- [ ] Gate (all four commands). Vitest is unaffected (suite mocks `@/db`); build exercises the import path.
- [ ] Commit: `perf(db): bounded pool config + fail-fast DATABASE_URL guard`

### Task 2: slim chat-list payloads

**Files:** Modify: `src/app/actions.ts` (getChats, getAllProjectChats, getStandaloneChats, getArchivedChats, getProjectChatPreviews inner select)

**Interfaces:** each returns `{ id: number; projectId: number | null; title: string; archived: boolean; createdAt: Date }[]` — superset of the client `Chat` type.

- [ ] Switch the five selects to explicit columns, e.g. `db.select({ id: chats.id, projectId: chats.projectId, title: chats.title, archived: chats.archived, createdAt: chats.createdAt }).from(chats)…` (preview inner select needs only `id, title, createdAt` + the existing where/order).
- [ ] Run `npx vitest run tests/unit/actions/chats.test.ts tests/unit/actions/projects.test.ts tests/unit/actions/blank-artifact.test.ts` — PASS (they assert filtering, not dropped fields).
- [ ] Gate. Commit: `perf(actions): chat list queries select only client-consumed columns`

### Task 3: gate per-turn artifact re-fetch

**Files:** Modify: `src/hooks/useChatPersistence.ts:170-174`; Test: `tests/hooks/useChatPersistence.test.ts`

- [ ] Extend the hook test: (a) message with a `tool-generate_artifact` part → `/api/artifacts?chatId=` fetched; (b) text-only message → NOT fetched. Run — (b) FAILS against current code.
- [ ] Wrap the re-fetch block in `if (hasArtifactOutput) { … }`.
- [ ] Re-run hook test — PASS. Gate. Commit: `perf(chat): only re-fetch artifacts on turns that produced one`

### Task 4: useCallback pass on page.tsx

**Files:** Modify: `src/app/page.tsx` (createChatForProject :623, handleCreateProject :600, handleCreateChat :652, handleCreateChatInProject :660, handleCreateStandaloneChat :665)

- [ ] Wrap all five in `useCallback`. Deps: createChatForProject `[getPersonaById]` (+ any URL-sync-wrapped setter lint flags — verify `setActiveView`/`setActiveChatId`/`setActiveProjectId` identities first); handleCreateProject `[dialogs.createProject]`; handleCreateChat `[activeProjectId, createChatForProject]`; handleCreateChatInProject `[createChatForProject]`; handleCreateStandaloneChat `[]`/lint-driven. Let `react-hooks/exhaustive-deps` arbitrate — 0 lint errors required.
- [ ] Gate (build catches any TDZ ordering issue — useCallback'd createChatForProject must be defined before its dependents). Commit: `perf(ui): stabilize sidebarActions identity so memo(Sidebar) holds during streaming`

### Task 5: Batch C sweep + TECH_STACKS.md + useLocalStorage in-tab sync

Three commits, one gate each:

- [ ] **5a sweep:** delete `src/components/chat/sidebar/{ProjectsSection,QuickChatsSection,ArchivedSection,ProjectItem}.tsx`, `src/hooks/useCollapseState.ts`, `tests/hooks/useCollapseState.test.tsx`; remove `getDocumentChunksForProject` from actions.ts; remove the 6 dead `@theme` lines (`--color-navy`, `--color-steel-blue`, `--color-canvas`, `--color-soft-mist`, `--color-muted-line`, `--color-slate-text`) from `src/app/globals.css`; `npm uninstall @vitejs/plugin-react @testing-library/jest-dom`. Grep-verify zero references to each deleted symbol before deleting. Keep: LoadingSkeletons, deleteDocumentChunks, ChatItem, ChatContextMenu, archivedChats plumbing (spec table). Gate. Commit: `chore: remove dead sidebar cluster, dead action, unused devDeps, dead theme exports`
- [ ] **5b docs:** rewrite the stale sections of `TECH_STACKS.md` (spec §C2). No gate beyond lint (docs-only) — still run typecheck+lint for hygiene. Commit: `docs: TECH_STACKS.md reflects the Supabase/Anthropic/Gemini stack`
- [ ] **5c sync:** implement the `local-storage` CustomEvent dispatch/listen (spec §C3). jsdom test in `tests/hooks/useLocalStorage.test.tsx` (create if absent): render two hook instances on key `k`, `act(() => setA('v'))`, expect instance B `toBe('v')`; regression: cross-tab `storage` path still handled. RED → GREEN. Gate. Commit: `fix(hooks): useLocalStorage syncs instances within the same tab`

### Task 6: replace-abort when embedded === 0

**Files:** Modify: `src/app/api/documents/process/route.ts` (replace branch ~:200); Test: `tests/unit/api/documents-process.test.ts`

- [ ] RED test: replace flow with `embedContents` mocked to total failure (`embedded: 0`) → expect 502, `documents` row still `status='ready'` with prior `chunkCount`/`revision`, prior `document_chunks` rows intact, no `document_revisions` row.
- [ ] Implement abort per spec §R1 (guard BEFORE `createDocumentRevision`; `updateDocumentStatus(doc.id, 'ready')`; 502 JSON; comment referencing the orphan-sweep deferral). Update the now-stale comment block at :195-199.
- [ ] GREEN + gate. Commit: `fix(documents): abort replace on total embed failure — previous revision stays active`

### Task 7: P2b splice-content test

**Files:** Test: `tests/unit/api/documents-process.test.ts`

- [ ] Add the page-order splice assertion (spec §R2) to the existing hybrid test fixture: final `ingestText`-received text contains vision content for sparse pages between the text-path page contents, in ascending page order.
- [ ] Gate. Commit: `test(documents): lock hybrid splice page-order content contract`

### Task 8 (wrap-up, docs-only)

- [ ] CHANGELOG entry `[4.51.0] – Unreleased` summarizing tasks 1–7; update SDD ledger `.superpowers/sdd/progress.md`; write `docs/SESSION_HANDOFF_2026-07-13.md` (supersedes 07-12) with morning-review checklist (review commits → push decision → tag housekeeping still pending for 4.48–4.51). Commit: `docs: changelog + handoff for overnight batch b/c session`

## Self-review

- Spec coverage: B1→T1, B2→T2, B3→T3, B4→T4, C1→T5a, C2→T5b, C3→T5c, R1→T6, R2→T7. Deferred items are Non-goals, no task needed. ✓
- No placeholders: code is in spec §§B1–R2 referenced per task. ✓
- Optional stretch (only if all above green + time): shared `useHighlightedCode` hook (CodeBlock/ArtifactPreview duplication) — NOT in scope for the release notes if skipped.
