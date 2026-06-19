# Claude.ai Layout — Slice 1 (Shell + Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Atelier Studio's shell to the Claude.ai layout — a Claude.ai-style sidebar (New chat · Projects · Artifacts · Customize + flat Recents), a centered time-of-day Home greeting with quick-action chips, layout dimension tokens, and responsive off-canvas sidebar — all on the existing Atelier brand theme, with no backend changes.

**Architecture:** Approach A (restyle in place). Keep `page.tsx`'s view-state machine; add an `activeView` selector ('home' | 'projects' | 'artifacts') so the sidebar nav can switch the main pane. New self-contained components (`HomeGreeting`, `QuickActions`, `SidebarNav`, `RecentsSection`, `ProjectsView`, `ArtifactsView`). Rebuild `Sidebar.tsx` to compose the new nav + recents. No DB, no API changes (those are Slices 2–3).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS v4 (`@theme` tokens in `globals.css`), Vitest + Testing Library (jsdom) for component tests, lucide-react icons, `cn` from `@/lib/utils`.

## Global Constraints

- **Server Components by default; `"use client"` only where needed.** New interactive components are client components (they already are, like the rest of `src/components/chat/`).
- **No new colors/fonts.** Use existing semantic brand tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `hover:bg-accent`). Greeting uses on-brand Geist (no serif).
- **Forbidden patterns:** no `bg-white/X` / `border-white/X` / `via-white/X` opacity utilities, no blue→purple gradients, no backdrop-blur glass. Hover = `hover:bg-accent`.
- **Conventional Commits 1.0**, imperative lowercase, no trailing period. Allowed types: `feat`, `fix`, `refactor`, `test`, `style`, `docs`, `chore`.
- **Branch:** `feat/claude-ai-layout` (already created).
- **Component tests** are jsdom (`// @vitest-environment jsdom` at top of each test file).
- **Verification gate** (run before considering the slice done): `npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`.

---

### Task 1: Layout dimension tokens

**Files:**
- Modify: `src/app/globals.css` (the `:root` block — add CSS variables near the existing custom properties)

**Interfaces:**
- Produces: CSS variables `--sidebar-width`, `--rail-width`, `--thread-max-width` consumed by later tasks via Tailwind arbitrary values, e.g. `w-[var(--sidebar-width)]`.

- [ ] **Step 1: Add the variables**

In `src/app/globals.css`, find the `:root { … }` block (where `--background`, `--radius`, etc. are defined) and add, inside it:

```css
  /* Layout structure dimensions — keep structure separable from theme. */
  --sidebar-width: 18rem;     /* 288px — matches the prior w-72 sidebar */
  --rail-width: 20rem;        /* 320px — project context rail (Slice 2) */
  --thread-max-width: 48rem;  /* 768px — centered conversation/composer column */
```

- [ ] **Step 2: Verify build picks them up**

Run: `npm run build`
Expected: build succeeds (CSS variables are inert until referenced).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(layout): add sidebar/rail/thread dimension tokens"
```

---

### Task 2: `greetingForHour` time-of-day helper

**Files:**
- Create: `src/lib/greeting.ts`
- Test: `tests/unit/lib/greeting.test.ts`

**Interfaces:**
- Produces: `greetingForHour(hour: number): string` returning `'Good morning'` (5–11), `'Good afternoon'` (12–16), or `'Good evening'` (17–4). Consumed by `HomeGreeting` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/greeting.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { greetingForHour } from '@/lib/greeting'

describe('greetingForHour', () => {
  it('says good morning from 5 to 11', () => {
    expect(greetingForHour(5)).toBe('Good morning')
    expect(greetingForHour(11)).toBe('Good morning')
  })
  it('says good afternoon from 12 to 16', () => {
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(16)).toBe('Good afternoon')
  })
  it('says good evening from 17 to 4 (wrapping midnight)', () => {
    expect(greetingForHour(17)).toBe('Good evening')
    expect(greetingForHour(23)).toBe('Good evening')
    expect(greetingForHour(0)).toBe('Good evening')
    expect(greetingForHour(4)).toBe('Good evening')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/greeting.test.ts`
