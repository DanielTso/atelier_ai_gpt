# Sidebar Code Review — 2026-11-12

Two `/code-review` passes on the working tree at `0a6714f` (v4.55.0): one on Opus 5.5 (9 findings), one on Fable 5.2 (10 findings — the superset, recorded below). The tree had no tracked changes; the "diff" was six **untracked** files that match (modulo CRLF) the dead pre-decomposition sidebar cluster deleted in `6102f14` (v4.51.0) — almost certainly restored by OneDrive sync. Nothing in `src/` imports them. Fix plan: `docs/plans/2026-11-12-sidebar-review-fixes.md`.

Files: `src/components/chat/sidebar/{ArchivedSection,ProjectItem,ProjectsSection,QuickChatsSection}.tsx`, `src/hooks/useCollapseState.ts`, `tests/hooks/useCollapseState.test.tsx`.

## Findings (Fable, most severe first) and whether each exists in live code

| # | Location | Finding | Live code? |
|---|---|---|---|
| 1 | `ProjectItem.tsx:153` | "New Chat" calls `selectProject(id)` then `createChat()`; `handleCreateChat` reads `activeProjectId` from a stale closure → chat created in the previously active project, or a "Select a project first" toast. `createChatInProject(id)` exists for this. | **No live caller** of `actions.createChat`. The trap itself (`createChat`/`handleCreateChat`) is dead and removed by plan Task 1. |
| 2 | `ProjectItem.tsx:74` | Rename input `onBlur={saveName}` commits on mousedown, so the cancel (X) button can never cancel. | Dead only — live rename uses `RenameDialog`. |
| 3 | `ArchivedSection.tsx:44` | Archived chats render `variant="archived"`, which `ChatItem` routes through `selectStandaloneChat` (clears `activeProjectId`); `page.tsx`'s `currentChat` never searches `archivedChats` → a project chat opens with no project context. | **Yes, in a different shape.** Live sidebar never renders archived chats (audit F2, HIGH). `currentChat` (`page.tsx:125`), the stale-deep-link guard (`page.tsx:537-544`) and `handleRestoreChat`'s three independent reloads all ignore `archivedChats`; live `selectChat` doesn't set the project. Plan Tasks 2–3. |
| 4 | `ProjectItem.tsx:41` | `saveName` renames even when unchanged, and can fire twice (Enter then blur on unmount). | Dead only — `RenameDialog` already guards `trimmed !== currentTitle`. |
| 5 | `useCollapseState.ts:1` | The dead cluster is back, inside tsconfig/eslint/vitest globs; a `git add -A` would revert the deliberate removal and contradict `CLAUDE.md`. | Resolved by deletion (plan Task 1) + moving the repo off OneDrive. |
| 6 | `useCollapseState.test.tsx:4` | Test of a hook with no consumer; local `npm test` counts diverge from CI (143 files / 999 tests at v4.55.0). | Resolved by deletion. |
| 7 | `ProjectItem.tsx:21` | `useCollapseState()` instantiated per row → N+3 `useLocalStorage` instances re-parse on every toggle. | Dead only. Plan Task 3 uses ONE `useLocalStorage` call in the new section. |
| 8 | `useCollapseState.ts:22` | Persisted-value guard checks only `projectChats`; boolean fields unvalidated, not merged with defaults; deleted-project ids never pruned. | Dead only. Plan Task 3 validates with `typeof v === 'boolean'`. |
| 9 | `ProjectItem.tsx:103` | Hardcoded cool palette (`text-purple-300`, `text-blue-300`, `green-400`…) — poor contrast on the warm light theme. | Dead only. Plan constraint: semantic tokens only. |
| 10 | `ProjectItem.tsx:139` | Inlined trash SVG and a bespoke inline rename editor duplicating the `RenameDialog` flow. | Dead only. |

Opus's pass found the same items minus #8 (and folded #10 into #9's neighbourhood).
