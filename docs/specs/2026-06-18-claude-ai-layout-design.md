# Claude.ai-Style Layout — Design

**Status:** Approved design (2026-06-18). **Program:** UI/layout effort for Atelier Studio (post-D1, on `master` after the v4.6.0 cutover). This is a layout restyle, not a new program phase. Branch: a new feature branch off `master`.

---

## Goal

Restyle Atelier Studio's three existing surfaces to match the **Claude.ai layout** the user uses daily, while keeping the existing Atelier brand theme and all current functionality:

1. **Home** (empty state) — a centered, time-of-day greeting with the user's name, a centered chat input, and quick-action chips.
2. **Project view** — a 3-pane layout: sidebar │ center (chat input + chat list) │ a **right context rail** (Memory · Instructions · Files with a capacity bar).
3. **Sidebar** — rebuilt to Claude.ai's simple nav (New chat · Projects · Artifacts · Customize) + a flat **Recents** list.

The right rail's **Memory** and **Instructions** are **functional**: they persist per-project and are injected into Claude's system prompt for that project's chats.

**Reference framing (user-supplied):** structure and theme are kept cleanly separable — layout dimensions live as CSS variables/tokens, semantic HTML + a nested component hierarchy carry the structure, and the **existing Atelier brand theme** sits on top (NOT a grayscale/neutral pass — the app already has a full brand system). The Claude.ai reference prompt informs the base 2-column shell (sidebar + main with header bar / centered max-width thread / sticky centered composer / off-canvas-on-mobile); this design adds the right rail and home greeting that the generic shell omits.

## Non-goals (YAGNI)

