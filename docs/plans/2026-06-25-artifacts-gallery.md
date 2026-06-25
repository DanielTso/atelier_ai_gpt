# Artifacts Gallery (Claude-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Atelier Artifacts page into a Claude-style gallery — searchable, type-filterable grid of cards with rendered preview thumbnails + edited-time + source chip; cards open the existing workspace; a New-artifact action authors any of the 5 types from scratch.

**Architecture:** Pure-logic + data tasks first (filter reducer, blank templates, extended `getAllArtifacts`, `createBlankArtifact` server action), then presentational components (`ArtifactThumbnail`, `ArtifactGalleryCard`), then the `ArtifactsView` rewrite that wires search/filter/New-artifact and mounts its own `ArtifactWorkspace` overlay. No DB migration. `chat_id` stays NOT NULL — New-artifact creates a standalone host chat.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Drizzle (postgres-js), Supabase Storage, Vitest (+ PGlite, @testing-library/react jsdom), Tailwind v4.

## Global Constraints

- Server Components by default; these are client components (`'use client'`) only where they use state/effects. `ArtifactsView`, cards, thumbnail are client.
- No direct `process.env` reads outside the sanctioned paths. No Edge runtime.
- No DB migration in this plan. `artifacts.chat_id` is NOT NULL; new artifacts get a standalone host chat.
- Brand tokens only (semantic Tailwind tokens: `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`, etc.). No `bg-white/X` opacity utilities, no blue→purple gradients.
- AI SDK v6 / artifact engine reuse: `renderArtifact(type, title, content: string | SheetSpec[])`, `createArtifact({ chatId, projectId, type, title, storagePath, format?, content? })`, `artifactStoragePath(projectId, title, ext)`, `uploadBuffer(path, buffer, contentType)`, `signedArtifactUrl(path)`, `removeObjects(paths)`, `createStandaloneChat(title)`, `deleteChat(id)`.
- Verification gate before tagging: `npm run typecheck` (0 errors) · `npm run lint` (0 errors, ≤27 baseline warnings) · `npm run build` · `npm test` (all pass).
- Conventional Commits; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

```
src/lib/artifactFilter.ts            # NEW — pure filterArtifacts(list, {query,type})
src/lib/artifacts/templates.ts       # NEW — blankArtifactTemplate(type)
src/app/actions.ts                   # MODIFY — getAllArtifacts joined query; createBlankArtifact
src/types.ts                         # MODIFY — ArtifactSummary += editedAt?/chatTitle?/projectName?; ARTIFACT_TYPE_LABELS
src/components/chat/ArtifactThumbnail.tsx   # NEW — lazy, non-interactive preview by type
src/components/chat/ArtifactGalleryCard.tsx # NEW — thumbnail + metadata + download + onOpen
src/components/chat/ArtifactWorkspace.tsx   # MODIFY — optional initialMode prop
src/components/chat/ArtifactsView.tsx       # REWRITE — chrome + grid + workspace overlay + New-artifact
src/app/page.tsx                     # MODIFY — pass onOpenChat to ArtifactsView
tests/unit/lib/artifactFilter.test.ts            # NEW
tests/unit/lib/artifacts/templates.test.ts       # NEW
tests/unit/actions/blank-artifact.test.ts        # NEW
tests/unit/actions/all-artifacts.test.ts         # MODIFY — assert new fields
tests/unit/components/ArtifactGalleryCard.test.tsx # NEW (jsdom)
```

---

### Task 1: `filterArtifacts` pure reducer

**Files:**
- Create: `src/lib/artifactFilter.ts`
- Test: `tests/unit/lib/artifactFilter.test.ts`

