# Claude.ai Layout — Slice 3 (Artifacts List + Display Name) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill in the last two Claude.ai-layout pieces: the **Artifacts** nav opens a real list of every generated artifact (replacing the Slice 1 empty-state placeholder), and a **display name** in Settings drives the home greeting ("Good evening, Daniel").

**Architecture:** A new `getAllArtifacts()` server action (like `getChatArtifacts` without the chat filter). `ArtifactsView` becomes a real grid that fetches it and reuses `ArtifactCard`. The display name is a non-sensitive `display-name` row in the existing `settings` table; `page.tsx` loads it, passes it to `HomeGreeting`, and renders an editable field in the Appearance settings tab.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), Drizzle/postgres-js, Vitest (PGlite + jsdom), Tailwind v4, lucide-react.

## Global Constraints

- **Branch:** `feat/claude-ai-layout` (continues from Slices 1–2). **No DB migration** — `display-name` is a `settings` row.
- `display-name` must **not** be added to `SENSITIVE_KEYS` (it must be client-readable via `getSetting`).
- Server Components/actions use `"use server"` (actions.ts already is); new client components `"use client"`.
- Brand tokens only; reuse `ArtifactCard`. Conventional Commits 1.0.
- **Gate:** `npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`.

---

### Task 1: `getAllArtifacts` server action

**Files:**
- Modify: `src/app/actions.ts` (add after `getChatArtifacts`, ~L567)
- Test: `tests/unit/actions/all-artifacts.test.ts`

**Interfaces:**
- Consumes: `artifacts` table, `createSignedDownloadUrl` (both already imported in actions.ts), `desc` from drizzle-orm.
- Produces: `getAllArtifacts(): Promise<ArtifactSummary[]>` — every artifact, newest first, each with a signed `downloadUrl`. Consumed by `ArtifactsView` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/actions/all-artifacts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))
vi.mock('@/lib/storage', () => ({
  createSignedDownloadUrl: vi.fn(async (p: string) => `signed:${p}`),
  isStorageConfigured: () => true,
}))

describe('getAllArtifacts', () => {
  beforeEach(async () => { await createTestDb() })

  it('returns all artifacts newest-first with signed urls', async () => {
    const { createProject, createChat, createArtifact, updateArtifactStoragePath, getAllArtifacts } = await import('@/app/actions')
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    const [a1] = await createArtifact({ chatId: c.id, projectId: p.id, type: 'xlsx', title: 'First' })
    const [a2] = await createArtifact({ chatId: c.id, projectId: p.id, type: 'pdf', title: 'Second' })
    await updateArtifactStoragePath(a1.id, 'artifacts/a1.xlsx', 'ready')
    await updateArtifactStoragePath(a2.id, 'artifacts/a2.pdf', 'ready')

    const all = await getAllArtifacts()
    expect(all.map(a => a.title)).toContain('First')
    expect(all.map(a => a.title)).toContain('Second')
    const second = all.find(a => a.title === 'Second')!
    expect(second.downloadUrl).toBe('signed:artifacts/a2.pdf')
  })

  it('returns [] when there are no artifacts', async () => {
    const { getAllArtifacts } = await import('@/app/actions')
    expect(await getAllArtifacts()).toEqual([])
  })
})
```

> Note: confirm the exact signatures of `createArtifact` / `updateArtifactStoragePath` in `src/app/actions.ts` before running; if they differ (e.g. positional args), adjust the test's calls to match. The assertions on `getAllArtifacts` stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/actions/all-artifacts.test.ts`
Expected: FAIL — `getAllArtifacts` not exported.

- [ ] **Step 3: Implement the action**

In `src/app/actions.ts`, immediately after `getChatArtifacts` (~L567), add:

```ts
export async function getAllArtifacts() {
  const rows = await db.select().from(artifacts).orderBy(desc(artifacts.createdAt))
  return await Promise.all(rows.map(async (r) => ({
    id: r.id, chatId: r.chatId, type: r.type, title: r.title, status: r.status, createdAt: r.createdAt,
    downloadUrl: r.storagePath ? await createSignedDownloadUrl(r.storagePath).catch(() => null) : null,
  })))
}
```

