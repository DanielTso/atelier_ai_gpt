# Session Handoff — 2026-07-13

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-12.md`._

## TL;DR — where the project is

- **v4.51.0 is SHIPPED (2026-07-13): pushed, tagged, GitHub-released, CI green (runs 29277300693 + 29279061717), Vercel deployed, prod 200.** The overnight autonomous session (per the 07-12 handoff ground rules) completed the whole queue — Audit Batch B perf items, Audit Batch C cleanup, both RAG deferreds — and the user said "push" + "do the release catch up" in the morning. Every commit passed the full gate (typecheck 0 · lint 0 errors/26-warning baseline · build · full Vitest suite single-threaded).
- 676 unit tests / 121 files (was 672/122 — added sync/gate/abort/splice tests, deleted the dead `useCollapseState` test file). `package.json` = 4.51.0. No migration in this release; Supabase remains at `0000`–`0016`.
- Release backlog is CLEAR: tags + GitHub releases exist for 4.48.0 → 4.51.0 (4.48–4.50 already existed from late 07-12 — the 07-12 handoff's "not yet done" note was stale).

## ☀️ Post-ship notes (user)

1. **Reviewed-by-commit trail**: `git log --oneline 811ea4b..v4.51.0`. Notables:
   - `6102f14` dead-code sweep — **ArchivedSection was deleted** (confirmed dead, but it was the only built/never-wired UI for the future "resurrect archived chats" item; recover from the commit's parent if you'd rather keep it). `archivedChats` plumbing in page.tsx was kept.
   - The spec's deviation table (`docs/specs/2026-07-12-batch-bc-perf-cleanup-design.md`): artifact-list `content` slimming was **deferred** (needs a `GET /api/artifacts/[id]` route + fetch-on-open design); `LoadingSkeletons` + `deleteDocumentChunks` were audit false positives and were NOT deleted.
2. **Your pending re-tests (carried):** PDF preview post-CSP-fix + clean PDF regeneration; Contract Abstract xlsx flow with the persona active; review of the 22-field `CONTRACT_ABSTRACT_FIELDS` + the Code Phase A/B spec.

## What shipped this session (all local, in order)

| Commit | What |
|---|---|
| `c5f916e` | docs: Batch B/C + RAG-deferreds spec & plan (re-verified 2026-07-06 audit against HEAD; deviations recorded) |
| `05c1a0c` | perf(db): pool config (`max` 10 / `idle_timeout` 20s / `connect_timeout` 10s / `max_lifetime` 30min) + fail-fast `DATABASE_URL` guard |
| `8107c9b` | perf(actions): chat lists select only `id/projectId/title/archived/createdAt` (no more `summary`/`systemPrompt` on every sidebar refresh) |
| `316488b` | perf(chat): artifact re-fetch gated on `hasArtifactOutput` (was every assistant turn) |
| `ae6e9b6` | perf(ui): useCallback the 4 create handlers + `createChatForProject` → `sidebarActions` identity stable → `memo(Sidebar)` holds during streaming |
| `6102f14` | chore: dead-code sweep (sidebar cluster + `useCollapseState`+test, `getDocumentChunksForProject`, 2 devDeps, 6 dead `@theme` exports) |
| `5e3ce16` | docs: TECH_STACKS.md rewritten to the real stack (Turso/Qwen residue removed) |
| `312734d` | fix(hooks): `useLocalStorage` in-tab sync via `local-storage` CustomEvent + echo-loop breaker (fixes stale custom-personas across Settings/composer) |
| (this commit) | fix(documents): replace aborts on total embed failure (502, previous revision stays active — no more good-index destruction) + hybrid splice page-order test + CHANGELOG 4.51.0 + this handoff |

## ⏳ Next session — open items and roadmap

1. **Roadmap** (user-approved order, from 07-11): **Code Phase C** (Vercel Sandbox execution — needs the user's security/cost decisions first) → remaining audit **Batch D** (dependency currency; AI SDK v7 = own spec; consider `engines` field). **The iteration loop** (`docs/specs/2026-07-11-living-canvas-design-seed.md`) queued as its own item — start with `superpowers:brainstorming` WITH the user.
2. **Deferred with design notes** (own specs when wanted): artifact-list `content` slimming (see spec Non-goals); resurrect archived chats; artifact-renderer warm re-skin; optional shared `useHighlightedCode` hook (CodeBlock/ArtifactPreview duplication — skipped overnight, low value vs. risk).
3. Optional dead-code note: `getChats(projectId)` has no production callers (tests only) — kept deliberately as the natural API for the archived-chats resurrect.

## Gotchas (new this session + carried)

- **In-tab `local-storage` CustomEvent**: `useLocalStorage` instances now sync within a tab; the `rawRef` last-seen-JSON guard is the echo-loop breaker — don't remove it, object values never bail on `Object.is`.
- **Replace-abort contract**: total embed failure on Replace → 502, doc stays `ready` on the OLD revision; new `rev<N>` storage objects orphan by design (Stage-1 orphan-sweep deferral); a retry overwrites the same `rev<N>` paths.
- **Full-suite runs are ~11 min** on this machine (`$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`); a rare 1-test flake under load reproduces as green on re-run (seen once overnight, confirmed environmental).
- **Carried**: no Prettier ever; migrate-before-deploy for schema releases; commit via `git commit -F` (PowerShell can't heredoc — use the Bash tool); Vercel preview behind auth (verify on prod); `actions.ts` is `'use server'` (no const exports); prod-affecting actions need the user to name them ("push"/"ship").

## Quick links

- Spec/plan this session: `docs/{specs,plans}/2026-07-12-batch-bc-perf-cleanup*`. CHANGELOG §4.51.0.
- SDD ledger: `.superpowers/sdd/progress.md` (Batch B/C section appended).
- Previous handoff (RAG Phase 3 + v4.49/v4.50 context): `docs/SESSION_HANDOFF_2026-07-12.md`.
