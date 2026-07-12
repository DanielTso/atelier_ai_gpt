# URL-Synced Navigation + Project Chat Actions — implementation plan (executed 2026-07-12)

Spec: `docs/specs/2026-07-12-url-nav-and-chat-menu-design.md`. Executed inline (small
scope), TDD per task, commit per slice. All tasks complete.

- [x] **A1 — `src/lib/navState.ts`** (pure `NavState`/`parseNavUrl`/`navToUrl`;
  priority chat > project > view > home; positive-int validation).
  Tests: `tests/unit/lib/navState.test.ts` — 12 passing (parse cases, round-trip,
  canonicalization of messy input).
- [x] **A2 — `src/hooks/useUrlNavSync.ts`** (mount-time deep-link restore via
  `useLayoutEffect`; `popstate` → setters with echo-push guard; push effect deduped
  against the last canonical URL; `suppressNextPush()` → `replaceState`).
  Tests: `tests/hooks/useUrlNavSync.test.ts` — 9 passing (restore, push, dedupe,
  pop-no-echo, suppress, stale-project override, undefined fallback, tab precedence).
- [x] **A3 — page.tsx wiring**: `currentChat` computation relocated above the hook;
  `useUrlNavSync` called with `currentChatProjectId: currentChat?.projectId ??
  (currentChat ? null : undefined)`; validation effect calls
  `navSync.suppressNextPush()` before nulling stale ids; exclusion comment added.
- [x] **B1 — types**: `ChatPreview` + `ChatRowActions` added to `src/types.ts`;
  `SidebarActions extends ChatRowActions`; page.tsx `chatPreviews` state retyped.
- [x] **B2 — `ProjectLandingPage`**: new `projects` + `chatActions` props; rows
  `motion.button` → `motion.div` (`role="button"`, `tabIndex`, Enter/Space, `group`,
  `cursor-pointer`); per-row `ChatContextMenu` (explicit props — the
  `SidebarActionsProvider` deliberately stays sidebar-only); trigger gained
  `aria-label="Chat options"`. Tests: `tests/hooks/ProjectLandingPage.test.tsx` —
  7 passing (trigger per row, row click vs menu click isolation, keyboard, rename/
  archive/delete callbacks).
- [x] **B3 — page.tsx**: `projects`/`chatActions={sidebarActions}` passed;
  `handleArchiveChat` gains the missing `refreshChatPreviews()` (pre-existing gap,
  mainline once archive is reachable from landing rows).
- [x] **C1 — docs**: spec committed; CHANGELOG 4.49.0; CLAUDE.md hooks/lib entries.
- [x] **Gate**: typecheck 0 → lint clean → build → full vitest suite green.

Deferred (recorded in spec): replaceState-only correction for hand-edited mismatched
`?project=X&chat=Y` URLs; any history participation for overlays.