Expected: FAIL — cannot resolve `@/lib/greeting`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/greeting.ts`:

```ts
/** Time-of-day greeting prefix. Hours 5–11 morning, 12–16 afternoon, else evening. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'Good morning'
  if (hour >= 12 && hour <= 16) return 'Good afternoon'
  return 'Good evening'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/greeting.test.ts`
Expected: PASS (4 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/greeting.ts tests/unit/lib/greeting.test.ts
git commit -m "feat(home): add greetingForHour time-of-day helper"
```

---

### Task 3: `HomeGreeting` component

**Files:**
- Create: `src/components/chat/HomeGreeting.tsx`
- Test: `tests/hooks/HomeGreeting.test.tsx`

**Interfaces:**
- Consumes: `greetingForHour` (Task 2).
- Produces: `<HomeGreeting displayName?: string />` — renders the greeting line. When `displayName` is set, appends `, {displayName}`. Used by `page.tsx` (Task 5). `displayName` stays optional through Slice 1 (wired to a real setting in Slice 3).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/HomeGreeting.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { HomeGreeting } from '@/components/chat/HomeGreeting'

afterEach(cleanup)

describe('HomeGreeting', () => {
  it('shows a time-of-day greeting with the name when provided', () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14) // afternoon
    render(<HomeGreeting displayName="Daniel Tso" />)
    expect(screen.getByText(/Good afternoon, Daniel Tso/)).toBeTruthy()
  })
  it('omits the comma/name when no name is provided', () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(8) // morning
    render(<HomeGreeting />)
    expect(screen.getByText('Good morning')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/HomeGreeting.test.tsx`
Expected: FAIL — cannot resolve `@/components/chat/HomeGreeting`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/HomeGreeting.tsx`:

```tsx
'use client'

import { Sparkles } from 'lucide-react'
import { greetingForHour } from '@/lib/greeting'

export function HomeGreeting({ displayName }: { displayName?: string }) {
  const greeting = greetingForHour(new Date().getHours())
  const text = displayName ? `${greeting}, ${displayName}` : greeting
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <Sparkles className="h-7 w-7 text-primary shrink-0" aria-hidden />
      <h1 className="text-3xl font-semibold text-foreground tracking-tight">{text}</h1>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/HomeGreeting.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/HomeGreeting.tsx tests/hooks/HomeGreeting.test.tsx
git commit -m "feat(home): add HomeGreeting time-of-day hero"
```

---

### Task 4: `QuickActions` chips

**Files:**
- Create: `src/components/chat/QuickActions.tsx`
- Test: `tests/hooks/QuickActions.test.tsx`

**Interfaces:**
- Produces: `<QuickActions onNewProject onUpload onWrite onCode />` — a row of 4 chips (New project, Upload, Write, Code). Each chip calls its handler on click. Used by `page.tsx` (Task 5). `onWrite`/`onCode` prefill the composer; `onNewProject`/`onUpload` trigger existing flows.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/QuickActions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QuickActions } from '@/components/chat/QuickActions'

afterEach(cleanup)

describe('QuickActions', () => {
  it('renders four chips and fires the matching handler', () => {
    const onNewProject = vi.fn(), onUpload = vi.fn(), onWrite = vi.fn(), onCode = vi.fn()
    render(<QuickActions onNewProject={onNewProject} onUpload={onUpload} onWrite={onWrite} onCode={onCode} />)
    fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    fireEvent.click(screen.getByRole('button', { name: /upload/i }))
    fireEvent.click(screen.getByRole('button', { name: /write/i }))
    fireEvent.click(screen.getByRole('button', { name: /code/i }))
    expect(onNewProject).toHaveBeenCalledOnce()
    expect(onUpload).toHaveBeenCalledOnce()
    expect(onWrite).toHaveBeenCalledOnce()
    expect(onCode).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/QuickActions.test.tsx`
Expected: FAIL — cannot resolve `@/components/chat/QuickActions`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/QuickActions.tsx`:

```tsx
'use client'

import { FolderPlus, Upload, PenLine, Code2 } from 'lucide-react'

interface QuickActionsProps {
  onNewProject: () => void
  onUpload: () => void
  onWrite: () => void
  onCode: () => void
}

export function QuickActions({ onNewProject, onUpload, onWrite, onCode }: QuickActionsProps) {
  const chips = [
    { label: 'New project', icon: FolderPlus, onClick: onNewProject },
    { label: 'Upload', icon: Upload, onClick: onUpload },
    { label: 'Write', icon: PenLine, onClick: onWrite },
    { label: 'Code', icon: Code2, onClick: onCode },
  ]
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
      {chips.map(({ label, icon: Icon, onClick }) => (
        <button
          key={label}
          onClick={onClick}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/QuickActions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/QuickActions.tsx tests/hooks/QuickActions.test.tsx
git commit -m "feat(home): add QuickActions chip row"
```

---

### Task 5: Add `activeView` routing + `selectView` action

This task adds the view-selector state so the sidebar nav can switch the main pane, and extends `SidebarActions`. It's the seam Tasks 6–11 plug into.

**Files:**
- Modify: `src/components/chat/sidebar/types.ts` (extend `SidebarActions`)
- Modify: `src/app/page.tsx` (add `activeView` state + `selectView` in `sidebarActions`)

**Interfaces:**
- Produces: `type AppView = 'home' | 'projects' | 'artifacts'`; `SidebarActions.selectView: (view: AppView) => void`; `SidebarActions.activeView: AppView`. Page holds `const [activeView, setActiveView] = useState<AppView>('home')`. Selecting a chat/project resets the relevant view. Consumed by `SidebarNav` (Task 7) and the render switch (Task 10).

- [ ] **Step 1: Extend the SidebarActions type**

In `src/components/chat/sidebar/types.ts`, add above `SidebarActions`:

```ts
export type AppView = 'home' | 'projects' | 'artifacts'
```

Then add these members inside `SidebarActions` (in the `// UI actions` group):

```ts
  selectView: (view: AppView) => void
  activeView: AppView
```

- [ ] **Step 2: Add state + wire the action in page.tsx**

In `src/app/page.tsx`, near the other view state (around the `activeChatId` declaration ~L62), add:

```tsx
  const [activeView, setActiveView] = useState<AppView>('home')
```

Add the import for `AppView` to the existing sidebar types import. In the `sidebarActions` `useMemo` (~L885), add these two entries and add `activeView` to the dependency array:

```tsx
    selectView: (view) => { setActiveView(view); setActiveChatId(null); },
    activeView,
```

Also update `createStandaloneChat`, `selectChat`, `selectStandaloneChat`, and `selectProject` handlers' call sites are unaffected, but ensure selecting a chat or project sets `activeView` back to `'home'` so the chat/project pane shows. Add `setActiveView('home')` inside `handleSelectProject` and at the top of the chat-selection handlers (`setActiveChatId` wrapper). Minimal approach: wrap `selectChat`/`selectStandaloneChat` in the memo to also call `setActiveView('home')`:

```tsx
    selectChat: (id) => { setActiveView('home'); setActiveChatId(id); },
    selectStandaloneChat: (id) => { setActiveView('home'); handleSelectStandaloneChat(id); },
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: passes. (`activeView` is declared and used; no UI change yet — the render switch comes in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/sidebar/types.ts src/app/page.tsx
git commit -m "feat(layout): add activeView routing and selectView action"
```

---

### Task 6: `RecentsSection` component

**Files:**
- Create: `src/components/chat/sidebar/RecentsSection.tsx`
- Test: `tests/hooks/RecentsSection.test.tsx`

**Interfaces:**
- Consumes: `ChatItem` (existing), `SidebarActionsContext` (existing), `Chat`/`Project` types.
- Produces: `<RecentsSection chats activeChatId projects />` — a flat "Recents" header + list of chats (standalone and project chats combined, in the given order), each a `ChatItem` (variant `'standalone'` so clicks route through `selectStandaloneChat` for standalone and via context menu otherwise). Used by `Sidebar` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/RecentsSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RecentsSection } from '@/components/chat/sidebar/RecentsSection'
import { SidebarActionsProvider } from '@/components/chat/sidebar/SidebarActionsContext'
import type { SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)

const noopActions = new Proxy({}, { get: () => () => {} }) as SidebarActions

describe('RecentsSection', () => {
  it('renders a Recents header and one row per chat', () => {
    const chats = [
      { id: 1, projectId: null, title: 'Alpha chat' },
      { id: 2, projectId: 5, title: 'Beta chat' },
    ]
    render(
      <SidebarActionsProvider actions={noopActions}>
        <RecentsSection chats={chats} activeChatId={null} projects={[]} />
      </SidebarActionsProvider>
    )
    expect(screen.getByText('Recents')).toBeTruthy()
    expect(screen.getByText('Alpha chat')).toBeTruthy()
    expect(screen.getByText('Beta chat')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/RecentsSection.test.tsx`
Expected: FAIL — cannot resolve `RecentsSection`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/sidebar/RecentsSection.tsx`:

```tsx
'use client'

import { ChatItem } from './ChatItem'
import type { Chat, Project } from './types'

interface RecentsSectionProps {
  chats: Chat[]
  activeChatId: number | null
  projects: Project[]
}

export function RecentsSection({ chats, activeChatId, projects }: RecentsSectionProps) {
  return (
    <div>
      <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Recents
      </p>
      <div className="mt-1 space-y-1">
        {chats.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 px-2 py-1">No recent chats yet</p>
        ) : (
          chats.map(c => (
            <ChatItem
              key={c.id}
              chat={c}
              isActive={activeChatId === c.id}
              projects={projects}
              variant={c.projectId === null ? 'standalone' : 'project'}
              currentProjectId={c.projectId}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/RecentsSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/sidebar/RecentsSection.tsx tests/hooks/RecentsSection.test.tsx
git commit -m "feat(sidebar): add flat RecentsSection"
```

---

### Task 7: `SidebarNav` component

**Files:**
- Create: `src/components/chat/sidebar/SidebarNav.tsx`
- Test: `tests/hooks/SidebarNav.test.tsx`

**Interfaces:**
- Consumes: `SidebarActionsContext` (`createStandaloneChat`, `selectView`, `openSettings`, `activeView`).
- Produces: `<SidebarNav />` — four nav rows: **New chat** (`createStandaloneChat`), **Projects** (`selectView('projects')`), **Artifacts** (`selectView('artifacts')`), **Customize** (`openSettings`). The active view's row is highlighted. Used by `Sidebar` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/SidebarNav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SidebarNav } from '@/components/chat/sidebar/SidebarNav'
import { SidebarActionsProvider } from '@/components/chat/sidebar/SidebarActionsContext'
import type { SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)

function actionsWith(overrides: Partial<SidebarActions>): SidebarActions {
  return new Proxy(overrides, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }) as SidebarActions
}

describe('SidebarNav', () => {
  it('fires the right action per nav item', () => {
    const createStandaloneChat = vi.fn(), selectView = vi.fn(), openSettings = vi.fn()
    render(
      <SidebarActionsProvider actions={actionsWith({ createStandaloneChat, selectView, openSettings, activeView: 'home' })}>
        <SidebarNav />
      </SidebarActionsProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    fireEvent.click(screen.getByRole('button', { name: /projects/i }))
    fireEvent.click(screen.getByRole('button', { name: /artifacts/i }))
    fireEvent.click(screen.getByRole('button', { name: /customize/i }))
    expect(createStandaloneChat).toHaveBeenCalledOnce()
    expect(selectView).toHaveBeenCalledWith('projects')
    expect(selectView).toHaveBeenCalledWith('artifacts')
    expect(openSettings).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/SidebarNav.test.tsx`
Expected: FAIL — cannot resolve `SidebarNav`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/sidebar/SidebarNav.tsx`:

```tsx
'use client'

import { Plus, FolderOpen, Boxes, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebarActions } from './SidebarActionsContext'

export function SidebarNav() {
  const actions = useSidebarActions()
  const items = [
    { label: 'New chat', icon: Plus, onClick: actions.createStandaloneChat, active: false },
    { label: 'Projects', icon: FolderOpen, onClick: () => actions.selectView('projects'), active: actions.activeView === 'projects' },
    { label: 'Artifacts', icon: Boxes, onClick: () => actions.selectView('artifacts'), active: actions.activeView === 'artifacts' },
    { label: 'Customize', icon: SlidersHorizontal, onClick: actions.openSettings, active: false },
  ]
  return (
    <nav className="px-2 space-y-0.5">
      {items.map(({ label, icon: Icon, onClick, active }) => (
        <button
          key={label}
          onClick={onClick}
          className={cn(
            'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm transition-colors',
            active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/SidebarNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/sidebar/SidebarNav.tsx tests/hooks/SidebarNav.test.tsx
git commit -m "feat(sidebar): add Claude.ai-style SidebarNav"
```

---

### Task 8: Rebuild `Sidebar.tsx` to the Claude.ai structure

**Files:**
- Modify: `src/components/chat/sidebar/Sidebar.tsx`
- Test: `tests/hooks/Sidebar.test.tsx` (create)

**Interfaces:**
- Consumes: `SidebarNav` (Task 7), `RecentsSection` (Task 6), existing `SidebarHeader`/`SidebarFooter`/`CollapsedSidebar`. Same `SidebarProps` (unchanged signature) — internal composition only.
- Produces: the rebuilt sidebar: header → `SidebarNav` → divider → `RecentsSection` (scroll) → footer. QuickChats/Projects/Archived sections removed from the default view.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/Sidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Sidebar } from '@/components/chat/sidebar/Sidebar'
import type { SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)
const actions = new Proxy({ activeView: 'home' }, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }) as SidebarActions

describe('Sidebar', () => {
  it('renders the Claude.ai nav and Recents, not Quick Chats', () => {
    render(
      <Sidebar projects={[]} activeProjectId={null} chats={[{ id: 1, projectId: null, title: 'Recent one' }]}
        activeChatId={null} standaloneChats={[]} archivedChats={[]} collapsed={false} actions={actions} />
    )
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /projects/i })).toBeTruthy()
    expect(screen.getByText('Recents')).toBeTruthy()
    expect(screen.getByText('Recent one')).toBeTruthy()
    expect(screen.queryByText('Quick Chats')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/Sidebar.test.tsx`
Expected: FAIL — still renders "Quick Chats" (old structure).

- [ ] **Step 3: Rewrite Sidebar.tsx**

Replace the body of `src/components/chat/sidebar/Sidebar.tsx` with (keeping the `SidebarProps` interface and `memo` wrapper):

```tsx
'use client'

import { memo, useMemo } from 'react'
import { SidebarActionsProvider } from './SidebarActionsContext'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNav } from './SidebarNav'
import { RecentsSection } from './RecentsSection'
import { SidebarFooter } from './SidebarFooter'
import type { SidebarActions, Project, Chat } from './types'

export interface SidebarProps {
  projects: Project[]
  activeProjectId: number | null
  chats: Chat[]
  activeChatId: number | null
  standaloneChats: Chat[]
  archivedChats: Chat[]
  collapsed: boolean
  actions: SidebarActions
}

export const Sidebar = memo(function Sidebar({
  projects, activeProjectId, chats, activeChatId, standaloneChats, archivedChats, collapsed, actions,
}: SidebarProps) {
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  )

  // Flat Recents: all chats (standalone + project) by recency. The page passes
  // chats already newest-first; combine with standaloneChats, de-duped by id.
  const recents = useMemo(() => {
    const byId = new Map<number, Chat>()
    for (const c of [...standaloneChats, ...chats]) byId.set(c.id, c)
    return Array.from(byId.values())
  }, [chats, standaloneChats])

  return (
    <SidebarActionsProvider actions={actions}>
      {collapsed ? (
        <CollapsedSidebar sortedProjects={sortedProjects} />
      ) : (
        <aside className="w-[var(--sidebar-width)] flex flex-col glass-panel rounded-2xl transition-all duration-300 shrink-0 overflow-hidden">
          <SidebarHeader />
          <SidebarNav />
          <div className="h-px bg-border mx-4 my-3" />
          <div className="flex-1 overflow-y-auto px-2">
            <RecentsSection chats={recents} activeChatId={activeChatId} projects={projects} />
          </div>
          <SidebarFooter />
        </aside>
      )}
    </SidebarActionsProvider>
  )
})
```

Note: `activeProjectId` and `archivedChats` remain in props (consumed by `page.tsx` and `CollapsedSidebar`); they're intentionally no longer rendered as sections.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Remove now-unused section imports check**

Run: `npm run lint`
Expected: 0 errors. If lint flags unused `QuickChatsSection`/`ProjectsSection`/`ArchivedSection`/`SmartChatMenu` files (they're no longer imported), leave the files in place (reachable via command palette per spec) — they are standalone modules, not imported by Sidebar, so no unused-import error arises. Confirm no unused *import* remains in `Sidebar.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/sidebar/Sidebar.tsx tests/hooks/Sidebar.test.tsx
git commit -m "feat(sidebar): rebuild to nav + flat Recents"
```

---

### Task 9: `ProjectsView` and `ArtifactsView` (nav destinations)

**Files:**
- Create: `src/components/chat/ProjectsView.tsx`
- Create: `src/components/chat/ArtifactsView.tsx`
- Test: `tests/hooks/ProjectsView.test.tsx`

**Interfaces:**
- Consumes: `Project` type (`{ id, name }`).
- Produces:
  - `<ProjectsView projects onSelectProject={(id) => void} />` — a grid of project cards; clicking selects.
  - `<ArtifactsView />` — Slice 1 empty state ("No artifacts yet"); Slice 3 replaces with the real list. Used by the render switch (Task 10).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/ProjectsView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProjectsView } from '@/components/chat/ProjectsView'

afterEach(cleanup)

describe('ProjectsView', () => {
  it('lists projects and selects on click', () => {
    const onSelectProject = vi.fn()
    render(<ProjectsView projects={[{ id: 3, name: 'Drover_HUB' }]} onSelectProject={onSelectProject} />)
    fireEvent.click(screen.getByText('Drover_HUB'))
    expect(onSelectProject).toHaveBeenCalledWith(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/ProjectsView.test.tsx`
Expected: FAIL — cannot resolve `ProjectsView`.

- [ ] **Step 3: Write minimal implementations**

Create `src/components/chat/ProjectsView.tsx`:

```tsx
'use client'

import { Folder } from 'lucide-react'

interface ProjectsViewProps {
  projects: { id: number; name: string }[]
  onSelectProject: (id: number) => void
}

export function ProjectsView({ projects, onSelectProject }: ProjectsViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold text-foreground mb-6">Projects</h2>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => onSelectProject(p.id)}
              className="glass-panel rounded-xl p-4 text-left hover:bg-accent transition-colors flex items-center gap-3"
            >
              <Folder className="h-5 w-5 text-primary shrink-0" />
              <span className="font-medium text-foreground truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Create `src/components/chat/ArtifactsView.tsx`:

```tsx
'use client'

import { Boxes } from 'lucide-react'

export function ArtifactsView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
      <Boxes className="h-10 w-10 text-muted-foreground/40" />
      <h2 className="text-xl font-semibold text-foreground">Artifacts</h2>
      <p className="text-sm text-muted-foreground">No artifacts yet. Generated files will appear here.</p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/ProjectsView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ProjectsView.tsx src/components/chat/ArtifactsView.tsx tests/hooks/ProjectsView.test.tsx
git commit -m "feat(layout): add ProjectsView grid and ArtifactsView empty state"
```

---

### Task 10: Wire Home + view switch into `page.tsx`

**Files:**
- Modify: `src/app/page.tsx` (the empty-state render block ~L1010–1039 and the view conditionals)

**Interfaces:**
- Consumes: `HomeGreeting` (T3), `QuickActions` (T4), `ProjectsView`/`ArtifactsView` (T9), `activeView` state (T5).

- [ ] **Step 1: Add imports**

At the top of `src/app/page.tsx`, add:

```tsx
import { HomeGreeting } from "@/components/chat/HomeGreeting"
import { QuickActions } from "@/components/chat/QuickActions"
import { ProjectsView } from "@/components/chat/ProjectsView"
import { ArtifactsView } from "@/components/chat/ArtifactsView"
```

- [ ] **Step 2: Add the Projects/Artifacts branches and restyle Home**

In the main render, the view order becomes: `activeView === 'projects'` → `ProjectsView`; `activeView === 'artifacts'` → `ArtifactsView`; else the existing `activeChatId ? chat : activeProjectId ? ProjectLandingPage : home`. Wrap the existing `activeChatId ? … : activeProjectId ? … : (home)` ternary so the two new views take precedence. Concretely, replace the opening of the conditional (`{activeChatId ? (`) region's start with:

```tsx
        {activeView === 'projects' ? (
          <ProjectsView projects={projects} onSelectProject={handleSelectProject} />
        ) : activeView === 'artifacts' ? (
          <ArtifactsView />
        ) : activeChatId ? (
```

…leaving the existing chat and `ProjectLandingPage` branches intact, and replace the final empty-state branch (the `) : (` block at ~L1010–1038) with:

```tsx
        ) : (
          <>
            <div className="flex-1 flex flex-col items-center justify-center w-full max-w-[var(--thread-max-width)] mx-auto px-4">
              <HomeGreeting />
              <div className="w-full">
                <ChatInputArea
                  input={input}
                  onInputChange={setInput}
                  onFormSubmit={handleFormSubmit}
                  onKeyDown={handleKeyDown}
                  isLoading={isLoading}
                  activeChatId={activeChatId}
                  activeProjectId={activeProjectId}
                  systemPrompt={currentSystemPrompt}
                  onSystemPromptChange={handleSaveSystemPrompt}
                  onSystemPromptClick={() => setSystemPromptDialogOpen(true)}
                  models={models}
                  selectedModel={selectedModel}
                  onModelChange={handleModelChange}
                  attachedFiles={attachedFiles}
                  onFilesChange={setAttachedFiles}
                  attachedImages={attachedImages}
                  onImagesChange={setAttachedImages}
                />
              </div>
              <QuickActions
                onNewProject={handleCreateProject}
                onUpload={() => activeProjectId && handleOpenProjectDocuments(activeProjectId)}
                onWrite={() => setInput('Help me write ')}
                onCode={() => setInput('Help me write code for ')}
              />
            </div>
          </>
        )}
```

(If `handleCreateProject`/`handleOpenProjectDocuments` are not in scope at this point in the file, they are defined earlier in `page.tsx` and used by `sidebarActions` — reference them directly.)

- [ ] **Step 3: Verify typecheck + build + full tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: all pass.

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`, open http://localhost:3000.
Expected: Home shows the time-of-day greeting, a centered composer, and the four chips. Sidebar shows New chat / Projects / Artifacts / Customize + Recents. Clicking **Projects** shows the projects grid; **Artifacts** shows the empty state; selecting a project opens its landing page; **Customize** opens Settings.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): centered greeting, composer, and chips; wire view switch"
```

---

### Task 11: Responsive off-canvas sidebar

**Files:**
- Modify: `src/app/page.tsx` (root layout wrapper around the `<Sidebar>` + a mobile hamburger toggle)

**Interfaces:**
- Consumes: existing `sidebarCollapsed` state / `toggleCollapse` action.

- [ ] **Step 1: Make the sidebar off-canvas on narrow widths**

In `src/app/page.tsx`, the root returns `<div className="flex h-screen w-full overflow-hidden p-4 gap-4">` (~L913). Wrap the `<Sidebar>` so that on `<md` it is absolutely positioned and slides off-canvas when collapsed, and add a hamburger button visible only on `<md` that calls `setSidebarCollapsed(prev => !prev)`. Concretely, add a `md:hidden` toggle button at the top-left of `<main>` and give the sidebar wrapper responsive classes:

```tsx
      <div className={cn(
        "shrink-0 transition-transform duration-300",
        "max-md:absolute max-md:z-30 max-md:h-[calc(100vh-2rem)]",
        sidebarCollapsed && "max-md:-translate-x-[120%]",
      )}>
        <Sidebar /* …existing props… */ />
      </div>
