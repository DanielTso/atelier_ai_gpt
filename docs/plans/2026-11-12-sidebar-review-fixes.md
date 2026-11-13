# Sidebar Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 2026-11-12 Fable `/code-review` findings by deleting the resurrected dead sidebar cluster, and fix the one live bug those findings point at — archived chats are unreachable (audit F2) — without reintroducing finding 3 (archived project chats opened without their project).

**Architecture:** The six untracked files are byte-identical (modulo CRLF) to the dead code removed in `6102f14` and have no importers; findings 1, 2, 4, 6–10 exist only in them, so deletion resolves them. Finding 1's trap (`createChat`, which reads `activeProjectId` from a stale closure) has no live caller and is removed. Finding 3's pattern exists live in three places in `page.tsx` that only consult `chats` + `standaloneChats`; pure helpers in a new `src/lib/chatLookup.ts` make archived chats first-class there, and a new `ArchivedChatsSection` renders them through an `openChat(id, projectId)` action that always sets the chat's own project.

**Tech Stack:** Next.js 16 / React 19 client components, Vitest + Testing Library (jsdom), `useLocalStorage`.

**Spec:** this plan (bug-fix scope, no separate spec). Sources: `docs/audits/2026-11-12-sidebar-code-review.md` (Fable findings 1–10); `docs/audits/2026-09-01-codebase-audit.md` §F2.

## Global Constraints

- Code style: single-quote, no-semicolon in the files touched (match each file). **Never run `prettier --write`.**
- Semantic Tailwind tokens only in new UI (`text-muted-foreground`, `bg-muted`, `hover:bg-accent`, `border-border`) — no raw `purple-*`/`blue-*`/`green-*` (finding 9).
- New file names must NOT reuse the deleted names (`ArchivedSection.tsx`, `ProjectItem.tsx`, `ProjectsSection.tsx`, `QuickChatsSection.tsx`, `useCollapseState.ts`) — OneDrive has resurrected those paths once.
- Never `git add -A` / `git add .`; stage named paths only.
- Commits: Conventional Commits, imperative lowercase, no trailing period, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to `master` locally; **do not push**.
- Verification gate (from `CLAUDE.md`): `npm run typecheck` (0 errors) → `npm run lint` (0 errors; ~25 baseline warnings OK) → `rm -rf .next && npm run build` → `npm test`.
- Non-goal: sending a message in an opened archived chat does not auto-unarchive it (unchanged behavior). Non-goal: per-project archived lists on `ProjectLandingPage`.

## Review Focus

1. **Refresh / deep link (`?chat=<id>`) on an archived chat** — the archived list loads after `chats`; the chat must stay open, not be cleared as a stale link. → Task 2, `isStaleChatId` tests.
2. **Restoring the chat that is currently open** — it must stay open with the same project; the three list reloads resolve independently and must never leave it absent from all three. → Task 2, `moveRestoredChat` tests.
3. **Opening a project-owned archived chat while a different project (or none) is active** — opens under its own project. → Task 2 (`openChat` sets project), Task 3 click test.
4. **Opening a standalone archived chat while a project is active** — project context clears. → Task 3 click test.
5. **Malformed persisted `sidebar-archived-open` value** (e.g. `"yes"`, `{}`) — section renders collapsed. → Task 3 validator test.

---

### Task 1: Remove the resurrected dead cluster and the dead `createChat` action

Model: implementer Opus; review Sonnet (small mechanical diff).

**Files:**
- Delete (untracked, no git change): `src/components/chat/sidebar/{ArchivedSection,ProjectItem,ProjectsSection,QuickChatsSection}.tsx`, `src/hooks/useCollapseState.ts`, `tests/hooks/useCollapseState.test.tsx`
- Modify: `src/components/chat/sidebar/types.ts` (remove `createChat: () => void`)
- Modify: `src/app/page.tsx:748-754` (remove `handleCreateChat`), `:1225` (remove `createChat:` mapping), `:1241` (remove `handleCreateChat` from deps)

**Interfaces:**
- Produces: `SidebarActions` without `createChat`. `createChatInProject(projectId)` and `createStandaloneChat()` are unchanged.

- [ ] **Step 1: Confirm the six files are the dead copies** — for each, `git show 6102f14^:<path> | diff --strip-trailing-cr - <path>` prints nothing. If any differs, STOP and report (do not delete).
- [ ] **Step 2: Confirm no importers** — `git grep -nE "ArchivedSection|ProjectItem|ProjectsSection|QuickChatsSection|useCollapseState" -- src tests e2e` returns no tracked hits outside the six files.
- [ ] **Step 3: Delete the six files** with `rm`. `git status --short` no longer lists them.
- [ ] **Step 4: Remove `createChat`** from `SidebarActions`, `handleCreateChat`, the mapping, and the deps array. `git grep -n "createChat\b" -- src tests` returns nothing (`createChatInProject`/`createStandaloneChat`/`createChatForProject` remain).
- [ ] **Step 5: Verify** — `npm run typecheck` → 0 errors; `npx vitest run tests/hooks/` → all pass.
- [ ] **Step 6: Commit**