Ensure `desc` is imported from `drizzle-orm` at the top of actions.ts (it already imports `asc`/`eq`; add `desc` to that import if absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/actions/all-artifacts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/actions.ts tests/unit/actions/all-artifacts.test.ts
git commit -m "feat(artifacts): add getAllArtifacts action"
```

---

### Task 2: Real `ArtifactsView` (replace the empty-state placeholder)

**Files:**
- Modify: `src/components/chat/ArtifactsView.tsx` (built as an empty state in Slice 1)
- Test: `tests/hooks/ArtifactsView.test.tsx`

**Interfaces:**
- Consumes: `getAllArtifacts` (Task 1), `ArtifactCard` (existing), `ArtifactSummary` type.
- Produces: `<ArtifactsView />` — on mount, fetches all artifacts and renders an `ArtifactCard` grid; shows the empty state when there are none; a loading state while fetching.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/ArtifactsView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getAllArtifacts: vi.fn(async () => ([
    { id: 1, chatId: 2, type: 'xlsx', title: 'Schedule', status: 'ready', downloadUrl: 'http://x/s.xlsx', createdAt: null },
  ])),
}))

afterEach(cleanup)
import { ArtifactsView } from '@/components/chat/ArtifactsView'

describe('ArtifactsView', () => {
  it('lists fetched artifacts', async () => {
    render(<ArtifactsView />)
    await waitFor(() => expect(screen.getByText('Schedule')).toBeTruthy())
    expect(screen.getByText('Download')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/ArtifactsView.test.tsx`
Expected: FAIL — current `ArtifactsView` renders only the static empty state; "Schedule" never appears.

- [ ] **Step 3: Rewrite ArtifactsView**

Replace `src/components/chat/ArtifactsView.tsx` with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import { getAllArtifacts } from '@/app/actions'
import { ArtifactCard } from '@/components/chat/ArtifactCard'

export function ArtifactsView() {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null)

  useEffect(() => {
    let active = true
    getAllArtifacts().then(rows => { if (active) setArtifacts(rows) }).catch(() => { if (active) setArtifacts([]) })
    return () => { active = false }
  }, [])

  if (artifacts === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
        <Boxes className="h-10 w-10 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-foreground">Artifacts</h2>
        <p className="text-sm text-muted-foreground">No artifacts yet. Generated files will appear here.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold text-foreground mb-6">Artifacts</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {artifacts.map(a => <ArtifactCard key={a.id} artifact={a} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/ArtifactsView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ArtifactsView.tsx tests/hooks/ArtifactsView.test.tsx
git commit -m "feat(artifacts): real ArtifactsView grid backed by getAllArtifacts"
```

---

### Task 3: Display-name setting → greeting + Appearance field

**Files:**
- Modify: `src/components/settings/AppearanceSettingsTab.tsx` (add a Display Name input)
- Modify: `src/components/ui/SettingsDialog.tsx` (pass the two new props through to the Appearance tab)
- Modify: `src/app/page.tsx` (load `display-name`, pass to `HomeGreeting` + the settings dialog, persist on change)
- Test: `tests/hooks/AppearanceSettingsTab.displayName.test.tsx`

**Interfaces:**
- Consumes: `getSetting('display-name')` / `setSetting('display-name', value)` (existing, non-sensitive).
- Produces: `AppearanceSettingsTab` gains `displayName: string` + `onDisplayNameChange: (v: string) => void`. `page.tsx` holds `displayName` state, loads it on mount, passes `displayName` to `HomeGreeting` and the dialog, and persists via `setSetting` on change.

- [ ] **Step 1: Write the failing test (Appearance field)**

Create `tests/hooks/AppearanceSettingsTab.displayName.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))

afterEach(cleanup)
import { AppearanceSettingsTab } from '@/components/settings/AppearanceSettingsTab'