**Interfaces:**
- Produces: `export type ArtifactTypeFilter = 'all' | 'html' | 'pdf' | 'xlsx' | 'docx' | 'pptx'`; `export function filterArtifacts<T extends { title: string; type: string; chatTitle?: string | null; projectName?: string | null }>(list: T[], opts: { query: string; type: ArtifactTypeFilter }): T[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifactFilter.test.ts
import { describe, it, expect } from 'vitest'
import { filterArtifacts } from '@/lib/artifactFilter'

const A = [
  { id: 1, title: 'Quarterly Report', type: 'pdf', chatTitle: 'Finance chat', projectName: null },
  { id: 2, title: 'Landing Page', type: 'html', chatTitle: null, projectName: 'Marketing' },
  { id: 3, title: 'Budget', type: 'xlsx', chatTitle: 'Finance chat', projectName: null },
]

describe('filterArtifacts', () => {
  it('returns all when query empty and type all', () => {
    expect(filterArtifacts(A, { query: '', type: 'all' })).toHaveLength(3)
  })
  it('filters by type', () => {
    expect(filterArtifacts(A, { query: '', type: 'html' }).map(a => a.id)).toEqual([2])
  })
  it('matches title case-insensitively', () => {
    expect(filterArtifacts(A, { query: 'budget', type: 'all' }).map(a => a.id)).toEqual([3])
  })
  it('matches source chip text (chatTitle / projectName)', () => {
    expect(filterArtifacts(A, { query: 'finance', type: 'all' }).map(a => a.id)).toEqual([1, 3])
    expect(filterArtifacts(A, { query: 'marketing', type: 'all' }).map(a => a.id)).toEqual([2])
  })
  it('combines query and type (AND)', () => {
    expect(filterArtifacts(A, { query: 'finance', type: 'xlsx' }).map(a => a.id)).toEqual([3])
  })
  it('trims whitespace-only query to no-op', () => {
    expect(filterArtifacts(A, { query: '   ', type: 'all' })).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifactFilter.test.ts`
Expected: FAIL — cannot find module `@/lib/artifactFilter`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/artifactFilter.ts
export type ArtifactTypeFilter = 'all' | 'html' | 'pdf' | 'xlsx' | 'docx' | 'pptx'

export function filterArtifacts<
  T extends { title: string; type: string; chatTitle?: string | null; projectName?: string | null },
