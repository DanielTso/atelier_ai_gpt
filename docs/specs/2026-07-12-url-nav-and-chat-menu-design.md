# URL-synced navigation + project chat actions (design)

Date: 2026-07-12. Status: **approved design** (brainstormed with the user; plan-mode
approved). Fixes two user-reported gaps:

1. **Mouse back button exits the app.** All view state lives in `src/app/page.tsx`
   (`activeView`, `activeProjectId`, `activeChatId`); the History API is never touched,
   so the browser has exactly one entry and back leaves the site.
2. **Chat rows on a project landing page have no rename/move/archive/delete.** The
   sidebar's `ChatContextMenu` was never wired into `ProjectLandingPage`.

## Locked decisions

| Decision | Choice | Rejected alternatives |
|---|---|---|
| History mechanism | **Query params + native History API** (`pushState`/`popstate`; Next 16 integrates native pushState) | `useSearchParams` (forces a Suspense boundary around the whole single-page app); real route segments (dismantles the page.tsx state model — large refactor, same user-visible result) |
| URL scheme | `/` home · `?view=projects\|artifacts\|images` · `?project=3` landing · `?project=3&chat=12` / `?chat=12` chat | Encoding sub-state (open artifact, gallery filters) — URL captures *where*, not *everything you were doing* |
| Overlays in history | **Excluded** — back navigates views, never closes dialogs/artifact panel | Mobile-style back-closes-overlay (entry soup, bug-prone; Esc/✕ already close) |
| Landing-page actions | **Reuse `ChatContextMenu` with explicit props** | Moving/duplicating `SidebarActionsProvider` (it deliberately wraps only the sidebar) |

## SaaS-forward rationale (user context)

The app will be trial-run by other users and eventually offered as SaaS. This design
is the forward-compatible step, not the end state:

- **Query-param URLs migrate cleanly to route segments** when multi-user/Clerk lands
  (`?project=3&chat=12` → `/projects/3/chats/12` is a mechanical mapping); nothing in
  this design has to be undone.
- **`ChatRowActions` + `ChatPreview` consolidated into `src/types.ts`** is the seed of
  a shared "chat row" concept any future surface (workspace switcher, org views)
  builds on without re-deriving shapes.
- **`suppressNextPush()` is the pattern boundary**: the hook owns URL *mechanics*, the
  page owns *why* state changed. Future URL-synced state (e.g. a workspace id) follows
  the same shape.

## Design — Feature A: URL-synced navigation

**`src/lib/navState.ts` (new, pure).**
`NavState = home | tab(view) | project(projectId) | chat(projectId|null, chatId)`;
`parseNavUrl(search)` with priority **chat > project > view > home** and positive-int
validation (invalid params ignored, fall through); `navToUrl(state)` producing the
canonical search string. Pure string functions, unit-tested round-trip.

**`src/hooks/useUrlNavSync.ts` (new).** Opts: the three nav values + setters +
`currentChatProjectId` (the active chat's OWN `projectId` from its record;
`undefined` = record not loaded yet → fall back to `activeProjectId`). Returns
`{ suppressNextPush }`.

- **Mount restore** (`useLayoutEffect`, pre-paint): parse initial URL, seed the dedupe
  ref with the *canonical* form, apply state. Deep links and refresh restore for free;
  no params → Home exactly as today.
- **`popstate`**: parse `location.search`, apply all three setters; a guard ref makes
  the following push-effect consume the change instead of echoing a push.
- **Push effect** (deps: the four nav values only): serialize via a `toNavState` that
  mirrors page.tsx's render precedence (tabs > chat > project > home); dedupe against
  the last canonical URL; `pushState` normally, `replaceState` when suppressed.

**Why `currentChatProjectId` and not raw `activeProjectId`:** discovered during
design — `selectView` and `ArtifactsView.onOpenChat` never clear `activeProjectId`,
so it goes stale. Harmless for rendering (precedence order hides it) but a naive
serializer would write a wrong `?project=` next to a chat. The chat's own record wins.

**Validation interplay:** page.tsx's existing id-validation effect (nulls unknown
`activeChatId`/`activeProjectId` once data loads) doubles as stale-deep-link cleanup.
The page calls `navSync.suppressNextPush()` right before those nulls so the URL
correction is a `replaceState` — no dead history entry pointing at a broken URL.

**Not new races:** popstate-driven chat switches funnel into the existing message-load
effect with its stale-resolve guards; React batching keeps multi-setter handlers at
one push per user action; pushes can never happen per-keystroke (deps exclude
input/messages by construction).

## Design — Feature B: chat actions on the landing page

- `src/types.ts` gains `ChatPreview` (deduplicating three structurally identical
  copies) and `ChatRowActions { moveChat, renameChat, archiveChat, deleteChat }`;
  `SidebarActions extends ChatRowActions` (pure type refactor, no call-site changes) —
  the existing `sidebarActions` memo in page.tsx becomes directly passable.
- `ProjectLandingPage` gains `projects: Project[]` (Move-to submenu) and
  `chatActions: ChatRowActions`. Rows convert `motion.button` → `motion.div` with
  `role="button"`/`tabIndex`/Enter+Space handling and the `group` class (the menu
  trigger is hover-revealed, `stopPropagation` built into `ChatContextMenu`) —
  mirrors `ChatItem`, avoids invalid nested buttons.
- `currentProjectId={project.id}` directly; `isArchived` omitted (previews exclude
  archived chats by construction).
- **Included fix:** `handleArchiveChat` gains the missing `refreshChatPreviews()` —
  a pre-existing gap that becomes mainline once archive is reachable from the rows.
  The rename/delete dialogs already render at page root and are surface-agnostic.

## Out of scope (user-approved)

Real route segments; history entries for dialogs/lightboxes/the artifact panel;
URL-encoding Artifacts/Images sub-state (open artifact, filters, scroll).

## Accepted limitations

- Hard-reload deep link paints Home for one pre-paint frame (client-only restore).
- Stray unknown query params drop from the URL on the next nav transition (cosmetic).
- A hand-edited mismatched `?project=X&chat=Y` self-heals once the chat record loads
  but may leave one odd back-entry — optional follow-up: force `replaceState` when
  only the project segment of the same chat corrects.
- Backing past the first in-app entry exits the site (normal browser behavior).
- `proxy.ts` already preserves path+search through the login redirect — deep links
  survive the access gate with no proxy changes.

## Verification

Unit: `navState` parse/round-trip; `useUrlNavSync` mount-restore, push, dedupe,
popstate-no-echo, suppress→replaceState, stale-project override, tab precedence;
`ProjectLandingPage` menu render/callback/stopPropagation/keyboard tests. Full repo
gate (typecheck → lint → build → vitest). Live after user-gated push: back/forward
walk chat → landing → grid → home; refresh restores; row menu actions refresh the
list.

## Definition of done

Both features implemented and unit-tested; gate green; CHANGELOG 4.49.0 + CLAUDE.md
updated; deployed (user-gated push); live back/forward + row-menu smoke passes.