describe('AppearanceSettingsTab display name', () => {
  it('renders the current name and reports changes', () => {
    const onDisplayNameChange = vi.fn()
    render(
      <AppearanceSettingsTab
        fontSize="medium" onFontSizeChange={vi.fn()}
        messageDensity="comfortable" onMessageDensityChange={vi.fn()}
        displayName="Daniel" onDisplayNameChange={onDisplayNameChange}
      />
    )
    const input = screen.getByLabelText('Display name') as HTMLInputElement
    expect(input.value).toBe('Daniel')
    fireEvent.change(input, { target: { value: 'Dan' } })
    expect(onDisplayNameChange).toHaveBeenCalledWith('Dan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/AppearanceSettingsTab.displayName.test.tsx`
Expected: FAIL — no `displayName` prop / no "Display name" field.

- [ ] **Step 3: Add the field to AppearanceSettingsTab**

In `src/components/settings/AppearanceSettingsTab.tsx`:

1. Extend the props interface:

```ts
interface AppearanceSettingsTabProps {
  fontSize: FontSize
  onFontSizeChange: (size: FontSize) => void
  messageDensity: MessageDensity
  onMessageDensityChange: (density: MessageDensity) => void
  displayName: string
  onDisplayNameChange: (value: string) => void
}
```

2. Add `displayName, onDisplayNameChange` to the destructured params.

3. Add this block as the first child inside the returned `<div className="space-y-6">`, before the Theme block:

```tsx
      {/* Display name */}
      <div className="space-y-2">
        <label htmlFor="display-name" className="text-sm font-medium">Display name</label>
        <input
          id="display-name" aria-label="Display name" type="text" value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="Your name (shown in the greeting)"
          className="w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
```

- [ ] **Step 4: Run the field test to verify it passes**

Run: `npx vitest run tests/hooks/AppearanceSettingsTab.displayName.test.tsx`
Expected: PASS.

- [ ] **Step 5: Pass the props through SettingsDialog**

In `src/components/ui/SettingsDialog.tsx`: find the `SettingsDialog` props interface and add `displayName: string` + `onDisplayNameChange: (v: string) => void`. Destructure them, and pass them to the Appearance tab render (~L90–97):

```tsx
              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  fontSize={fontSize}
                  onFontSizeChange={onFontSizeChange}
                  messageDensity={messageDensity}
                  onMessageDensityChange={onMessageDensityChange}
                  displayName={displayName}
                  onDisplayNameChange={onDisplayNameChange}
                />
              )}
```

(Match the exact existing prop names for `fontSize`/`messageDensity` in that file; add the two new ones alongside.)

- [ ] **Step 6: Wire page.tsx — load, pass, persist**

In `src/app/page.tsx`:

1. Add `setSetting` to the `./actions` import (alongside `getSetting`).
2. Add state + load near the other settings state:

```tsx
  const [displayName, setDisplayName] = useState('')
  useEffect(() => { getSetting('display-name').then(v => { if (v) setDisplayName(v) }).catch(() => {}) }, [])
```

3. Add a change handler:

```tsx
  const handleDisplayNameChange = useCallback((value: string) => {
    setDisplayName(value)
    setSetting('display-name', value).catch(() => {})
  }, [])
```

4. Pass `displayName` to the home greeting: change `<HomeGreeting />` to `<HomeGreeting displayName={displayName || undefined} />`.
5. Pass `displayName={displayName}` and `onDisplayNameChange={handleDisplayNameChange}` to the `<SettingsDialog … />` render.

- [ ] **Step 7: Full gate**

Run: `npm run lint && npm run typecheck && npm run build && npm test`
Expected: 0 lint errors, clean typecheck/build, all tests pass.

- [ ] **Step 8: Manual smoke**

Run: `npm run dev`. Open Settings → Appearance → set a Display name → close. The home greeting reads "Good {time}, {name}". Reload — the name persists (DB-backed). Click **Artifacts** in the sidebar — the grid lists generated artifacts (or the empty state if none).

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/AppearanceSettingsTab.tsx src/components/ui/SettingsDialog.tsx src/app/page.tsx tests/hooks/AppearanceSettingsTab.displayName.test.tsx
git commit -m "feat(home): display-name setting drives the greeting"
```

---

## Self-Review

**Spec coverage (Slice 3):**
- `getAllArtifacts` → Task 1 ✓
- Real Artifacts list view → Task 2 ✓
- `display-name` setting + Customize field + greeting wiring → Task 3 ✓

**Placeholder scan:** No TBD/"add error handling". Each step has complete code. Task 1's note to confirm `createArtifact`/`updateArtifactStoragePath` signatures is a verification instruction (the file is the source of truth), not a placeholder — the `getAllArtifacts` code itself is complete.

**Type consistency:** `getAllArtifacts(): ArtifactSummary[]` matches `ArtifactCard`'s `{ artifact: ArtifactSummary }` (fields id/chatId/type/title/status/downloadUrl/createdAt confirmed from `src/types.ts`). `displayName: string` + `onDisplayNameChange: (v: string) => void` consistent across AppearanceSettingsTab, SettingsDialog, and page.tsx. `HomeGreeting` already accepts `displayName?: string` (Slice 1).

## After Slice 3
All three slices complete → run the full gate once more, then finish the branch (recommend merging Slices 1–3 together so production gets the complete layout in one cutover). Live `0006` already applied.