```

And inside `<main>`, before its content, add:

```tsx
        <button
          onClick={() => setSidebarCollapsed(prev => !prev)}
          className="md:hidden mb-2 p-2 rounded-lg hover:bg-accent text-muted-foreground self-start"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
```

Add `Menu` to the `lucide-react` import in `page.tsx`.

- [ ] **Step 2: Verify build + manual responsive check**

Run: `npm run build` then `npm run dev`.
Expected: at desktop width the sidebar is docked as before; narrowing the window below `md` hides it off-canvas, and the hamburger toggles it.

- [ ] **Step 3: Run the full gate**

Run: `npm run lint && npm run typecheck && npm run build && npm test`
Expected: 0 lint errors, typecheck clean, build clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(layout): responsive off-canvas sidebar with hamburger toggle"
```

---

## Self-Review

**Spec coverage (Slice 1 scope):**
- Sidebar rebuild (SidebarNav + Recents) → Tasks 6, 7, 8 ✓
- HomeGreeting + QuickActions → Tasks 3, 4, 10 ✓
- Layout dimension tokens → Task 1 (consumed in Tasks 8, 10) ✓
- Responsive off-canvas sidebar → Task 11 ✓
- Nav destinations (Projects/Artifacts) → Tasks 5, 9, 10 ✓
- Greeting time-of-day helper → Task 2 ✓
- Deferred to later slices (correctly absent here): Memory/Instructions columns + chat injection (Slice 2), display-name setting + real artifacts list (Slice 3). `HomeGreeting` accepts `displayName?` now; Slice 3 supplies it. `ArtifactsView` is an empty state now; Slice 3 fills it.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Each code step shows complete code. The one cross-slice seam (`displayName?`, `ArtifactsView` empty state) is an intentional optional/empty-state, not a placeholder.

**Type consistency:** `AppView` defined in Task 5 and used by `SidebarNav` (Task 7) and the page switch (Task 10). `selectView(view)`/`activeView` names match across `types.ts`, `SidebarNav`, and `page.tsx`. `ChatItem` props (`chat`, `isActive`, `projects`, `variant`, `currentProjectId`) match the real component read from source. `SidebarProps` signature unchanged in Task 8.

## Notes / known follow-ups for Slice 2–3
- Slice 2: `ProjectContextRail` (Memory/Instructions/Files + capacity), migration `0006`, `updateProjectContext`, chat-route injection. ProjectLandingPage → 3-pane.
- Slice 3: `getAllArtifacts` + real `ArtifactsView` list; `display-name` setting + Customize field; pass `displayName` into `HomeGreeting`.
