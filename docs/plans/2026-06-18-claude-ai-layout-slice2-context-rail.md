# Claude.ai Layout — Slice 2 (Project Context Rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the project view into the Claude.ai 3-pane: sidebar │ chat list │ a right **context rail** with functional **Memory** + **Instructions** (persisted per project, injected into Claude's system prompt) and a **Files** section with a capacity bar.

**Architecture:** Add `memory` + `instructions` columns to `projects` (migration `0006`). New server actions `updateProjectContext` / `getProjectContext`. The chat route prepends the project's Memory + Instructions to the system prompt. A new `ProjectContextRail` component (with a `CapacityBar`) takes over the Files section from `ProjectLandingPage` and adds the two editable, debounced-save fields. `ProjectLandingPage` becomes chats-column + rail.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), Drizzle/postgres-js (Supabase), AI SDK v6, Vitest (PGlite for DB tests, jsdom for components), Tailwind v4, lucide-react.

## Global Constraints

- **Branch:** `feat/claude-ai-layout` (continues from Slice 1).
- **DB:** Drizzle on `postgres-js`, `prepare: false`. Migrations authored with `npx drizzle-kit generate`, applied with `DIRECT_URL=… npx drizzle-kit migrate`. New migration is **`0006`**; columns are **nullable** (additive, safe).
- **No direct `process.env`** outside the established constant pattern; `PROJECT_CAPACITY_BYTES` reads `process.env.PROJECT_CAPACITY_BYTES` once in a lib module (mirrors `MAX_FILE_SIZE`).
- **Server Components / actions** use `"use server"` (actions.ts already is). New client components are `"use client"`.
- **Brand tokens only** (no `bg-white/X`, no gradients). Reuse `glass-panel`, semantic tokens.
- **Conventional Commits 1.0**, imperative lowercase, no trailing period.
- **Gate:** `npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`. DB tests use PGlite (migrations from `drizzle/` auto-apply in-process).
- **LIVE MIGRATION GATE:** applying `0006` to the live Supabase project is a **user-gated step** (Task 1, Step 5) — do not run it without explicit go-ahead. PGlite tests do not need it.

---

### Task 1: Migration 0006 — `projects.memory` + `projects.instructions`

**Files:**
- Modify: `src/db/schema.ts` (the `projects` table)
- Create: `drizzle/0006_*.sql` (generated)

**Interfaces:**
- Produces: `projects.memory: text | null`, `projects.instructions: text | null`. Consumed by Tasks 2, 3, 5, 7.

- [ ] **Step 1: Add the columns to the schema**

In `src/db/schema.ts`, in the `projects` table definition, add after `defaultModel`:

```ts
  memory: text('memory'),
  instructions: text('instructions'),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/0006_*.sql` containing `ALTER TABLE "projects" ADD COLUMN "memory" text;` and `ADD COLUMN "instructions" text;`.

- [ ] **Step 3: Verify the migration file**

Run: `ls drizzle/ | tail -2`
Expected: `0006_*.sql` present. Open it; confirm two additive `ADD COLUMN` statements, no drops.

- [ ] **Step 4: Verify PGlite tests still bootstrap (migrations apply in-process)**

Run: `npx vitest run tests/unit/db/harness.test.ts`
Expected: PASS — the test DB applies all migrations incl. `0006`.

- [ ] **Step 5: Commit (schema + migration)**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add projects.memory and projects.instructions (migration 0006)"
```

> **LIVE APPLY (user-gated, do NOT run without go-ahead):** `DIRECT_URL=… npx drizzle-kit migrate` against live Supabase before the chat-injection change deploys. Additive + nullable, so safe and non-breaking.

---

### Task 2: `updateProjectContext` + `getProjectContext` server actions

**Files:**
- Modify: `src/app/actions.ts` (add two actions near `updateProjectName`, ~L52)
- Test: `tests/unit/actions/project-context.test.ts`

**Interfaces:**
- Consumes: `projects` columns from Task 1.
- Produces:
  - `updateProjectContext(id: number, fields: { memory?: string | null; instructions?: string | null }): Promise<Project[]>` — partial update, returns the updated row.
  - `getProjectContext(id: number): Promise<{ memory: string | null; instructions: string | null } | null>`.
  Consumed by the chat route (Task 3) and page.tsx (Task 7).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/actions/project-context.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb() } }))

describe('project context actions', () => {
  beforeEach(async () => { await createTestDb() })

  it('updates and reads back memory + instructions', async () => {
    const { createProject, updateProjectContext, getProjectContext } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await updateProjectContext(p.id, { memory: 'Vernon, TX hub', instructions: 'Be terse.' })
    const ctx = await getProjectContext(p.id)
    expect(ctx).toEqual({ memory: 'Vernon, TX hub', instructions: 'Be terse.' })
  })

  it('updates only the provided field', async () => {
    const { createProject, updateProjectContext, getProjectContext } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await updateProjectContext(p.id, { memory: 'A' })
    await updateProjectContext(p.id, { instructions: 'B' })
    expect(await getProjectContext(p.id)).toEqual({ memory: 'A', instructions: 'B' })
  })

  it('returns null for a missing project', async () => {
    const { getProjectContext } = await import('@/app/actions')
    expect(await getProjectContext(9999)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/actions/project-context.test.ts`
