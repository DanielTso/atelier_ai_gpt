# Phase C3 — Documents UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Frame implementers by role (Database / Backend / Frontend / Docs).

**Goal:** Surface C-storage's per-document thumbnail, original, status, and extraction method in the UI — thumbnail-card grids on both document surfaces, a tabbed preview (original + extracted text), a shared upload hook that also fixes a broken uploader, and a `documents.extraction_method` badge.

**Architecture:** A shared `DocumentSummary` type + `DocumentCard` component + `useDocumentUpload` hook remove three duplicated `Document` interfaces and two divergent upload paths. A small backend slice adds + populates `documents.extraction_method`. The preview dialog gains lightweight (no-new-dep) tabs.

**Tech Stack:** Next.js 16, React 19, Drizzle (postgres-js), `@supabase/supabase-js` (already wired), Vitest + `@testing-library/react` (jsdom), Tailwind v4.

**Spec:** `docs/specs/2026-06-17-phase-c3-documents-ui-design.md`. Final sub-phase of Phase C. Live Supabase is configured (`.env.local`), so the manual smoke runs against the real project.

**Facts (don't re-derive):**
- `GET /api/documents` already returns each row spread + signed `url` + `thumbnailUrl`. Once `extraction_method` exists on the row it flows through automatically.
- The 3-step upload already works inside `ProjectDocumentsDialog` (the reference implementation). `ProjectLandingPage.handleUpload` is BROKEN — it POSTs to the retired inline `/api/documents`.
- Hook/component tests use jsdom via a `// @vitest-environment jsdom` first line + `@testing-library/react`.
- No `@radix-ui/react-tabs` dependency — implement tabs with `useState` + buttons (no new dep).
- Latest migration is `drizzle/0003_*`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` + `drizzle/0004_*` | `documents.extraction_method` column |
| `src/app/actions.ts` | `updateDocumentStatus` updates accept `extractionMethod` |
| `src/app/api/documents/process/route.ts` | compute + persist `extractionMethod` |
| `src/types.ts` | shared `DocumentStatus` + `DocumentSummary` |
| `src/hooks/useDocumentUpload.ts` (new) | the 3-step upload flow, shared |
| `src/components/chat/DocumentCard.tsx` (new) | thumbnail card (status + method + delete) |
| `src/components/ui/ProjectDocumentsDialog.tsx` | use hook + `DocumentCard` grid |
| `src/components/chat/ProjectLandingPage.tsx` | use hook (fix) + `DocumentCard` grid |
| `src/components/ui/DocumentPreviewDialog.tsx` | tabbed Preview + Extracted text |
| Tests | hook, `DocumentCard`, preview tabs, `/process` method |

---

## Task 1: extraction_method column (Database)

**Files:** `src/db/schema.ts`, `drizzle/`

- [ ] **Step 1:** In `src/db/schema.ts`, in the `documents` table, add after `thumbnailPath: text('thumbnail_path'),`:
```ts
  extractionMethod: text('extraction_method'),
```
- [ ] **Step 2:** Generate: `npx drizzle-kit generate` (offline — diffs schema, no DB connection). Expect `drizzle/0004_*.sql` with exactly `ALTER TABLE "documents" ADD COLUMN "extraction_method" text;`. Verify it contains ONLY that. If it shows other changes, STOP and report drift.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Apply to live Supabase (DB is configured): `npx drizzle-kit migrate` (drizzle.config reads `DIRECT_URL` from env — it's in `.env.local`; if the tool doesn't auto-load it, prefix the command by exporting `DIRECT_URL` to the session-pooler value already in `.env.local`). Expect "migrations applied successfully". If the direct host fails to resolve, use the **session pooler** URL (`...pooler.supabase.com:5432`) — see `.env.local`'s `DIRECT_URL`.
- [ ] **Step 5:** Commit:
```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(phase-c3): documents.extraction_method column"
```
(append trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: Populate extraction_method in /process (Backend, TDD)

**Files:** `src/app/actions.ts`, `src/app/api/documents/process/route.ts`, `tests/unit/api/documents-process.test.ts`

- [ ] **Step 1:** Widen `updateDocumentStatus` in `src/app/actions.ts` — add `extractionMethod` to the updates object type:
```ts
export async function updateDocumentStatus(
  id: number,
  status: 'uploading' | 'processing' | 'ready' | 'error',
  updates?: { chunkCount?: number; errorMessage?: string; charCount?: number; thumbnailPath?: string; extractionMethod?: 'text' | 'vision' }
) {
  return await db.update(documents)
    .set({ status, ...updates })
    .where(eq(documents.id, id))
    .returning()
}
```

- [ ] **Step 2: Add failing assertions** to `tests/unit/api/documents-process.test.ts`. In the existing "text PDF" test add:
```ts
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ extractionMethod: 'text' }))
```
In the "image upload" test (id 9) add an assertion that final status call includes `extractionMethod: 'vision'`:
```ts
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(9, 'ready', expect.objectContaining({ extractionMethod: 'vision' }))
```
Add a new test for the thin-PDF→vision win (vision result used → method vision):
```ts
  it('thin-text PDF that falls back to vision records extractionMethod vision', async () => {
    m.getDocumentById.mockResolvedValue({ id: 14, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('')
    m.extractViaVision.mockResolvedValue('V'.repeat(300))
    const POST = await importRoute()
    await POST(req(14) as never)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(14, 'ready', expect.objectContaining({ extractionMethod: 'vision' }))
  })
```

- [ ] **Step 3: Run — expect FAIL** (`npx vitest run tests/unit/api/documents-process.test.ts`).

- [ ] **Step 4: Implement** in `src/app/api/documents/process/route.ts`. Track the method. Change the extraction block so it records which path won, and pass it to the final status update. Replace the extraction `try { ... }` block's body and the final `updateDocumentStatus` as follows:

In the extraction block, introduce `let extractionMethod: 'text' | 'vision' = 'text'` before the `try`, and set it:
```ts
    let textContent = ''
    let extractionMethod: 'text' | 'vision' = 'text'
    try {
      if (isImage) {
        textContent = await extractViaVisionImage(buffer, doc.mimeType)
        extractionMethod = 'vision'
      } else {
        textContent = await extractTextFromBuffer(buffer, ext)
        if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
          const vision = await extractViaVision(buffer)
          if (vision.trim().length > textContent.trim().length) {
            textContent = vision
            extractionMethod = 'vision'
          }
        }
      }
    } catch (e) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Failed to extract document content.' })
      return apiError(e, 'Failed to extract document content', 500, false)
    }