```bash
git add src/components/chat/sidebar/types.ts src/app/page.tsx
git commit -m "refactor(sidebar): remove dead createChat action that read a stale project closure"
```

---

### Task 2: Make archived chats first-class in page state

Model: implementer Opus; review Opus (state/race logic).

**Files:**
- Create: `src/lib/chatLookup.ts`
- Test: `tests/unit/lib/chatLookup.test.ts`
- Modify: `src/components/chat/sidebar/types.ts` (add `openChat`)
- Modify: `src/app/page.tsx` — `currentChat` (:125-127), the stale-link effect (:537-544), `loadArchivedChats` (:431-438), `handleRestoreChat` (:1107-1113), `sidebarActions` (:1216-1241)

**Interfaces:**
- Produces (in `src/lib/chatLookup.ts`, generic over `C extends { id: number; projectId: number | null }`):
  - `type ChatLists<C> = { chats: C[]; standaloneChats: C[]; archivedChats: C[] }`
  - `findChatById<C>(id: number | null, lists: ChatLists<C>): C | undefined` — searches `chats`, then `standaloneChats`, then `archivedChats`; `null` → `undefined`.
  - `isStaleChatId<C>(id: number, lists: ChatLists<C>, archivedLoaded: boolean): boolean` — `true` only when `archivedLoaded` is true, the three lists are not all empty, and `id` is in none of them.
  - `moveRestoredChat<C>(lists: ChatLists<C>, chatId: number): ChatLists<C>` — removes the chat from `archivedChats` and prepends it (with `archived: false` if the field exists on the object) to `standaloneChats` when `projectId === null`, else to `chats`; returns `lists` unchanged (same reference) if `chatId` is not in `archivedChats`. Never duplicates an id already present in the destination.
- Produces (in `SidebarActions`): `openChat: (id: number, projectId: number | null) => void`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/lib/chatLookup.test.ts`:
  - `findChatById` finds an id that is only in `archivedChats`; returns `undefined` for `null` and for an absent id.
  - `isStaleChatId(9, lists, false)` → `false` even when 9 is absent (Review Focus 1).
  - `isStaleChatId(9, lists, true)` → `true` when absent; `false` when 9 is only in `archivedChats`.
  - `isStaleChatId(9, { chats: [], standaloneChats: [], archivedChats: [] }, true)` → `false` (nothing loaded yet — preserves the existing `allChats.length > 0` guard).
  - `moveRestoredChat` with archived `{ id: 7, projectId: 5 }` → 7 is absent from `archivedChats`, first in `chats`, not in `standaloneChats`; with `{ id: 8, projectId: null }` → first in `standaloneChats`.
  - `moveRestoredChat` for an id not in `archivedChats` returns the identical `lists` object (`toBe`).
  - `moveRestoredChat` when 7 is already in `chats` leaves exactly one 7 in `chats`.
- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/lib/chatLookup.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/chatLookup.ts`** per the Interfaces block (pure, no React imports).
- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Wire `page.tsx`:**
  - `currentChat = findChatById(activeChatId, { chats, standaloneChats, archivedChats })`.
  - Add `const [archivedChatsLoaded, setArchivedChatsLoaded] = useState(false)`; `loadArchivedChats` sets it `true` in a `finally` (success or failure — a failed archived load must not block stale-link correction forever).
  - Stale-link effect: replace the `allChats` check with `isStaleChatId(activeChatId, { chats, standaloneChats, archivedChats }, archivedChatsLoaded)`; add `archivedChats` and `archivedChatsLoaded` to its deps. The project half of the effect is unchanged.
  - `handleRestoreChat`: after `await restoreChat(chatId)`, compute `moveRestoredChat` from the current three lists and set all three in the same synchronous tick (React batches them), THEN fire the existing three reloads. Read the lists via functional updates or refs so the callback does not go stale; keep its toast.
  - `sidebarActions.openChat: (id, projectId) => { setActiveView('home'); setActiveProjectId(projectId); setActiveChatId(id) }`; add it to the `SidebarActions` type and the memo deps as needed.
- [ ] **Step 6: Verify** — `npm run typecheck` → 0 errors; `npx vitest run tests/unit/lib/chatLookup.test.ts tests/hooks/` → PASS.
- [ ] **Step 7: Commit**

```bash
git add src/lib/chatLookup.ts tests/unit/lib/chatLookup.test.ts src/components/chat/sidebar/types.ts src/app/page.tsx
git commit -m "fix(chat): treat archived chats as known chats in lookup, deep links and restore"
```