>(list: T[], opts: { query: string; type: ArtifactTypeFilter }): T[] {
  const q = opts.query.trim().toLowerCase()
  return list.filter((a) => {
    if (opts.type !== 'all' && a.type !== opts.type) return false
    if (!q) return true
    const haystack = `${a.title} ${a.chatTitle ?? ''} ${a.projectName ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifactFilter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifactFilter.ts tests/unit/lib/artifactFilter.test.ts
git commit -m "feat(artifacts): pure filterArtifacts reducer (search + type)"
```

---

### Task 2: Blank-artifact templates

**Files:**
- Create: `src/lib/artifacts/templates.ts`
- Test: `tests/unit/lib/artifacts/templates.test.ts`

**Interfaces:**
- Consumes: `ArtifactType`, `SheetSpec` from `@/lib/artifacts/types`; `renderArtifact` from `@/lib/artifacts/render`.
- Produces: `export interface BlankTemplate { title: string; format: 'html' | 'markdown' | 'sheets'; content: string }`; `export function blankArtifactTemplate(type: ArtifactType): BlankTemplate`. Note: `content` is ALWAYS a string (JSON-stringified `SheetSpec[]` for `xlsx`). Callers that render must parse sheets content back to `SheetSpec[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/artifacts/templates.test.ts
import { describe, it, expect } from 'vitest'
import { blankArtifactTemplate } from '@/lib/artifacts/templates'
import { renderArtifact } from '@/lib/artifacts/render'
import type { ArtifactType, SheetSpec } from '@/lib/artifacts/types'

const TYPES: ArtifactType[] = ['html', 'pdf', 'docx', 'pptx', 'xlsx']

describe('blankArtifactTemplate', () => {
  it('returns a non-empty title/content for every type', () => {
    for (const t of TYPES) {
      const tpl = blankArtifactTemplate(t)
      expect(tpl.title.length).toBeGreaterThan(0)
      expect(tpl.content.length).toBeGreaterThan(0)
    }
  })

  it('xlsx content parses to a SheetSpec[] with a header row', () => {
    const tpl = blankArtifactTemplate('xlsx')
    expect(tpl.format).toBe('sheets')
    const sheets = JSON.parse(tpl.content) as SheetSpec[]
    expect(Array.isArray(sheets)).toBe(true)
    expect(sheets[0]?.rows.length).toBeGreaterThan(0)
  })

  it('each template renders to a non-empty buffer', async () => {
    for (const t of TYPES) {
      const tpl = blankArtifactTemplate(t)
      const renderContent = tpl.format === 'sheets' ? (JSON.parse(tpl.content) as SheetSpec[]) : tpl.content
      const out = await renderArtifact(t, tpl.title, renderContent)
      expect(out.ext).toBe(t)
      expect(out.buffer.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/artifacts/templates.test.ts`
Expected: FAIL — cannot find module `@/lib/artifacts/templates`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/artifacts/templates.ts
import type { ArtifactType, SheetSpec } from './types'

export interface BlankTemplate {
  title: string
  format: 'html' | 'markdown' | 'sheets'
  content: string
}

const HTML_STARTER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Untitled</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 3rem; color: #16202a; }
    h1 { font-weight: 600; }
  </style>
</head>
<body>
  <h1>Untitled</h1>
  <p>Start editing this HTML and use Preview to see it live.</p>
</body>
</html>`

const MARKDOWN_STARTER = `# Untitled\n\nStart writing your content here.`

const SHEET_STARTER: SheetSpec[] = [{ name: 'Sheet1', rows: [['Column A', 'Column B'], ['', '']] }]

export function blankArtifactTemplate(type: ArtifactType): BlankTemplate {
  switch (type) {
    case 'html':
      return { title: 'Untitled HTML artifact', format: 'html', content: HTML_STARTER }
    case 'xlsx':
      return { title: 'Untitled Spreadsheet', format: 'sheets', content: JSON.stringify(SHEET_STARTER) }
    case 'docx':
      return { title: 'Untitled Document', format: 'markdown', content: MARKDOWN_STARTER }
    case 'pdf':
      return { title: 'Untitled PDF', format: 'markdown', content: MARKDOWN_STARTER }
    case 'pptx':
      return { title: 'Untitled Slides', format: 'markdown', content: MARKDOWN_STARTER }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/artifacts/templates.test.ts`
Expected: PASS (3 tests). (`@napi-rs/canvas`/pdf rendering runs in Node; if `toPdf` is slow, the test still completes.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/templates.ts tests/unit/lib/artifacts/templates.test.ts
git commit -m "feat(artifacts): blank-artifact templates for all 5 types"
```

---

### Task 3: `createBlankArtifact` server action + extended `getAllArtifacts`

**Files:**
- Modify: `src/types.ts` (extend `ArtifactSummary`, add `ARTIFACT_TYPE_LABELS`)
- Modify: `src/app/actions.ts` (rewrite `getAllArtifacts`; add `createBlankArtifact`)
- Modify: `tests/unit/actions/all-artifacts.test.ts`
- Test: `tests/unit/actions/blank-artifact.test.ts`

**Interfaces:**
- Consumes: `blankArtifactTemplate` (Task 2); `renderArtifact`, `artifactStoragePath`, `uploadBuffer`, `removeObjects`, `createStandaloneChat`, `createArtifact`, `deleteChat`.
- Produces:
  - `ArtifactSummary` gains optional `editedAt?: Date | null`, `chatTitle?: string | null`, `projectName?: string | null`.
  - `export const ARTIFACT_TYPE_LABELS: Record<string, string>` = `{ html:'HTML', pdf:'PDF', xlsx:'Spreadsheet', docx:'Document', pptx:'Slides' }`.
  - `createBlankArtifact(type: ArtifactType): Promise<{ artifactId: number; chatId: number }>` — creates a standalone host chat titled `"Untitled <label> artifact"` (uses the template title), renders + uploads the blank file, persists the artifact (v1). Rolls back (delete chat + remove storage object) on render/upload failure. Throws if storage not configured.
  - `getAllArtifacts(limit?)` returns rows including `editedAt` (max version createdAt, fallback artifact createdAt), `chatTitle`, `projectName`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/actions/blank-artifact.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

const mockUpload = vi.fn(async () => {})
const mockRemove = vi.fn(async () => {})
vi.mock('@/lib/storage', () => ({
  isStorageConfigured: () => true,
  uploadBuffer: (...a: unknown[]) => mockUpload(...a),
  removeObjects: (...a: unknown[]) => mockRemove(...a),
  signedArtifactUrl: vi.fn(async (p: string | null) => (p ? `signed:${p}` : null)),
  ARTIFACT_URL_TTL_SECONDS: 86400,
}))

describe('createBlankArtifact', () => {
  beforeEach(async () => { await createTestDb(); mockUpload.mockClear(); mockRemove.mockClear() })

  it('creates a host chat + a ready artifact (v1) for html', async () => {
    const a = await import('@/app/actions')
    const { artifactId, chatId } = await a.createBlankArtifact('html')
    expect(chatId).toBeGreaterThan(0)
    const art = await a.getArtifactById(artifactId)
    expect(art?.status).toBe('ready')
    expect(art?.type).toBe('html')
    expect(art?.currentVersion).toBe(1)
    expect(art?.chatId).toBe(chatId)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    // The host chat exists and is standalone.
    const standalone = await a.getStandaloneChats()
    expect(standalone.some(c => c.id === chatId)).toBe(true)
  })

  it('surfaces it in getAllArtifacts with editedAt + chatTitle', async () => {
    const a = await import('@/app/actions')
    const { artifactId } = await a.createBlankArtifact('docx')
    const all = await a.getAllArtifacts()
    const row = all.find(r => r.id === artifactId)
    expect(row).toBeTruthy()
    expect(row!.chatTitle).toContain('Untitled')
    expect(row!.editedAt).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/actions/blank-artifact.test.ts`
Expected: FAIL — `createBlankArtifact` is not exported.

- [ ] **Step 3: Implement**

In `src/types.ts`, extend the interface and add the labels:

```ts
export interface ArtifactSummary {
  id: number
  chatId: number
  type: string
  title: string
  status: string
  downloadUrl: string | null
  createdAt: Date | null
  format?: string | null
  content?: string | null
  version?: number
  // Gallery-only metadata (populated by getAllArtifacts; absent on per-chat lists).
  editedAt?: Date | null
  chatTitle?: string | null
  projectName?: string | null
}

export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  html: 'HTML', pdf: 'PDF', xlsx: 'Spreadsheet', docx: 'Document', pptx: 'Slides',
}
```

In `src/app/actions.ts`, add imports near the existing artifact imports (top of file already imports `chats`, `projects`, `artifacts`, `artifactVersions`, `createSignedDownloadUrl`, etc.; add what's missing):

```ts
import { blankArtifactTemplate } from '@/lib/artifacts/templates'
import { renderArtifact } from '@/lib/artifacts/render'
import { artifactStoragePath } from '@/lib/artifacts/path'
import type { ArtifactType, SheetSpec } from '@/lib/artifacts/types'
// storage helpers (uploadBuffer, removeObjects, signedArtifactUrl, isStorageConfigured) are already imported.
```

Replace `getAllArtifacts` with a joined query and add `createBlankArtifact` (place both in the `// ── Artifact Actions ──` section):

```ts
// Bounded gallery list: recent artifacts + source metadata (chat title, project name)
// and an "edited" timestamp = the latest version's created_at (fallback: the artifact's).
export async function getAllArtifacts(limit = 60) {
  const rows = await db
    .select({
      id: artifacts.id, chatId: artifacts.chatId, type: artifacts.type, title: artifacts.title,
      status: artifacts.status, createdAt: artifacts.createdAt, format: artifacts.format,
      content: artifacts.content, version: artifacts.currentVersion, storagePath: artifacts.storagePath,
      chatTitle: chats.title, projectName: projects.name,
      editedAt: sql<Date>`max(${artifactVersions.createdAt})`,
    })
    .from(artifacts)
    .leftJoin(chats, eq(artifacts.chatId, chats.id))
    .leftJoin(projects, eq(artifacts.projectId, projects.id))
    .leftJoin(artifactVersions, eq(artifactVersions.artifactId, artifacts.id))
    .groupBy(artifacts.id, chats.title, projects.name)
    .orderBy(desc(artifacts.createdAt))
    .limit(limit)

  return await Promise.all(rows.map(async (r) => ({
    id: r.id, chatId: r.chatId, type: r.type, title: r.title, status: r.status,
    createdAt: r.createdAt, format: r.format, content: r.content, version: r.version,
    chatTitle: r.chatTitle, projectName: r.projectName,
    editedAt: r.editedAt ?? r.createdAt,
    downloadUrl: await signedArtifactUrl(r.storagePath),
  })))
}

// New-artifact authoring: create a standalone host chat (chat_id is NOT NULL) + a blank
// template artifact (v1), opened in the workspace editor by the client.
export async function createBlankArtifact(type: ArtifactType): Promise<{ artifactId: number; chatId: number }> {
  if (!isStorageConfigured()) throw new Error('File storage is not configured.')
  const tpl = blankArtifactTemplate(type)
  const renderContent: string | SheetSpec[] =
    tpl.format === 'sheets' ? (JSON.parse(tpl.content) as SheetSpec[]) : tpl.content

  const [chat] = await createStandaloneChat(tpl.title)
  if (!chat) throw new Error('Failed to create host chat')

  let path: string | null = null
  try {
    const { buffer, contentType, ext } = await renderArtifact(type, tpl.title, renderContent)
    path = artifactStoragePath(null, tpl.title, ext)
    await uploadBuffer(path, buffer, contentType)
    const [art] = await createArtifact({
      chatId: chat.id, projectId: null, type, title: tpl.title,
      storagePath: path, status: 'ready', format: tpl.format, content: tpl.content,
    })
    if (!art) throw new Error('Failed to persist artifact')
    return { artifactId: art.id, chatId: chat.id }
  } catch (e) {
    // Roll back so a failed create leaves no orphan host chat or storage object.
    if (path) await removeObjects([path]).catch(() => {})
    await deleteChat(chat.id).catch(() => {})
    throw e
  }
}
```

Update `tests/unit/actions/all-artifacts.test.ts` — after creating artifacts, assert the new fields exist. Add inside the existing `it('returns all artifacts newest-first with signed urls', …)` (or a new `it`):

```ts
    const rows = await getAllArtifacts()
    expect(rows[0]).toHaveProperty('editedAt')
    expect(rows[0]).toHaveProperty('chatTitle')
    expect(rows[0]).toHaveProperty('projectName')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/actions/blank-artifact.test.ts tests/unit/actions/all-artifacts.test.ts`
Expected: PASS. If `groupBy`/`max()` errors under PGlite, confirm `artifactVersions` is imported in `actions.ts` and that `sql` is imported.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/app/actions.ts tests/unit/actions/blank-artifact.test.ts tests/unit/actions/all-artifacts.test.ts
git commit -m "feat(artifacts): createBlankArtifact + gallery metadata in getAllArtifacts"
```

---

### Task 4: `ArtifactWorkspace` — optional `initialMode`

**Files:**
- Modify: `src/components/chat/ArtifactWorkspace.tsx`

**Interfaces:**
- Produces: `ArtifactWorkspace` accepts optional `initialMode?: 'preview' | 'edit' | 'versions'` (default `'preview'`). On artifact-id change it resets to `initialMode`.

- [ ] **Step 1: Modify the component signature + reset effect**

Change the props destructure (around line 15) to include `initialMode`:

```tsx
export function ArtifactWorkspace({ artifact, onClose, onChanged, width = 448, onWidthChange, initialMode = 'preview' }: {
  artifact: ArtifactSummary
  onClose: () => void
  onChanged: () => void
  width?: number
  onWidthChange?: (w: number) => void
  initialMode?: Mode
}) {
```

Change the mode state init (line 43) and the reset effect (line 51):

```tsx
  const [mode, setMode] = useState<Mode>(initialMode)
  // ...
  useEffect(() => { setEditText(artifact.content ?? ''); setMode(initialMode) }, [artifact.id, artifact.content, initialMode])
```

- [ ] **Step 2: Verify existing tests still pass + typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/ -t artifact`
Expected: typecheck 0 errors; existing artifact tests PASS (default mode unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ArtifactWorkspace.tsx
git commit -m "feat(artifacts): ArtifactWorkspace initialMode prop"
```

---

### Task 5: `ArtifactThumbnail` — lazy, non-interactive preview by type

**Files:**
- Create: `src/components/chat/ArtifactThumbnail.tsx`

**Interfaces:**
- Consumes: `ArtifactSummary`; `SheetSpec`.
- Produces: `export function ArtifactThumbnail({ artifact }: { artifact: ArtifactSummary }): JSX.Element` — renders a clipped, non-interactive preview. Lazy-mounts the heavy preview only when scrolled near the viewport (IntersectionObserver); before that (and as the universal fallback) shows a branded type tile.

- [ ] **Step 1: Implement**

```tsx
// src/components/chat/ArtifactThumbnail.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, FileType, FileText, Presentation, Code } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import type { SheetSpec } from '@/lib/artifacts/types'

const ICON: Record<string, LucideIcon> = { xlsx: FileSpreadsheet, docx: FileType, pdf: FileText, pptx: Presentation, html: Code }

function TypeTile({ type }: { type: string }) {
  const Icon = ICON[type] ?? FileText
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <Icon className="h-10 w-10 text-muted-foreground/50" />
    </div>
  )
}

function SheetsMini({ content }: { content: string | null | undefined }) {
  let sheet: SheetSpec | undefined
  try { sheet = (JSON.parse(content ?? '[]') as SheetSpec[])[0] } catch { sheet = undefined }
  if (!sheet?.rows?.length) return <TypeTile type="xlsx" />
  return (
    <div className="h-full w-full overflow-hidden bg-card p-2">
      <table className="w-full border-collapse text-[7px] leading-tight text-foreground">
        <tbody>
          {sheet.rows.slice(0, 8).map((row, i) => (
            <tr key={i}>
              {row.slice(0, 6).map((cell, j) => (
                <td key={j} className="truncate border border-border/50 px-1 py-0.5">{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ArtifactThumbnail({ artifact }: { artifact: ArtifactSummary }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  return (
    <div ref={ref} className="relative aspect-[16/10] w-full overflow-hidden rounded-t-xl border-b border-border bg-muted">
      {!visible ? (
        <TypeTile type={artifact.type} />
      ) : artifact.type === 'html' && artifact.content ? (
        // Non-interactive scaled live render. No allow-same-origin → cannot reach app session.
        <iframe
          srcDoc={artifact.content}
          title={artifact.title}
          sandbox="allow-scripts"
          aria-hidden
          className="pointer-events-none h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
        />
      ) : artifact.type === 'pdf' && artifact.downloadUrl ? (
        <iframe
          src={`${artifact.downloadUrl}#toolbar=0&navpanes=0`}
          title={artifact.title}
          aria-hidden
          className="pointer-events-none h-full w-full border-0"
        />
      ) : artifact.type === 'xlsx' ? (
        <SheetsMini content={artifact.content} />
      ) : (artifact.type === 'docx' || artifact.type === 'pptx') && artifact.content ? (
        <div className="h-full w-full overflow-hidden bg-card p-3 text-[8px] leading-snug text-muted-foreground">
          {artifact.content.replace(/[#*_>`]/g, '').slice(0, 320)}
        </div>
      ) : (
        <TypeTile type={artifact.type} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ArtifactThumbnail.tsx
git commit -m "feat(artifacts): lazy non-interactive ArtifactThumbnail by type"
```

---

### Task 6: `ArtifactGalleryCard`

**Files:**
- Create: `src/components/chat/ArtifactGalleryCard.tsx`
- Test: `tests/unit/components/ArtifactGalleryCard.test.tsx`

**Interfaces:**
- Consumes: `ArtifactSummary`, `ARTIFACT_TYPE_LABELS`, `ArtifactThumbnail`.
- Produces: `export function ArtifactGalleryCard({ artifact, onOpen, onOpenChat }: { artifact: ArtifactSummary; onOpen: (id: number) => void; onOpenChat?: (chatId: number) => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ArtifactGalleryCard.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArtifactGalleryCard } from '@/components/chat/ArtifactGalleryCard'
import type { ArtifactSummary } from '@/types'

const art: ArtifactSummary = {
  id: 7, chatId: 3, type: 'pdf', title: 'Quarterly Report', status: 'ready',
  downloadUrl: 'https://signed/x.pdf', createdAt: new Date(), editedAt: new Date(),
  chatTitle: 'Finance chat', projectName: null, format: 'markdown', content: '# Q', version: 2,
}

describe('ArtifactGalleryCard', () => {
  it('shows title, type label and source chip', () => {
    render(<ArtifactGalleryCard artifact={art} onOpen={() => {}} />)
    expect(screen.getByText('Quarterly Report')).toBeTruthy()
    expect(screen.getByText('PDF')).toBeTruthy()
    expect(screen.getByText('Finance chat')).toBeTruthy()
  })

  it('calls onOpen when the card body is clicked', () => {
    const onOpen = vi.fn()
    render(<ArtifactGalleryCard artifact={art} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Quarterly Report'))
    expect(onOpen).toHaveBeenCalledWith(7)
  })

  it('source chip click opens the chat and does not open the artifact', () => {
    const onOpen = vi.fn(); const onOpenChat = vi.fn()
    render(<ArtifactGalleryCard artifact={art} onOpen={onOpen} onOpenChat={onOpenChat} />)
    fireEvent.click(screen.getByText('Finance chat'))
    expect(onOpenChat).toHaveBeenCalledWith(3)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/ArtifactGalleryCard.test.tsx`
Expected: FAIL — cannot find module `@/components/chat/ArtifactGalleryCard`.

- [ ] **Step 3: Implement**

```tsx
// src/components/chat/ArtifactGalleryCard.tsx
'use client'
import { memo } from 'react'
import { Download, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArtifactSummary } from '@/types'
import { ARTIFACT_TYPE_LABELS } from '@/types'
import { ArtifactThumbnail } from './ArtifactThumbnail'

function relativeTime(d: Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  const units: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [s, label] of units) {
    const v = Math.floor(secs / s)
    if (v >= 1) return `${v} ${label}${v > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

export const ArtifactGalleryCard = memo(function ArtifactGalleryCard({ artifact, onOpen, onOpenChat }: {
  artifact: ArtifactSummary
  onOpen: (id: number) => void
  onOpenChat?: (chatId: number) => void
}) {
  const label = ARTIFACT_TYPE_LABELS[artifact.type] ?? artifact.type.toUpperCase()
  const source = artifact.projectName ?? artifact.chatTitle ?? 'Chat'
  return (
    <div
      onClick={() => onOpen(artifact.id)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/30"
    >
      <ArtifactThumbnail artifact={artifact} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{artifact.title}</p>
        <div className="mt-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">{label}</span>
          <span aria-hidden>·</span>
          <span>Edited {relativeTime(artifact.editedAt ?? artifact.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenChat?.(artifact.chatId) }}
            className="inline-flex max-w-[70%] items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate">{source}</span>
          </button>
          {artifact.downloadUrl && (
            <a
              href={artifact.downloadUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] opacity-0 transition-opacity',
                'bg-primary text-primary-foreground hover:opacity-90 group-hover:opacity-100')}
            >
              <Download className="h-3 w-3" /> Download
            </a>
          )}
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/ArtifactGalleryCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ArtifactGalleryCard.tsx tests/unit/components/ArtifactGalleryCard.test.tsx
git commit -m "feat(artifacts): ArtifactGalleryCard with thumbnail + source chip + download"
```

---

### Task 7: `ArtifactsView` rewrite — chrome, grid, New-artifact, workspace overlay

**Files:**
- Modify: `src/components/chat/ArtifactsView.tsx`
- Modify: `src/app/page.tsx` (pass `onOpenChat`)

**Interfaces:**
- Consumes: `getAllArtifacts`, `createBlankArtifact`, `filterArtifacts`, `ArtifactTypeFilter`, `ArtifactGalleryCard`, `ArtifactWorkspace`, `ARTIFACT_TYPE_LABELS`, `useLocalStorage`.
- Produces: `export function ArtifactsView({ onOpenChat }: { onOpenChat?: (chatId: number) => void }): JSX.Element`.

- [ ] **Step 1: Implement the rewrite**

```tsx
// src/components/chat/ArtifactsView.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Search, ChevronDown, Plus } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import { ARTIFACT_TYPE_LABELS } from '@/types'
import type { ArtifactType } from '@/lib/artifacts/types'
import { getAllArtifacts, createBlankArtifact } from '@/app/actions'
import { filterArtifacts, type ArtifactTypeFilter } from '@/lib/artifactFilter'
import { ArtifactGalleryCard } from '@/components/chat/ArtifactGalleryCard'
import { ArtifactWorkspace } from '@/components/chat/ArtifactWorkspace'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const FILTERS: { value: ArtifactTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'html', label: 'HTML' }, { value: 'pdf', label: 'PDF' },
  { value: 'xlsx', label: 'Spreadsheet' }, { value: 'docx', label: 'Document' }, { value: 'pptx', label: 'Slides' },
]
const NEW_TYPES: ArtifactType[] = ['html', 'docx', 'pdf', 'pptx', 'xlsx']

export function ArtifactsView({ onOpenChat }: { onOpenChat?: (chatId: number) => void }) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [openInEdit, setOpenInEdit] = useState(false)
  const [panelWidth, setPanelWidth] = useLocalStorage('artifact-panel-width', 448)

  const reload = () => getAllArtifacts().then(setArtifacts).catch(() => setArtifacts([]))
  useEffect(() => { reload() }, [])

  const visible = useMemo(() => filterArtifacts(artifacts ?? [], { query, type: typeFilter }), [artifacts, query, typeFilter])
  const active = artifacts?.find(a => a.id === activeId) ?? null

  async function handleNew(type: ArtifactType) {
    setNewOpen(false); setCreating(true)
    try {
      const { artifactId } = await createBlankArtifact(type)
      await reload()
      setOpenInEdit(true); setActiveId(artifactId)
    } catch {
      toast.error('Could not create artifact. Is file storage configured?')
    } finally { setCreating(false) }
  }

  if (artifacts === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold text-foreground">Artifacts</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setFilterOpen(o => !o)} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent">
                Filter by {FILTERS.find(f => f.value === typeFilter)!.label} <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {filterOpen && (
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg" onMouseLeave={() => setFilterOpen(false)}>
                  {FILTERS.map(f => (
                    <button key={f.value} onClick={() => { setTypeFilter(f.value); setFilterOpen(false) }}
                      className={cn('block w-full px-3 py-1.5 text-left text-sm hover:bg-accent', typeFilter === f.value ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button disabled={creating} onClick={() => setNewOpen(o => !o)} className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-60">
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} New artifact <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {newOpen && (
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-card py-1 shadow-lg" onMouseLeave={() => setNewOpen(false)}>
                  {NEW_TYPES.map(t => (
                    <button key={t} onClick={() => handleNew(t)} className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent">
                      {ARTIFACT_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search artifacts..."
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Boxes className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {artifacts.length === 0 ? 'No artifacts yet. Generated files will appear here.' : 'No artifacts match your search.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map(a => (
              <ArtifactGalleryCard key={a.id} artifact={a}
                onOpen={(id) => { setOpenInEdit(false); setActiveId(id) }}
                onOpenChat={onOpenChat} />
            ))}
          </div>
        )}
      </div>

      {active && (
        <ArtifactWorkspace
          artifact={active}
          width={panelWidth}
          onWidthChange={setPanelWidth}
          initialMode={openInEdit ? 'edit' : 'preview'}
          onClose={() => setActiveId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
```

In `src/app/page.tsx`, pass the chat-open handler (the `'artifacts'` branch at ~line 1018):

```tsx
        ) : activeView === 'artifacts' ? (
          <ArtifactsView onOpenChat={(chatId) => { setActiveView('home'); setActiveChatId(chatId) }} />
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: typecheck 0 errors; lint 0 errors (≤27 warnings); build succeeds.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all pass (existing + new from Tasks 1–6).

- [ ] **Step 4: Manual smoke (`npm run dev`)**

- Open the Artifacts page → cards show thumbnails (HTML live mini-render, PDF first page, sheets table, doc/slides text, else type tile).
- Type in search → grid narrows by title/source; pick a filter → narrows by type.
- Click a card → workspace opens (Preview/Edit/Versions/Download).
- Click a source chip → navigates to that chat.
- New artifact → pick each type → a blank artifact opens in the workspace **Edit** tab, is editable, and downloads. Verify the host chat appears in Recents named "Untitled …".

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ArtifactsView.tsx src/app/page.tsx
git commit -m "feat(artifacts): Claude-style gallery (search, filter, New artifact, workspace overlay)"
```

---

### Task 8: Docs + changelog + version + tag

**Files:**
- Modify: `CHANGELOG.md`, `package.json` (version), `docs/SESSION_HANDOFF_2026-06-24.md` (or a new dated handoff)

- [ ] **Step 1: Bump `package.json` version** to the next minor (e.g. `4.29.0`).

- [ ] **Step 2: Prepend a CHANGELOG entry** summarizing the gallery (thumbnails, search, type filter, source chip + edited time, New-artifact via standalone host chat; no migration; dropped publish/view-count). Note the gate result.

- [ ] **Step 3: Run the full gate once more**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: all green.

- [ ] **Step 4: Commit + annotated tag**

```bash
git add CHANGELOG.md package.json docs/
git commit -m "feat(artifacts): Claude-style artifacts gallery (vX.Y.0)"
git tag -a vX.Y.0 -m "vX.Y.0 — Claude-style artifacts gallery"
```

(Push/deploy is a separate, user-gated step.)

---

## Self-Review

**Spec coverage:**
- Page chrome (title/filter/New-artifact/search/grid) → Task 7. ✓
- Preview thumbnails (lazy, by type) → Task 5. ✓
- Search + type filter → Task 1 (logic) + Task 7 (UI). ✓
- Source chip + edited time → Task 3 (data) + Task 6 (card). ✓
- Open into workspace → Task 4 (initialMode) + Task 7 (overlay mount). ✓
- New artifact (5 types, scratch chat) → Task 2 (templates) + Task 3 (action) + Task 7 (dropdown). ✓
- Data extension (editedAt/chatTitle/projectName, no migration) → Task 3. ✓
- Dropped publish/view-count → not implemented (correct). ✓
- Perf (lazy iframes, limit 60) → Task 5 + Task 3. ✓
- Testing (filter, templates, blank-artifact, all-artifacts, card) → Tasks 1,2,3,6. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The only deferred verification is the xlsx edit-save path (existing behavior, not in scope) — flagged in the smoke test.

**Type consistency:** `ArtifactTypeFilter` (Task 1) reused in Task 7. `BlankTemplate.content` is always a string; `createBlankArtifact` parses sheets JSON before `renderArtifact` (Task 3) — matches Task 2's note. `ArtifactSummary` optional fields (Task 3) consumed by Tasks 6/7. `initialMode: Mode` (Task 4) consumed by Task 7. `createBlankArtifact(type): {artifactId, chatId}` (Task 3) consumed by Task 7. Consistent.

## Risks
- **Many live iframes:** mitigated by IntersectionObserver lazy-mount (Task 5) + 60-row cap.
- **`groupBy` + `max()` under PGlite/Postgres:** Postgres allows non-grouped artifact columns via PK functional dependency; `chats.title`/`projects.name` are explicitly in `groupBy`. Verified by Task 3 tests.
- **xlsx edit-save** through the existing edit route may mishandle sheets JSON (pre-existing). Creation renders correctly; flagged in smoke. If broken, fix is a separate ticket.
- **Opening workspace in a non-chat view:** `ArtifactWorkspace` is context-independent (loads versions by id); confirmed from its source.