```
Then in the final status update (the `status === 'ready'|'error'` line near the end), add `extractionMethod`:
```ts
    await updateDocumentStatus(doc.id, status, { chunkCount: saved.length, charCount: textContent.length, thumbnailPath, extractionMethod })
```

- [ ] **Step 5: Run — expect PASS.** Run full api suite `npx vitest run tests/unit/api/` + `npx tsc --noEmit` (clean).
- [ ] **Step 6: Commit:** `git add src/app/actions.ts src/app/api/documents/process/route.ts tests/unit/api/documents-process.test.ts && git commit -m "feat(phase-c3): record extraction method (text/vision) in process"` (+ trailer)

---

## Task 3: Shared DocumentSummary type (Architect)

**Files:** `src/types.ts`

- [ ] **Step 1:** Append to `src/types.ts`:
```ts
export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'error'

/** A document as returned by GET /api/documents (row + signed URLs), as the UI consumes it. */
export interface DocumentSummary {
  id: number
  filename: string
  mimeType: string
  fileSize: number
  chunkCount: number | null
  status: DocumentStatus
  errorMessage: string | null
  url: string | null
  thumbnailUrl: string | null
  extractionMethod: 'text' | 'vision' | null
}
```
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit: `git add src/types.ts && git commit -m "feat(phase-c3): shared DocumentSummary type"` (+ trailer)

---

## Task 4: useDocumentUpload hook (Frontend, TDD)

**Files:** Create `src/hooks/useDocumentUpload.ts`, `tests/hooks/useDocumentUpload.test.tsx`

- [ ] **Step 1: Write the failing test** `tests/hooks/useDocumentUpload.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockUploadToSignedUrl = vi.fn()
vi.mock('@/lib/storageClient', () => ({
  getBrowserSupabase: () => ({ storage: { from: () => ({ uploadToSignedUrl: mockUploadToSignedUrl }) } }),
}))