---

### Task 3: Render archived chats in the sidebar

Model: implementer Opus; review Opus (multi-file UI + routing).

**Files:**
- Create: `src/components/chat/sidebar/ArchivedChatsSection.tsx`
- Test: `tests/hooks/ArchivedChatsSection.test.tsx`
- Modify: `src/components/chat/sidebar/ChatItem.tsx:28-34` (click routing)
- Modify: `src/components/chat/sidebar/Sidebar.tsx` (destructure `archivedChats`, render the section)
- Modify: `tests/hooks/Sidebar.test.tsx` (add cases)

**Interfaces:**
- Consumes: `SidebarActions.openChat(id, projectId)` (Task 2); `ChatItem` `variant: 'archived'`; `ChatContextMenu` already renders Restore when `isArchived`.
- Produces: `ArchivedChatsSection({ chats: Chat[]; activeChatId: number | null; projects: Project[] })`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks/ArchivedChatsSection.test.tsx` (jsdom, wrap in `SidebarActionsProvider` with a recording actions object; clear `localStorage` in `beforeEach`):
  - Empty `chats` → renders nothing (`container.firstChild` is `null`).
  - Two archived chats → a button with accessible name matching `/archived/i` and the count `2` is visible; the chat titles are NOT in the document (collapsed by default) and the button has `aria-expanded="false"`.
  - Click the toggle → titles appear, `aria-expanded="true"`, and `localStorage['sidebar-archived-open']` is `'true'`.
  - `localStorage['sidebar-archived-open'] = '"yes"'` before render → collapsed (Review Focus 5).
  - Expanded, click the title of `{ id: 7, projectId: 5 }` → `openChat` called with `(7, 5)`; `selectStandaloneChat` and `selectChat` not called (Review Focus 3).
  - Click the title of `{ id: 8, projectId: null }` → `openChat(8, null)` (Review Focus 4).
- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/hooks/ArchivedChatsSection.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement `ArchivedChatsSection`** — returns `null` for an empty list; a single header `<button aria-expanded>` styled like the `Recents` label (`text-xs font-semibold text-muted-foreground uppercase tracking-wider`) with a lucide `ChevronRight` rotated when open and a count badge `bg-muted text-muted-foreground`; open state from ONE `useLocalStorage<boolean>('sidebar-archived-open', false, v => typeof v === 'boolean')` call in this component (not per row — finding 7); rows are `ChatItem variant="archived"` with `currentProjectId={c.projectId}`.
- [ ] **Step 4: Route archived clicks in `ChatItem`** — in `handleClick`, `variant === 'archived'` → `actions.openChat(chat.id, chat.projectId)`; `project` and `standalone` branches unchanged.
- [ ] **Step 5: Render it in `Sidebar`** — destructure `archivedChats`; inside the scroll container after `RecentsSection`, render `<ArchivedChatsSection chats={archivedChats} activeChatId={activeChatId} projects={projects} />` preceded by a `mt-4` spacer. `CollapsedSidebar` unchanged.
- [ ] **Step 6: Extend `tests/hooks/Sidebar.test.tsx`** — with `archivedChats={[{ id: 3, projectId: null, title: 'Old one' }]}`, a `/archived/i` toggle is present; with `archivedChats={[]}`, no `/archived/i` button.
- [ ] **Step 7: Run to verify pass** — `npx vitest run tests/hooks/` → PASS.
- [ ] **Step 8: Docs** — `CLAUDE.md` Source Layout sidebar line: add `ArchivedChatsSection` to the rendered list and note `openChat(id, projectId)` always sets the chat's own project. `CHANGELOG.md`: add `## [Unreleased]` above `[4.55.0]` with a `### Fixed` entry for F2 + finding-3 hardening and a `### Removed` entry for the dead `createChat` action.
- [ ] **Step 9: Full gate** — `npm run typecheck` → `npm run lint` → `rm -rf .next && npm run build` → `npm test`; all pass (record the test count).
- [ ] **Step 10: Commit**

```bash
git add src/components/chat/sidebar/ArchivedChatsSection.tsx tests/hooks/ArchivedChatsSection.test.tsx src/components/chat/sidebar/ChatItem.tsx src/components/chat/sidebar/Sidebar.tsx tests/hooks/Sidebar.test.tsx CLAUDE.md CHANGELOG.md
git commit -m "fix(sidebar): restore access to archived chats with their own project context"
```

---

## Final gate

Whole-branch review on **Fable** (per `docs/MODEL_ROUTING.md`), briefed with the original ten findings to confirm each is resolved or moot, and Review Focus 1–5. Afterwards `git status --short` must show none of the six deleted paths (if OneDrive restored them, report it; the move off OneDrive is the durable fix). No push without explicit approval.