- **No Cowork / Code tabs** — those are separate Claude.ai products, not a layout feature.
- **No Google integrations** (Drive / Calendar / Gmail chips) — replaced with app-relevant chips.
- **No "Only you / share" chip** — the app is single-user (no auth).
- **No full D2 artifact workspace** (live preview, versioning, edit/regenerate) — the "Artifacts" nav routes to a *minimal* list view only.
- **No serif display font** — greeting stays on-brand Geist (per the reference's "no custom fonts").
- **No rearchitecture** of `page.tsx`'s view-state machine — restyle in place (Approach A).

## Current state (what this builds on)

- **`src/app/page.tsx`** (1,125 lines) renders three views from local state: `activeChatId` → chat view (`MessagesList` + `ChatInputArea`, ~L931); else `activeProjectId` → `ProjectLandingPage` (~L1001); else the **empty state** (logo + title + `ChatInputArea`, ~L1010).
- **Sidebar** (`src/components/chat/sidebar/`): `Sidebar.tsx` orchestrates `SidebarHeader`, `SmartChatMenu`, `QuickChatsSection`, `ProjectsSection`, `ArchivedSection`, `SidebarFooter`; collapse via `CollapsedSidebar`. Item components `ChatItem`, `ProjectItem`. Shared state via `SidebarActionsContext`.
- **`ProjectLandingPage.tsx`**: two-column (chats list + Files panel); uploads via `useDocumentUpload`; renders `DocumentCard` grid.
- **Documents**: `GET /api/documents` returns `DocumentSummary` (incl. `fileSize`, signed `thumbnailUrl`).
- **Chat**: `POST /api/chat` builds the 5-layer context; Layer 1 is the system prompt. Project/persona system prompts already flow in via the request body.
- **Settings**: a key-value `settings` table; `getSetting`/`setSetting` server actions; `SENSITIVE_KEYS` blocks API keys from client reads. A `display-name` key would be a new **non-sensitive** key.
- **Artifacts** (D1): `artifacts` table; `getChatArtifacts(chatId)`; `ArtifactCard`. No global/all-artifacts query yet.
- **Theme**: Tailwind v4 `@theme` tokens in `globals.css`; `glass-panel` card class; brand tokens documented in CLAUDE.md.

## Locked decisions

- **Approach A — restyle in place.** Keep the view-state machine; extract two new self-contained components (`HomeGreeting`, `ProjectContextRail`); rebuild the sidebar nav.
- **Memory + Instructions are functional** — new `projects.memory` and `projects.instructions` columns (migration `0006`), injected into the chat system prompt (Layer 1) for that project's chats.
- **Greeting** — time-of-day + display name (`display-name` setting), on-brand Geist, brand accent mark. Fallback when no name set: "Good afternoon" (no name).
- **Quick-action chips** — app-relevant: **New project · Upload · Write · Code**. Chips prefill the composer or trigger an action; no external integrations.
- **Sidebar** — match Claude.ai: `New chat` · `Projects` · `Artifacts` · `Customize` + flat `Recents`. QuickChats/Archived data preserved (reachable via command palette) but removed from the default sidebar.
- **Artifacts nav** — minimal list view reusing `ArtifactCard`; new `getAllArtifacts()` server action.
- **Capacity cap** — `PROJECT_CAPACITY_BYTES`, default **2 GB**, env-overridable. The bar = sum(project document `fileSize`) ÷ cap. Soft/visual only (no hard enforcement).
- **Layout dimensions as tokens** — `--sidebar-width` (~260px), `--rail-width`, `--thread-max-width` (~760px) in `globals.css @theme`; structure references the tokens.
- **Responsive** — sidebar collapses off-canvas behind a hamburger on narrow widths; main area + thread go full width; right rail stacks below or hides on narrow widths.

## Architecture

### New components
- **`src/components/chat/HomeGreeting.tsx`** — the home hero: time-of-day greeting (`Good {morning|afternoon|evening}`) + display name, brand accent mark. Pure presentational; takes `displayName?: string`. Time-of-day computed client-side (`new Date().getHours()`); deterministic helper `greetingForHour(h)` is unit-tested.
- **`src/components/chat/ProjectContextRail.tsx`** — the right rail. Sections:
  - **Memory** — editable multiline; debounced save via `updateProjectContext`.
  - **Instructions** — editable multiline; debounced save via `updateProjectContext`.
  - **Files** — `DocumentCard` grid (reused) + a `CapacityBar` subcomponent (`usedBytes`, `capBytes` → "% used"). Upload via existing `useDocumentUpload`.
  - Props: `project`, `documents`, `onUpload`, `onDeleteDocument`, `onOpenDocument`. Self-contained; testable with mock data.
- **`src/components/chat/sidebar/SidebarNav.tsx`** — the 4 nav items (New chat, Projects, Artifacts, Customize) with icons; routes via `SidebarActions`.
- **`src/components/chat/sidebar/RecentsSection.tsx`** — flat recency-sorted list of recent chats (reuses `ChatItem`).
- **`src/components/chat/ArtifactsView.tsx`** — minimal "all artifacts" grid (reuses `ArtifactCard`), shown when the Artifacts nav is active.
- **`src/components/chat/ProjectsView.tsx`** *(if needed)* — a simple projects grid for the "Projects" nav destination (cards → select project). May reuse existing project list rendering.

### Quick-action chips
- A small `QuickActions` row under the home composer. Actions: **New project** (opens create-project flow), **Upload** (opens document upload for the active/▸new project), **Write** / **Code** (prefill the composer with a starter prompt). Pure UI + existing handlers; no backend.

### Data model
- **Migration `drizzle/0006_*.sql`** — `ALTER TABLE projects ADD COLUMN memory text; ADD COLUMN instructions text;` (both nullable). Schema update in `src/db/schema.ts`.
- No other schema changes. `display-name` is a `settings` row, not a column.

### Server actions (`src/app/actions.ts`)
- `updateProjectContext(projectId, { memory?, instructions? })` — partial update of the two columns.
- `getAllArtifacts()` — all artifacts across chats (id, title, type, chatId, createdAt) + signed `downloadUrl`, newest first. (Mirrors `getChatArtifacts` without the `chatId` filter.)
- Project reads (`getProjects` / `getChatWithContext`) extended to surface `memory` + `instructions`.
- `display-name`: reuse `getSetting('display-name')` / `setSetting`; ensure it is **not** in `SENSITIVE_KEYS` and is readable client-side.

### Chat injection (`src/app/api/chat/route.ts`)
- When the active chat belongs to a project, load that project's `memory` + `instructions` and **prepend** them to the system prompt (Layer 1), clearly delimited (e.g. `Project context (memory):\n…\n\nProject instructions:\n…`). Empty/null fields contribute nothing. Degrades gracefully (no project → unchanged).

### Layout / tokens (`src/app/globals.css`)
- Add `@theme` tokens: `--sidebar-width`, `--rail-width`, `--thread-max-width`. Sidebar, rail, and chat thread reference them. Keeps the structure theme-agnostic and easy to retune.

### Capacity (`src/lib/` constant)
- `PROJECT_CAPACITY_BYTES` (default `2 * 1024 * 1024 * 1024`, env `PROJECT_CAPACITY_BYTES`). Used by `CapacityBar`; usedBytes = Σ document `fileSize` for the project (already available client-side from the documents list).

## File layout (new / touched)

```
src/
├─ app/
│  ├─ page.tsx                         # restyle empty-state → HomeGreeting+QuickActions; project view → 3-pane; wire new nav routes
│  ├─ actions.ts                       # updateProjectContext, getAllArtifacts, project reads incl. memory/instructions
│  ├─ globals.css                      # layout dimension tokens
│  └─ api/chat/route.ts                # inject project memory + instructions into system prompt
├─ components/chat/
│  ├─ HomeGreeting.tsx                 # NEW
│  ├─ QuickActions.tsx                 # NEW (or inline in HomeGreeting)
│  ├─ ProjectContextRail.tsx           # NEW (+ CapacityBar)
│  ├─ ArtifactsView.tsx                # NEW (minimal)
│  ├─ ProjectsView.tsx                 # NEW (if Projects nav needs a list view)
│  ├─ ProjectLandingPage.tsx           # → 3-pane; mount ProjectContextRail
│  └─ sidebar/
│     ├─ Sidebar.tsx                   # rebuilt: SidebarNav + RecentsSection
│     ├─ SidebarNav.tsx                # NEW
│     └─ RecentsSection.tsx            # NEW
├─ db/schema.ts                        # projects.memory, projects.instructions
└─ lib/… (PROJECT_CAPACITY_BYTES const)
drizzle/0006_*.sql                     # NEW migration
```

## Staging (for the implementation plan)

Three independently shippable slices, each passing the gate:
1. **Shell + Home** (pure frontend): sidebar rebuild (SidebarNav + Recents), HomeGreeting + QuickActions, layout dimension tokens, responsive off-canvas sidebar + centered max-width thread/composer. No DB.
2. **Project 3-pane + functional context** (frontend + backend): ProjectContextRail, migration `0006`, `updateProjectContext`, chat-route injection, capacity bar.
3. **Artifacts list + display name**: `getAllArtifacts`, ArtifactsView, `display-name` setting + Customize field, greeting wired to it.

## Testing

- **Unit:** `greetingForHour` (time-of-day); `updateProjectContext` + project reads (PGlite); chat-route injection of project memory/instructions (mocked providers); `getAllArtifacts`; `display-name` setting round-trip.
- **Component:** `ProjectContextRail` (renders memory/instructions/files + capacity %); `HomeGreeting` (name + time); `SidebarNav` (nav routing); `CapacityBar` (% math, clamp at 100%).
- **E2E (Playwright):** home renders greeting + composer; sidebar nav switches views; open a project → rail visible with Files. (Memory/Instructions persistence covered by unit tests.)
- All existing tests stay green.

## Verification gate

`npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test` (+ new tests), `DIRECT_URL=… npx drizzle-kit migrate` applies `0006` cleanly, `npm run test:e2e`. Zero new lint warnings beyond the documented baseline. Manual smoke: home greeting, sidebar nav, project rail edit→persist→reflected-in-chat-context, capacity bar, responsive collapse.

## Risks / open items

- **`page.tsx` size** — already large; this adds nav-routing state (which view is active for Projects/Artifacts). Mitigated by extracting new views into their own components and keeping only the view-selector state in `page.tsx`.
- **Sidebar feature parity** — folding away QuickChats/Archived from the default view must keep them reachable (command palette). Verify no dead data.
- **Debounced saves** — Memory/Instructions autosave needs a sensible debounce (e.g. 600ms) + save indicator to avoid surprising writes.
- **Migration `0006`** must be applied to live Supabase before the chat-injection slice deploys (additive, nullable — safe).

## Definition of done

- Home, Sidebar, and Project view match the Claude.ai structural layout using the existing Atelier theme.
- Memory + Instructions persist per project and measurably influence Claude's responses for that project's chats.
- Artifacts nav opens a working list of generated artifacts; Customize holds a display-name field that drives the greeting.
- Responsive behavior works (off-canvas sidebar on narrow widths).
- Full verification gate green; migration `0006` applied.