Expected: FAIL — `updateProjectContext`/`getProjectContext` not exported.

- [ ] **Step 3: Implement the actions**

In `src/app/actions.ts`, after `updateProjectName` (~L54), add:

```ts
export async function updateProjectContext(
  id: number,
  fields: { memory?: string | null; instructions?: string | null },
) {
  const set: { memory?: string | null; instructions?: string | null } = {}
  if ('memory' in fields) set.memory = fields.memory ?? null
  if ('instructions' in fields) set.instructions = fields.instructions ?? null
  return await db.update(projects).set(set).where(eq(projects.id, id)).returning()
}

export async function getProjectContext(id: number) {
  const [row] = await db
    .select({ memory: projects.memory, instructions: projects.instructions })
    .from(projects)
    .where(eq(projects.id, id))
  return row ?? null
}
```

(`projects`, `eq`, `db` are already imported in actions.ts.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/actions/project-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/actions.ts tests/unit/actions/project-context.test.ts
git commit -m "feat(projects): add updateProjectContext and getProjectContext actions"
```

---

### Task 3: Inject project Memory + Instructions into the chat system prompt

**Files:**
- Modify: `src/app/api/chat/route.ts` (the `if (chat?.systemPrompt)` block, ~L64–67)
- Create: `src/lib/projectPreamble.ts` (pure builder, unit-testable)
- Test: `tests/unit/lib/projectPreamble.test.ts`

**Interfaces:**
- Consumes: `getProjectContext` (Task 2).
- Produces: `buildProjectPreamble(memory: string | null, instructions: string | null): string` — a delimited preamble (empty string if both blank). Used by the chat route.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/projectPreamble.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildProjectPreamble } from '@/lib/projectPreamble'

describe('buildProjectPreamble', () => {
  it('returns empty string when both are blank', () => {
    expect(buildProjectPreamble(null, null)).toBe('')
    expect(buildProjectPreamble('', '  ')).toBe('')
  })
  it('includes memory and instructions with clear delimiters', () => {
    const out = buildProjectPreamble('Vernon hub', 'Be terse')
    expect(out).toContain('Project memory:')
    expect(out).toContain('Vernon hub')
    expect(out).toContain('Project instructions:')
    expect(out).toContain('Be terse')
  })
  it('omits the empty section', () => {
    expect(buildProjectPreamble('only memory', null)).toContain('Project memory:')
    expect(buildProjectPreamble('only memory', null)).not.toContain('Project instructions:')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/projectPreamble.test.ts`
Expected: FAIL — cannot resolve `@/lib/projectPreamble`.

- [ ] **Step 3: Implement the builder**

Create `src/lib/projectPreamble.ts`:

```ts
/** Build a system-prompt preamble from a project's Memory + Instructions. Empty when both blank. */
export function buildProjectPreamble(memory: string | null, instructions: string | null): string {
  const parts: string[] = []
  if (memory && memory.trim()) parts.push(`Project memory:\n${memory.trim()}`)
  if (instructions && instructions.trim()) parts.push(`Project instructions:\n${instructions.trim()}`)
  return parts.join('\n\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/projectPreamble.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into the chat route**

In `src/app/api/chat/route.ts`, add the import at the top with the other `@/` imports:

```ts
import { getProjectContext } from '@/app/actions'
import { buildProjectPreamble } from '@/lib/projectPreamble'
```

Replace the system-prompt block (~L64–67):

```ts
      // 1. System prompt (always included, never trimmed)
      if (chat?.systemPrompt) {
        systemPrompt = chat.systemPrompt;
      }
```

with:

```ts
      // 1. System prompt (always included, never trimmed). Project Memory +
      //    Instructions are prepended so they steer every chat in the project.
      let preamble = '';
      if (chat?.projectId) {
        const ctx = await getProjectContext(chat.projectId);
        if (ctx) preamble = buildProjectPreamble(ctx.memory, ctx.instructions);
      }
      const base = chat?.systemPrompt ?? '';
      const combined = [preamble, base].filter(s => s.trim().length > 0).join('\n\n');
      systemPrompt = combined.length > 0 ? combined : undefined;
```

- [ ] **Step 6: Verify the chat route test still passes**

Run: `npx vitest run tests/unit/api/chat-route.test.ts`
Expected: PASS (existing chat-route tests unaffected — no project context in those fixtures, so `preamble` is empty and behavior is unchanged).

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/projectPreamble.ts tests/unit/lib/projectPreamble.test.ts src/app/api/chat/route.ts
git commit -m "feat(chat): inject project memory + instructions into the system prompt"
```

---

### Task 4: `PROJECT_CAPACITY_BYTES` constant + `CapacityBar` component

**Files:**
- Create: `src/lib/projectCapacity.ts`
- Create: `src/components/chat/CapacityBar.tsx`
- Test: `tests/hooks/CapacityBar.test.tsx`

**Interfaces:**
- Produces:
  - `PROJECT_CAPACITY_BYTES: number` (default `2 * 1024 * 1024 * 1024`, env `PROJECT_CAPACITY_BYTES`).
  - `<CapacityBar usedBytes={number} capBytes={number} />` — renders "N% of project capacity used", clamped to 100. Used by `ProjectContextRail` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/CapacityBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CapacityBar } from '@/components/chat/CapacityBar'