describe('useDocumentUpload', () => {
  beforeEach(() => {
    mockUploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('upload-url')) return new Response(JSON.stringify({ documentId: 5, path: 'documents/1/5/a.txt', token: 'tok', bucket: 'atelier-files' }), { status: 200 })
      if (url.includes('process')) return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      return new Response('{}', { status: 200 })
    }))
  })

  it('runs the 3-step flow and toggles uploading', async () => {
    const { useDocumentUpload } = await import('@/hooks/useDocumentUpload')
    const { result } = renderHook(() => useDocumentUpload())
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
    await act(async () => { await result.current.upload(file, 1) })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('upload-url'))).toBe(true)
    expect(mockUploadToSignedUrl).toHaveBeenCalledWith('documents/1/5/a.txt', 'tok', file)
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('process'))).toBe(true)
    expect(result.current.uploading).toBe(false)
  })

  it('throws and resets uploading when the signed upload fails', async () => {
    mockUploadToSignedUrl.mockResolvedValue({ error: new Error('storage boom') })
    const { useDocumentUpload } = await import('@/hooks/useDocumentUpload')
    const { result } = renderHook(() => useDocumentUpload())
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
    await expect(act(async () => { await result.current.upload(file, 1) })).rejects.toThrow('storage boom')
    expect(result.current.uploading).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `src/hooks/useDocumentUpload.ts`:
```ts
'use client'
import { useState, useCallback } from 'react'

/** Shared 3-step direct-to-Storage upload: mint signed URL → PUT to Storage → process. */
export function useDocumentUpload() {
  const [uploading, setUploading] = useState(false)

  const upload = useCallback(async (file: File, projectId: number) => {
    setUploading(true)
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
      })
      if (!urlRes.ok) throw new Error((await urlRes.json()).error || 'Upload failed')
      const { documentId, path, token, bucket } = await urlRes.json()

      const { getBrowserSupabase } = await import('@/lib/storageClient')
      const { error: upErr } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr

      const procRes = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (!procRes.ok) throw new Error((await procRes.json()).error || 'Processing failed')
    } finally {
      setUploading(false)
    }
  }, [])

  return { upload, uploading }
}
```

- [ ] **Step 4: Run — expect PASS (2/2).** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit:** `git add src/hooks/useDocumentUpload.ts tests/hooks/useDocumentUpload.test.tsx && git commit -m "feat(phase-c3): shared useDocumentUpload hook (3-step flow)"` (+ trailer)

---

## Task 5: DocumentCard component (Frontend, TDD)

**Files:** Create `src/components/chat/DocumentCard.tsx`, `tests/hooks/DocumentCard.test.tsx`

> Test lives under `tests/hooks/` to reuse the jsdom convention (the repo groups component/jsdom tests there).

- [ ] **Step 1: Write the failing test** `tests/hooks/DocumentCard.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentCard } from '@/components/chat/DocumentCard'
import type { DocumentSummary } from '@/types'

const base: DocumentSummary = {
  id: 1, filename: 'GradingPlan.pdf', mimeType: 'application/pdf', fileSize: 1000,
  chunkCount: 42, status: 'ready', errorMessage: null,
  url: 'signed:orig', thumbnailUrl: 'signed:thumb', extractionMethod: 'vision',
}

describe('DocumentCard', () => {
  it('renders the thumbnail image when thumbnailUrl is present', () => {
    render(<DocumentCard doc={base} onOpen={() => {}} onDelete={() => {}} />)
    const img = screen.getByRole('img', { name: /GradingPlan\.pdf/i }) as HTMLImageElement
    expect(img.src).toContain('signed:thumb')
  })

  it('shows the vision method chip and chunk count when ready', () => {
    render(<DocumentCard doc={base} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.getByText(/vision/i)).toBeTruthy()
    expect(screen.getByText(/42 chunks/i)).toBeTruthy()
  })

  it('falls back to a file-type tile when no thumbnail', () => {
    render(<DocumentCard doc={{ ...base, thumbnailUrl: null }} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('PDF')).toBeTruthy()
  })

  it('shows an uploading indicator for uploading status', () => {
    render(<DocumentCard doc={{ ...base, status: 'uploading', thumbnailUrl: null }} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.getByText(/uploading/i)).toBeTruthy()
  })

  it('calls onOpen when the card is clicked', () => {
    const onOpen = vi.fn()
    render(<DocumentCard doc={base} onOpen={onOpen} onDelete={() => {}} />)
    fireEvent.click(screen.getByText('GradingPlan.pdf'))
    expect(onOpen).toHaveBeenCalledWith(base)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `src/components/chat/DocumentCard.tsx`:
```tsx
'use client'
import { memo } from 'react'
import { Loader2, CheckCircle2, AlertCircle, Trash2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize, getFileTypeBadge } from '@/lib/fileUtils'
import type { DocumentSummary } from '@/types'

interface DocumentCardProps {
  doc: DocumentSummary
  onOpen: (doc: DocumentSummary) => void
  onDelete: (doc: DocumentSummary) => void
}

export const DocumentCard = memo(function DocumentCard({ doc, onOpen, onDelete }: DocumentCardProps) {
  const badge = getFileTypeBadge(doc.mimeType, doc.filename)
  return (
    <div
      onClick={() => onOpen(doc)}
      className="group relative text-left rounded-xl border border-border/30 overflow-hidden hover:bg-muted/30 hover:border-border/50 transition-colors cursor-pointer"
    >
      {/* Thumbnail or file-type tile */}
      <div className="h-24 bg-muted/40 flex items-center justify-center overflow-hidden">
        {doc.thumbnailUrl ? (
          <img src={doc.thumbnailUrl} alt={doc.filename} className="h-full w-full object-cover" />
        ) : (
          <span className={cn('text-xs font-semibold px-2 py-1 rounded-full', badge.className)}>{badge.label}</span>
        )}
      </div>

      {/* Body */}
      <div className="p-2.5">
        <p className="text-sm text-foreground truncate leading-tight">{doc.filename}</p>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
          {doc.status === 'uploading' && (
            <span className="flex items-center gap-1 text-amber-400"><Loader2 className="h-2.5 w-2.5 animate-spin" />Uploading</span>
          )}
          {doc.status === 'processing' && (
            <span className="flex items-center gap-1 text-amber-400"><Loader2 className="h-2.5 w-2.5 animate-spin" />Indexing</span>
          )}
          {doc.status === 'ready' && (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-400" />
              {doc.chunkCount != null && <span>{doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''}</span>}
            </>
          )}
          {doc.status === 'error' && (
            <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" />{doc.errorMessage || 'Failed'}</span>
          )}
          {doc.extractionMethod === 'vision' && (
            <span className="flex items-center gap-0.5 text-[10px] text-steel-blue"><Sparkles className="h-2.5 w-2.5" />vision</span>
          )}
          <span className="ml-auto">{formatFileSize(doc.fileSize)}</span>
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(doc) }}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-background/70 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete document"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
```
> Note: `text-steel-blue` is an existing brand utility (see `globals.css`). If tsc/lint flags it, use `text-primary` instead.

- [ ] **Step 4: Run — expect PASS (5/5).** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit:** `git add src/components/chat/DocumentCard.tsx tests/hooks/DocumentCard.test.tsx && git commit -m "feat(phase-c3): shared DocumentCard (thumbnail card)"` (+ trailer)

---

## Task 6: ProjectDocumentsDialog → hook + card grid (Frontend)

**Files:** `src/components/ui/ProjectDocumentsDialog.tsx`

> READ the file first. It currently has a local `Document` interface, an inline 3-step `handleUpload`, a `handleDelete`, and a list-row render. Replace the upload logic with the hook, the `Document` type with `DocumentSummary`, and the list rows with a `DocumentCard` grid. Keep the dialog shell, drop zone, header, and footer summary.

- [ ] **Step 1:** Replace the local `interface Document { ... }` with an import: `import type { DocumentSummary } from '@/types'` and use `DocumentSummary` for the `documents` state. Add `import { useDocumentUpload } from '@/hooks/useDocumentUpload'`, `import { DocumentCard } from '@/components/chat/DocumentCard'`, and `import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'`. Add preview state: `const [previewDoc, setPreviewDoc] = useState<DocumentSummary | null>(null)`.

- [ ] **Step 2:** Replace the inline `handleUpload` with the hook:
```ts
  const { upload, uploading } = useDocumentUpload()
  const handleUpload = async (file: File) => {
    try {
      await upload(file, projectId)
      toast.success(`Uploaded and indexed: ${file.name}`)
      await loadDocuments()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    }
  }
```
(Remove the now-unused `const [uploading, setUploading] = useState(false)` — the hook owns it.)

- [ ] **Step 3:** Replace the document **list** render (the `documents.map(doc => <div … list row …>)`) with a card grid + preview dialog:
```tsx
            <div className="grid grid-cols-2 gap-2.5">
              {documents.map(doc => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onOpen={setPreviewDoc}
                  onDelete={(d) => handleDelete(d.id, d.filename)}
                />
              ))}
            </div>
```
And before the closing `</Dialog.Content>` add:
```tsx
          <DocumentPreviewDialog
            open={previewDoc !== null}
            onOpenChange={(o) => { if (!o) setPreviewDoc(null) }}
            document={previewDoc}
          />
```
Update the `accept` attribute to include images: append `,.png,.jpg,.jpeg,.webp`. Update the helper text "...up to 10MB" → "...up to 50MB" (if present).

- [ ] **Step 4:** `npm run build` (typechecks the client) → clean. Lint: `npm run lint` → no new errors.
- [ ] **Step 5:** Commit: `git add src/components/ui/ProjectDocumentsDialog.tsx && git commit -m "feat(phase-c3): documents dialog uses shared hook + card grid"` (+ trailer)

---

## Task 7: ProjectLandingPage → hook (fix) + card grid (Frontend)

**Files:** `src/components/chat/ProjectLandingPage.tsx`

> READ the file. Its `handleUpload` POSTs to the retired inline `/api/documents` (BROKEN). Replace with the hook; swap the local `Document` interface for `DocumentSummary`; replace the file-card markup with `DocumentCard`.

- [ ] **Step 1:** Replace the local `interface Document { ... }` with `import type { DocumentSummary } from '@/types'`; type `documents` state as `DocumentSummary[]`. Add `import { useDocumentUpload } from '@/hooks/useDocumentUpload'` and `import { DocumentCard } from '@/components/chat/DocumentCard'`.

- [ ] **Step 2:** Replace the broken `handleUpload` (and remove `const [uploading, setUploading] = useState(false)`):
```ts
  const { upload, uploading } = useDocumentUpload()
  const handleUpload = async (file: File) => {
    try {
      await upload(file, project.id)
      toast.success(`Uploaded and indexed: ${file.name}`)
      await loadDocuments()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    }
  }
```

- [ ] **Step 3:** Replace the file-card `documents.map(doc => <button … >)` block with the shared card:
```tsx
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5 mt-1">
                {documents.map(doc => (
                  <DocumentCard key={doc.id} doc={doc} onOpen={setPreviewDoc} onDelete={(d) => handleDelete(d.id)} />
                ))}
              </div>
```
The file currently has `const [previewDoc, setPreviewDoc] = useState<Document | null>(null)` → change its type to `DocumentSummary`. There is no `handleDelete` here today — add one:
```ts
  const handleDelete = async (docId: number) => {
    try {
      const res = await fetch(`/api/documents?id=${docId}`, { method: 'DELETE' })
      if (res.ok) { setDocuments(prev => prev.filter(d => d.id !== docId)); toast.success('Deleted') }
    } catch { toast.error('Failed to delete') }
  }
```
Append images to the `accept` attribute: `,.png,.jpg,.jpeg,.webp`.

- [ ] **Step 4:** `npm run build` → clean; `npm run lint` → no new errors.
- [ ] **Step 5:** Commit: `git add src/components/chat/ProjectLandingPage.tsx && git commit -m "fix(phase-c3): landing page uses 3-step upload hook + card grid"` (+ trailer)

---

## Task 8: DocumentPreviewDialog tabs (Frontend, TDD)

**Files:** `src/components/ui/DocumentPreviewDialog.tsx`, `tests/hooks/DocumentPreviewDialog.test.tsx`

- [ ] **Step 1: Write the failing test** `tests/hooks/DocumentPreviewDialog.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/actions', () => ({ getDocumentChunks: vi.fn(async () => [{ chunkIndex: 0, content: 'EXTRACTED BODY TEXT' }]) }))

import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import type { DocumentSummary } from '@/types'

const pdf: DocumentSummary = {
  id: 1, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 10, chunkCount: 1,
  status: 'ready', errorMessage: null, url: 'signed:plan', thumbnailUrl: 'signed:t', extractionMethod: 'vision',
}

describe('DocumentPreviewDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a Preview tab with the original for a PDF', async () => {
    render(<DocumentPreviewDialog open document={pdf} onOpenChange={() => {}} />)
    expect(await screen.findByRole('tab', { name: /preview/i })).toBeTruthy()
    expect(screen.getByTitle(/plan\.pdf/i)).toBeTruthy() // iframe with the signed url
  })

  it('hides the Preview tab for a non-visual document (text)', async () => {
    const txt = { ...pdf, filename: 'notes.txt', mimeType: 'text/plain', url: 'signed:n' }
    render(<DocumentPreviewDialog open document={txt} onOpenChange={() => {}} />)
    expect(await screen.findByText(/EXTRACTED BODY TEXT/)).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /preview/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Update `DocumentPreviewDialog`'s prop type to `DocumentSummary | null` (import the type; replace the inline object type). Add a `hasVisual` flag and a `tab` state. Keep the existing `getDocumentChunks` effect + `deduplicateChunks`. Replace the single content `<div>` with a tab strip + panels:
```tsx
  const hasVisual = !!doc && !!doc.url && (doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf')
  const [tab, setTab] = useState<'preview' | 'text'>('preview')
  useEffect(() => { setTab(hasVisual ? 'preview' : 'text') }, [hasVisual, doc?.id])
```
Tab strip (place above the content area; only render the Preview tab button when `hasVisual`):
```tsx
          <div role="tablist" className="flex gap-1 mb-3 text-sm">
            {hasVisual && (
              <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}
                className={cn('px-3 py-1.5 rounded-lg', tab === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>Preview</button>
            )}
            <button role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')}
              className={cn('px-3 py-1.5 rounded-lg', tab === 'text' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>Extracted text</button>
            {doc?.url && <a href={doc.url} target="_blank" rel="noreferrer" className="ml-auto px-3 py-1.5 text-xs text-primary hover:underline">Open original ↗</a>}
          </div>
```
Content area:
```tsx
          <div className="flex-1 overflow-y-auto min-h-0 rounded-lg bg-white/[0.03] border border-white/5">
            {hasVisual && tab === 'preview' ? (
              doc!.mimeType.startsWith('image/')
                ? <img src={doc!.url!} alt={doc!.filename} className="w-full h-full object-contain" />
                : <iframe src={doc!.url!} title={doc!.filename} className="w-full h-full min-h-[60vh]" />
            ) : (
              <div className="p-4">
                {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  : <pre className="text-sm text-foreground/90 whitespace-pre-wrap break-words font-mono leading-relaxed">{content}</pre>}
              </div>
            )}
          </div>
```
Ensure `useState`, `cn` are imported (cn already used elsewhere; add `useState` to the React import).

- [ ] **Step 4: Run — expect PASS (2/2).** `npx tsc --noEmit` clean; `npm run build` clean.
- [ ] **Step 5: Commit:** `git add src/components/ui/DocumentPreviewDialog.tsx tests/hooks/DocumentPreviewDialog.test.tsx && git commit -m "feat(phase-c3): tabbed document preview (original + extracted text)"` (+ trailer)

---

## Task 9: Docs + full gate (Docs / QA)

**Files:** `CLAUDE.md`, `CHANGELOG.md`, `docs/SESSION_HANDOFF.md`, `docs/chatlog-2026-06-17-phase-c3.md`

- [ ] **Step 1:** `CLAUDE.md`: document the documents UI (thumbnail cards via `DocumentCard`, tabbed preview, `useDocumentUpload` shared hook, `documents.extraction_method` + vision/text badge, `DocumentSummary` type). Note the landing-page uploader fix.
- [ ] **Step 2:** `CHANGELOG.md`: add `[4.5.0]` — Phase C3 documents UI (thumbnail cards, tabbed preview, shared upload hook fixing the landing-page regression, extraction-method badge + migration `0004`). **Closes Phase C.**
- [ ] **Step 3:** `docs/SESSION_HANDOFF.md`: mark C3 done → Phase C complete; next is Phase D (Artifacts). Note migration `0004` applied to live Supabase.
- [ ] **Step 4:** Write `docs/chatlog-2026-06-17-phase-c3.md`.
- [ ] **Step 5: Full gate:** `npm run lint && npm run build && npm test` — 0 errors, 0 new warnings, all green.
- [ ] **Step 6: Manual smoke** (live Supabase is configured): `npm run dev`, open a project, drag-drop a PDF onto the **Files panel** (confirms the fixed uploader) → thumbnail card appears, reaches `ready` with a **vision** badge → click → tabbed preview renders the PDF + extracted text; delete removes it.
- [ ] **Step 7:** Commit (+ trailer).

---

## Self-review

**Spec coverage:** thumbnail cards both surfaces (T5/T6/T7) · file-type fallback (T5) · tabbed preview visual+text, preview-only-when-visual (T8) · status incl. uploading (T5) · method badge + `extraction_method` column + populate (T1/T2/T5) · fix landing-page uploader via shared hook (T4/T7) · shared `DocumentSummary` replacing 3 dupes (T3/T6/T7/T8) · GET unchanged (no task needed) · tests + gate + live smoke (T9). ✅
**Placeholders:** all code shown in full; component/hook tests with real assertions; component edits show exact before/after intent (implementer reads the file first, as noted). ✅
**Type consistency:** `DocumentSummary`/`DocumentStatus` (T3) used by `DocumentCard` (T5), both dialogs (T6/T7), preview (T8); `updateDocumentStatus`'s `extractionMethod` (T2) matches `extractionMethod: 'text'|'vision'` set in `/process` (T2) and the column (T1); `useDocumentUpload().upload(file, projectId)` signature consistent T4→T6/T7. ✅
**Deferred:** artifacts/export (Phase D); multi-page PDF flipping; lightbox rework; backfill of `extraction_method`.