afterEach(cleanup)

describe('CapacityBar', () => {
  it('shows the rounded percent used', () => {
    render(<CapacityBar usedBytes={500} capBytes={1000} />)
    expect(screen.getByText(/50% of project capacity used/)).toBeTruthy()
  })
  it('clamps over-capacity to 100%', () => {
    render(<CapacityBar usedBytes={3000} capBytes={1000} />)
    expect(screen.getByText(/100% of project capacity used/)).toBeTruthy()
  })
  it('handles a zero cap without NaN', () => {
    render(<CapacityBar usedBytes={10} capBytes={0} />)
    expect(screen.getByText(/0% of project capacity used/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/CapacityBar.test.tsx`
Expected: FAIL — cannot resolve `@/components/chat/CapacityBar`.

- [ ] **Step 3: Implement the constant and component**

Create `src/lib/projectCapacity.ts`:

```ts
/** Soft per-project storage cap for the Files capacity bar. Env-overridable. */
export const PROJECT_CAPACITY_BYTES =
  Number(process.env.PROJECT_CAPACITY_BYTES) || 2 * 1024 * 1024 * 1024 // 2 GB
```

Create `src/components/chat/CapacityBar.tsx`:

```tsx
'use client'

export function CapacityBar({ usedBytes, capBytes }: { usedBytes: number; capBytes: number }) {
  const ratio = capBytes > 0 ? Math.min(1, usedBytes / capBytes) : 0
  const pct = Math.round(ratio * 100)
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className="h-full rounded-full bg-primary/70 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{pct}% of project capacity used</p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/CapacityBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/projectCapacity.ts src/components/chat/CapacityBar.tsx tests/hooks/CapacityBar.test.tsx
git commit -m "feat(projects): add capacity constant and CapacityBar component"
```

---

### Task 5: `ProjectContextRail` component (Memory + Instructions + Files)

This task moves the Files logic out of `ProjectLandingPage` into a self-contained rail and adds the two debounced-save editable fields.

**Files:**
- Create: `src/components/chat/ProjectContextRail.tsx`
- Test: `tests/hooks/ProjectContextRail.test.tsx`

**Interfaces:**
- Consumes: `DocumentSummary`, `useDocumentUpload`, `DocumentCard`, `DocumentPreviewDialog`, `CapacityBar` (Task 4), `PROJECT_CAPACITY_BYTES` (Task 4).
- Produces: `<ProjectContextRail project onSaveContext onAddFiles />` where
  - `project: { id: number; name: string; memory?: string | null; instructions?: string | null }`
  - `onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void` (debounced caller is internal)
  - `onAddFiles: () => void`
  Renders Memory (editable), Instructions (editable), and Files (capacity bar + DocumentCard grid + upload/delete/preview). Used by `ProjectLandingPage` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/ProjectContextRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ documents: [] }) })) as never)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

import { ProjectContextRail } from '@/components/chat/ProjectContextRail'

describe('ProjectContextRail', () => {
  it('renders Memory, Instructions, and Files sections', async () => {
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: 'Hub', instructions: 'Terse' }} onSaveContext={vi.fn()} onAddFiles={vi.fn()} />)
    expect(screen.getByText('Memory')).toBeTruthy()
    expect(screen.getByText('Instructions')).toBeTruthy()
    expect(screen.getByText('Files')).toBeTruthy()
    expect((screen.getByLabelText('Memory') as HTMLTextAreaElement).value).toBe('Hub')
  })

  it('debounce-saves edited memory', async () => {
    vi.useFakeTimers()
    const onSaveContext = vi.fn()
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: '', instructions: '' }} onSaveContext={onSaveContext} onAddFiles={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Memory'), { target: { value: 'New context' } })
    vi.advanceTimersByTime(700)
    vi.useRealTimers()
    await waitFor(() => expect(onSaveContext).toHaveBeenCalledWith(1, { memory: 'New context' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/ProjectContextRail.test.tsx`
Expected: FAIL — cannot resolve `@/components/chat/ProjectContextRail`.

- [ ] **Step 3: Implement the rail**

Create `src/components/chat/ProjectContextRail.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText, Plus, Upload, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { DocumentSummary } from '@/types'
import { useDocumentUpload } from '@/hooks/useDocumentUpload'
import { DocumentCard } from '@/components/chat/DocumentCard'
import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import { CapacityBar } from '@/components/chat/CapacityBar'
import { PROJECT_CAPACITY_BYTES } from '@/lib/projectCapacity'

interface ProjectContextRailProps {
  project: { id: number; name: string; memory?: string | null; instructions?: string | null }
  onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void
  onAddFiles: () => void
}

function useDebouncedSave(projectId: number, onSaveContext: ProjectContextRailProps['onSaveContext']) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((fields: { memory?: string; instructions?: string }) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onSaveContext(projectId, fields), 600)
  }, [projectId, onSaveContext])
}

export function ProjectContextRail({ project, onSaveContext, onAddFiles }: ProjectContextRailProps) {
  const [memory, setMemory] = useState(project.memory ?? '')
  const [instructions, setInstructions] = useState(project.instructions ?? '')
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [previewDoc, setPreviewDoc] = useState<DocumentSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveMemory = useDebouncedSave(project.id, onSaveContext)
  const saveInstructions = useDebouncedSave(project.id, onSaveContext)

  // Reset local fields when switching projects.
  useEffect(() => { setMemory(project.memory ?? ''); setInstructions(project.instructions ?? '') }, [project.id, project.memory, project.instructions])

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?projectId=${project.id}`)
      if (res.ok) setDocuments((await res.json()).documents)
    } catch { /* silent */ }
  }, [project.id])
  useEffect(() => { loadDocuments() }, [loadDocuments])

  const { upload, uploading } = useDocumentUpload()
  const handleUpload = async (file: File) => {
    if (uploading) return
    try { await upload(file, project.id); toast.success(`Uploaded: ${file.name}`); await loadDocuments() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
  }
  const handleDelete = async (docId: number) => {
    try {
      const res = await fetch(`/api/documents?id=${docId}`, { method: 'DELETE' })
      if (res.ok) { setDocuments(prev => prev.filter(d => d.id !== docId)); toast.success('Deleted') }
    } catch { toast.error('Failed to delete') }
  }
  const usedBytes = documents.reduce((sum, d) => sum + (d.fileSize ?? 0), 0)

  return (
    <aside className="w-(--rail-width) shrink-0 flex flex-col gap-4 overflow-y-auto border-l border-border/40 p-4">
      {/* Memory */}
      <section>
        <label htmlFor="rail-memory" className="text-sm font-semibold text-foreground">Memory</label>
        <textarea
          id="rail-memory" aria-label="Memory" value={memory}
          onChange={e => { setMemory(e.target.value); saveMemory({ memory: e.target.value }) }}
          placeholder="Purpose & context for this project…"
          className="mt-2 w-full min-h-20 resize-y rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* Instructions */}
      <section>
        <label htmlFor="rail-instructions" className="text-sm font-semibold text-foreground">Instructions</label>
        <textarea
          id="rail-instructions" aria-label="Instructions" value={instructions}
          onChange={e => { setInstructions(e.target.value); saveInstructions({ instructions: e.target.value }) }}
          placeholder="How should Claude behave in this project?"
          className="mt-2 w-full min-h-20 resize-y rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* Files */}
      <section className="flex-1">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" /> Files
          </h2>
          <button
            onClick={() => !uploading && fileInputRef.current?.click()} disabled={uploading}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors', uploading && 'opacity-50 cursor-not-allowed')}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} File
          </button>
        </div>
        <input
          ref={fileInputRef} type="file" className="hidden"
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.py,.js,.ts,.tsx,.jsx,.json,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.yaml,.yml,.xml,.sql,.png,.jpg,.jpeg,.webp"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }}
        />
        <div className="mb-3"><CapacityBar usedBytes={usedBytes} capBytes={PROJECT_CAPACITY_BYTES} /></div>
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Upload className="h-8 w-8 mb-3 opacity-30" />
            <p className="text-sm">No files yet</p>
            <button onClick={onAddFiles} className="text-xs mt-1.5 text-primary/80 hover:text-primary transition-colors">Upload documents for RAG</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {documents.map(doc => (
              <DocumentCard key={doc.id} doc={doc} onOpen={setPreviewDoc} onDelete={(d) => handleDelete(d.id)} />
            ))}
          </div>
        )}
      </section>

      <DocumentPreviewDialog open={previewDoc !== null} onOpenChange={(o) => { if (!o) setPreviewDoc(null) }} document={previewDoc} />
    </aside>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/ProjectContextRail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ProjectContextRail.tsx tests/hooks/ProjectContextRail.test.tsx
git commit -m "feat(projects): add ProjectContextRail with memory, instructions, files"
```

---

### Task 6: Refactor `ProjectLandingPage` to mount the rail

**Files:**
- Modify: `src/components/chat/ProjectLandingPage.tsx`

**Interfaces:**
- Consumes: `ProjectContextRail` (Task 5).
- Produces: `ProjectLandingPage` now takes an extended `project` (`{ id, name, memory?, instructions? }`) and a new `onSaveContext` prop; renders chats column + `ProjectContextRail`. The internal Files state/handlers (documents, upload, delete, preview, drag) move to the rail and are **removed** here.

- [ ] **Step 1: Replace the Files column with the rail**

In `src/components/chat/ProjectLandingPage.tsx`:

1. Update the props interface:

```ts
interface ProjectLandingPageProps {
  project: { id: number; name: string; memory?: string | null; instructions?: string | null }
  chatPreviews: ChatPreview[]
  loading: boolean
  onSelectChat: (chatId: number) => void
  onCreateChat: () => void
  onAddFiles: () => void
  onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void
}
```

2. Remove the now-unused Files state and handlers: delete the `documents`, `docsLoading`, `dragOver`, `fileInputRef`, `previewDoc` state; `loadDocuments`, `handleUpload`, `handleDelete`, `handleDrop`, `handleFileChange`; the `totalChunks`/`readyDocs`/`processingDocs`/`allReady`/`progressRatio` derived values; and the `useDocumentUpload` call. Remove now-unused imports (`useState`, `useEffect`, `useCallback`, `useRef` if no longer used; `DocumentSummary`, `useDocumentUpload`, `DocumentCard`, `DocumentPreviewDialog`, `toast`, `Upload`, `FileText`, `Loader2`, `CheckCircle2`). Keep `Folder`, `Plus`, `MessageSquare`, `cn`.

3. Add the import:

```ts
import { ProjectContextRail } from '@/components/chat/ProjectContextRail'
```

4. Replace the two-column grid's RIGHT `<div>` (the entire `{/* RIGHT: Files */}` block, lines ~182–291) with:

```tsx
        {/* RIGHT: Context rail */}
        <ProjectContextRail project={project} onSaveContext={onSaveContext} onAddFiles={onAddFiles} />
```

5. Change the grid wrapper to give the rail a fixed track:

```tsx
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border/30">
          {/* …existing chats column (New chat row + chat list) unchanged… */}
        </div>
        <ProjectContextRail project={project} onSaveContext={onSaveContext} onAddFiles={onAddFiles} />
      </div>
```

(Keep the destructured `project, chatPreviews, loading, onSelectChat, onCreateChat, onAddFiles, onSaveContext` in the function signature. Remove the trailing `<DocumentPreviewDialog>` at the bottom — it lives in the rail now.)

- [ ] **Step 2: Verify typecheck + build + existing tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; tests pass (no existing test renders `ProjectLandingPage` with the old Files internals; if one does, update it to the new props).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ProjectLandingPage.tsx
git commit -m "refactor(projects): mount ProjectContextRail; move files into the rail"
```

---

### Task 7: Wire `page.tsx` — pass context + save handler

**Files:**
- Modify: `src/app/page.tsx` (the local `Project` type, the `ProjectLandingPage` render, a new `handleSaveProjectContext`)

**Interfaces:**
- Consumes: `updateProjectContext` (Task 2), the extended `ProjectLandingPage` (Task 6).

- [ ] **Step 1: Extend the local Project type and import the action**

In `src/app/page.tsx`, add `updateProjectContext` to the existing `./actions` import. Find the local `Project` interface (~L35, "Types matching DB schema roughly") and add:

```ts
  memory?: string | null
  instructions?: string | null
```

(If `getProjects()` already returns these columns — it does `select().from(projects)` — the `projects` state carries them; only the type needs widening.)

- [ ] **Step 2: Add the save handler**

Near the other project handlers, add:

```tsx
  const handleSaveProjectContext = useCallback(async (id: number, fields: { memory?: string; instructions?: string }) => {
    await updateProjectContext(id, fields)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...fields } : p))
  }, [])
```

- [ ] **Step 3: Pass props to ProjectLandingPage**

In the `ProjectLandingPage` render (in the `activeProjectId ?` branch), pass the matched project (which now carries `memory`/`instructions`) and the handler:

```tsx
          <ProjectLandingPage
            project={projects.find(p => p.id === activeProjectId)!}
            chatPreviews={chatPreviews}
            loading={chatPreviewsLoading}
            onSelectChat={setActiveChatId}
            onCreateChat={handleCreateChat}
            onAddFiles={() => handleOpenProjectDocuments(activeProjectId)}
            onSaveContext={handleSaveProjectContext}
          />
```

- [ ] **Step 4: Full gate**

Run: `npm run lint && npm run typecheck && npm run build && npm test`
Expected: 0 lint errors, clean typecheck/build, all tests pass.

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`, open a project. Expected: 3-pane view — chats on the left, the right rail with editable **Memory** + **Instructions** (typing persists after ~600ms; reload the project to confirm) and **Files** with the capacity bar + document grid.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(projects): wire project context rail save into page state"
```

---

## Self-Review

**Spec coverage (Slice 2):**
- `projects.memory` + `instructions` columns, migration `0006` → Task 1 ✓
- `updateProjectContext` / `getProjectContext` → Task 2 ✓
- Chat-route injection of Memory + Instructions → Task 3 ✓
- `PROJECT_CAPACITY_BYTES` + capacity bar → Task 4 ✓
- `ProjectContextRail` (Memory/Instructions editable + Files) → Task 5 ✓
- ProjectLandingPage → 3-pane → Tasks 6, 7 ✓
- Live migration gated → Task 1 Step 5 note ✓

**Placeholder scan:** No TBD/"add error handling"/"similar to". Each code step is complete. The ProjectLandingPage refactor (Task 6) lists exact symbols to remove and the replacement JSX.

**Type consistency:** `updateProjectContext(id, { memory?, instructions? })` / `getProjectContext(id) → { memory, instructions } | null` are identical across Tasks 2, 3, 7. `ProjectContextRail` props (`project {id,name,memory?,instructions?}`, `onSaveContext(id, fields)`, `onAddFiles`) match Tasks 5, 6, 7. `buildProjectPreamble(memory, instructions)` consistent across Task 3. `CapacityBar({usedBytes, capBytes})` consistent across Tasks 4, 5. `DocumentSummary.fileSize` used for `usedBytes` (confirmed present in the type).

## Notes for Slice 3
- `getAllArtifacts` + real `ArtifactsView` list; `display-name` setting + Customize field; pass `displayName` into `HomeGreeting`.
