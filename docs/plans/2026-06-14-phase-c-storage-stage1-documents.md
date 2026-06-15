# Phase C-storage — Stage 1 (Documents) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Frame implementers by role (Backend / QA / Docs).

**Goal:** Move document upload to **direct-to-Supabase-Storage** (bypassing the Vercel function body limit), persist originals + first-page thumbnails in a private bucket, run the existing C2 extraction pipeline from the downloaded file, and serve files via short-lived signed URLs.

**Architecture:** A new server-only `src/lib/storage.ts` wraps `@supabase/supabase-js` (Storage API only; DB stays on Drizzle). A 3-step client flow — `POST /api/documents/upload-url` (mint signed upload URL + create `documents` row) → browser `uploadToSignedUrl` → `POST /api/documents/process` (download → extract → thumbnail → chunk/embed). `GET` mints signed download URLs; `DELETE` removes objects. Best-effort thumbnails via `@napi-rs/canvas`.

**Tech Stack:** Next.js 16 App Router, Drizzle (postgres-js), `@supabase/supabase-js` (Storage), Zod, Vitest (+ PGlite for action tests), unpdf + pdfjs-dist@5 legacy + @napi-rs/canvas (already deps).

**Spec:** `docs/specs/2026-06-14-phase-c-storage-design.md`. **Scope: Stage 1 only** (documents). Stage 2 (chat-attachments migration) gets its own plan after Stage 1 merges.

**Stage-wide facts (do not re-derive):**
- Supabase Storage API (verified via Context7): `from(bucket).createSignedUploadUrl(path,{upsert})` → `{data:{path,token,signedUrl}}`; browser `from(bucket).uploadToSignedUrl(path, token, file)`; `from(bucket).upload(path, buffer, {contentType, upsert})`; `from(bucket).download(path)` → `{data: Blob}`; `from(bucket).createSignedUrl(path, ttl)` → `{data:{signedUrl}}`; `from(bucket).remove([paths])`.
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser), `SUPABASE_STORAGE_BUCKET` (default `atelier-files`). The service-role key is read only in `src/lib/storage.ts`; never sent to the client.
- Private bucket; reads always via server-minted signed GET URLs.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json` | add `@supabase/supabase-js` dependency |
| `src/db/schema.ts` (modify) | `documents`: add `storage_path`, `thumbnail_path` |
| `drizzle/` (generated) | additive migration for the two columns |
| `src/lib/storage.ts` (new) | server Storage client + helpers + `isStorageConfigured` |
| `src/lib/thumbnails.ts` (new) | page-1 PDF / image → downscaled WebP (best-effort) |
| `src/lib/storageClient.ts` (new) | browser-only Supabase client for `uploadToSignedUrl` |
| `src/app/actions.ts` (modify) | `createUploadingDocument`, `updateDocumentStoragePath`, `getDocumentById`; widen `updateDocumentStatus`; `deleteDocument` returns the row |
| `src/lib/validation.ts` (modify) | `uploadUrlRequestSchema`, `processDocumentRequestSchema` |
| `src/app/api/documents/upload-url/route.ts` (new) | validate + create row + mint signed upload URL |
| `src/app/api/documents/process/route.ts` (new) | download → extract → thumbnail → chunk/embed |
| `src/app/api/documents/route.ts` (modify) | `GET` adds signed URLs; `DELETE` removes objects; retire inline `POST` |
| `src/components/ui/ProjectDocumentsDialog.tsx` (modify) | 3-step upload; accept images |
| Tests | `storage`, `thumbnails`, `documents-upload-url`, `documents-process`, actions |
| `CLAUDE.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`, chatlog | docs |

---

## Task 1: Dependency + schema migration (Backend)

**Files:** `package.json`, `src/db/schema.ts`, `drizzle/`

- [ ] **Step 1:** Install the Storage client: `npm install @supabase/supabase-js@^2`. Confirm it lands in `dependencies`.

- [ ] **Step 2:** In `src/db/schema.ts`, add two columns to the `documents` table (after `errorMessage`):

```ts
  errorMessage: text('error_message'),
  storagePath: text('storage_path'),
  thumbnailPath: text('thumbnail_path'),
```

- [ ] **Step 3:** Generate the migration: `npx drizzle-kit generate`. Expected: a new `drizzle/000X_*.sql` adding `storage_path` and `thumbnail_path` to `documents` (additive `ALTER TABLE … ADD COLUMN`). Do NOT run `migrate` (needs the live DB — it's a pending user action).

- [ ] **Step 4:** Typecheck: `npx tsc --noEmit` → clean.

- [ ] **Step 5:** Commit:

```bash
git add package.json package-lock.json src/db/schema.ts drizzle/
git commit -m "feat(c-storage): add @supabase/supabase-js + documents storage columns"
```

---

## Task 2: Storage module (Backend, TDD)

**Files:** Create `src/lib/storage.ts`, `tests/unit/lib/storage.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/storage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = {
  createSignedUploadUrl: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
}
const mockStorage = { from: vi.fn(() => mockFrom) }

function setup(url: string | undefined = 'https://x.supabase.co', key: string | undefined = 'service-key') {
  vi.resetModules()
  if (url) process.env.SUPABASE_URL = url; else delete process.env.SUPABASE_URL
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key; else delete process.env.SUPABASE_SERVICE_ROLE_KEY
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: mockStorage }) }))
}

describe('storage', () => {
  beforeEach(() => {
    Object.values(mockFrom).forEach(fn => fn.mockReset())
    mockStorage.from.mockClear()
  })

  it('isStorageConfigured reflects env', async () => {
    setup(undefined, undefined)
    const a = await import('@/lib/storage')
    expect(a.isStorageConfigured()).toBe(false)
    setup('https://x.supabase.co', 'k')
    const b = await import('@/lib/storage')
    expect(b.isStorageConfigured()).toBe(true)
  })

  it('createSignedUploadUrl returns path + token', async () => {
    setup()
    mockFrom.createSignedUploadUrl.mockResolvedValue({ data: { path: 'documents/1/2/f.pdf', token: 'tok' }, error: null })
    const { createSignedUploadUrl } = await import('@/lib/storage')
    const out = await createSignedUploadUrl('documents/1/2/f.pdf')
    expect(out).toEqual({ path: 'documents/1/2/f.pdf', token: 'tok' })
  })

  it('downloadToBuffer unwraps the Blob', async () => {
    setup()
    mockFrom.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
    const { downloadToBuffer } = await import('@/lib/storage')
    const buf = await downloadToBuffer('p')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBe(3)
  })

  it('createSignedDownloadUrl returns the url', async () => {
    setup()
    mockFrom.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    const { createSignedDownloadUrl } = await import('@/lib/storage')
    expect(await createSignedDownloadUrl('p', 60)).toBe('https://signed')
  })

  it('removeObjects skips empty input and forwards valid paths', async () => {
    setup()
    mockFrom.remove.mockResolvedValue({ data: [], error: null })
    const { removeObjects } = await import('@/lib/storage')
    await removeObjects([])
    expect(mockFrom.remove).not.toHaveBeenCalled()
    await removeObjects(['a', '', 'b'])
    expect(mockFrom.remove).toHaveBeenCalledWith(['a', 'b'])
  })

  it('throws a clear error when an op fails', async () => {
    setup()
    mockFrom.createSignedUrl.mockResolvedValue({ data: null, error: new Error('boom') })
    const { createSignedDownloadUrl } = await import('@/lib/storage')
    await expect(createSignedDownloadUrl('p')).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run — expect FAIL:** `npx vitest run tests/unit/lib/storage.test.ts`

- [ ] **Step 3: Implement** — `src/lib/storage.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'atelier-files'

let cached: SupabaseClient | null = null

export function isStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function bucket() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase Storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).')
  }
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false } })
  return cached.storage.from(BUCKET)
}

export const storageBucketName = BUCKET

export async function createSignedUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true })
  if (error || !data) throw error ?? new Error('Failed to create signed upload URL')
  return { path: data.path, token: data.token }
}

export async function uploadBuffer(path: string, buffer: Buffer, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, buffer, { contentType, upsert: true })
  if (error) throw error
}

export async function downloadToBuffer(path: string): Promise<Buffer> {
  const { data, error } = await bucket().download(path)
  if (error || !data) throw error ?? new Error('Failed to download object')
  return Buffer.from(await data.arrayBuffer())
}

export async function createSignedDownloadUrl(path: string, ttlSeconds = 3600): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, ttlSeconds)
  if (error || !data) throw error ?? new Error('Failed to create signed URL')
  return data.signedUrl
}

export async function removeObjects(paths: string[]): Promise<void> {
  const valid = paths.filter(Boolean)
  if (valid.length === 0) return
  const { error } = await bucket().remove(valid)
  if (error) throw error
}
```

- [ ] **Step 4: Run — expect PASS (6/6).**
- [ ] **Step 5: Commit:** `git add src/lib/storage.ts tests/unit/lib/storage.test.ts && git commit -m "feat(c-storage): server Supabase Storage module"`

---

## Task 3: Thumbnails module (Backend, TDD)

**Files:** Create `src/lib/thumbnails.ts`, `tests/unit/lib/thumbnails.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/thumbnails.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRender = vi.fn()
const mockEncode = vi.fn()
const mockDrawImage = vi.fn()
const mockLoadImage = vi.fn()

function setup() {
  vi.resetModules()
  vi.doMock('unpdf', () => ({
    definePDFJSModule: () => Promise.resolve(),
    renderPageAsImage: (...a: unknown[]) => mockRender(...a),
  }))
  vi.doMock('@napi-rs/canvas', () => ({
    loadImage: (...a: unknown[]) => mockLoadImage(...a),
    createCanvas: () => ({
      getContext: () => ({ drawImage: mockDrawImage }),
      encode: (...a: unknown[]) => mockEncode(...a),
    }),
  }))
}

describe('thumbnails', () => {
  beforeEach(() => {
    [mockRender, mockEncode, mockDrawImage, mockLoadImage].forEach(f => f.mockReset())
    mockLoadImage.mockResolvedValue({ width: 1200, height: 900 })
    mockEncode.mockResolvedValue(Buffer.from('webp'))
  })

  it('generatePdfThumbnail renders page 1 and encodes webp', async () => {
    setup()
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    const { generatePdfThumbnail } = await import('@/lib/thumbnails')
    const out = await generatePdfThumbnail(Buffer.from('pdf'))
    expect(mockRender).toHaveBeenCalledTimes(1)
    expect(mockRender.mock.calls[0][1]).toBe(1) // page 1
    expect(mockEncode).toHaveBeenCalledWith('webp', expect.any(Number))
    expect(Buffer.isBuffer(out)).toBe(true)
  })

  it('generateImageThumbnail downscales and encodes webp', async () => {
    setup()
    const { generateImageThumbnail } = await import('@/lib/thumbnails')
    const out = await generateImageThumbnail(Buffer.from('img'))
    expect(mockLoadImage).toHaveBeenCalledTimes(1)
    expect(mockDrawImage).toHaveBeenCalledTimes(1)
    expect(Buffer.isBuffer(out)).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `src/lib/thumbnails.ts`:

```ts
const THUMB_WIDTH = Number(process.env.THUMBNAIL_WIDTH) || 600

/** Render page 1 of a PDF to a small WebP thumbnail. Throws on failure (best-effort caller). */
export async function generatePdfThumbnail(buffer: Buffer): Promise<Buffer> {
  const { definePDFJSModule, renderPageAsImage } = await import('unpdf')
  await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
  const png = await renderPageAsImage(new Uint8Array(buffer), 1, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: 1,
  })
  return downscaleToWebp(Buffer.from(png))
}

/** Downscale an uploaded image to a small WebP thumbnail. */
export async function generateImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return downscaleToWebp(buffer)
}

async function downscaleToWebp(input: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const img = await loadImage(input)
  const scale = Math.min(1, THUMB_WIDTH / img.width)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return await canvas.encode('webp', 80)
}
```

- [ ] **Step 4: Run — expect PASS (2/2).**
- [ ] **Step 5: Commit:** `git add src/lib/thumbnails.ts tests/unit/lib/thumbnails.test.ts && git commit -m "feat(c-storage): first-page/image WebP thumbnails"`

---

## Task 4: Actions for the storage upload lifecycle (Backend, TDD)

**Files:** Modify `src/app/actions.ts`; add `tests/unit/actions/documents-storage.test.ts`

> READ the existing document actions first (`createDocument`, `updateDocumentStatus`, `getProjectDocuments`, `deleteDocument`, `saveDocumentChunks`, `updateChunkEmbedding` near line 352). The action tests use PGlite — see an existing `tests/unit/actions/*.test.ts` for the `createTestDb` pattern and `@/db` mock.

- [ ] **Step 1: Write the failing test** — `tests/unit/actions/documents-storage.test.ts`. Follow the existing actions-test harness (mock `@/db` with a getter returning `testDb`, call `createTestDb()` in `beforeEach`). Test:

```ts
// (imports + test-db harness identical to other tests/unit/actions/*.test.ts)
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
// ...mock '@/db' to the test instance per the existing pattern...

describe('document storage actions', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates an uploading doc, sets storage path, reads it back, updates status with thumbnail', async () => {
    const { createProject } = await import('@/app/actions')
    const { createUploadingDocument, updateDocumentStoragePath, getDocumentById, updateDocumentStatus } = await import('@/app/actions')
    const [project] = await createProject({ name: 'P' })
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 1234 })
    expect(doc.status).toBe('uploading')
    expect(doc.charCount).toBe(0)

    await updateDocumentStoragePath(doc.id, `documents/${project.id}/${doc.id}/plan.pdf`)
    const loaded = await getDocumentById(doc.id)
    expect(loaded?.storagePath).toBe(`documents/${project.id}/${doc.id}/plan.pdf`)

    await updateDocumentStatus(doc.id, 'ready', { chunkCount: 3, charCount: 500, thumbnailPath: 'documents/x/thumb.webp' })
    const after = await getDocumentById(doc.id)
    expect(after?.status).toBe('ready')
    expect(after?.chunkCount).toBe(3)
    expect(after?.thumbnailPath).toBe('documents/x/thumb.webp')
  })

  it('deleteDocument returns the deleted row (for storage cleanup)', async () => {
    const { createProject, createUploadingDocument, deleteDocument } = await import('@/app/actions')
    const [project] = await createProject({ name: 'P' })
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'a.pdf', mimeType: 'application/pdf', fileSize: 1 })
    const [deleted] = await deleteDocument(doc.id)
    expect(deleted.id).toBe(doc.id)
  })
})
```

> If `createProject`'s exact signature differs, match the existing actions tests. The point is the lifecycle: create `uploading` → set path → read → update status → delete-returns-row.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `src/app/actions.ts`, add/modify:

```ts
export async function createUploadingDocument(data: {
  projectId: number
  filename: string
  mimeType: string
  fileSize: number
}) {
  return await db.insert(documents).values({
    projectId: data.projectId,
    filename: data.filename,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    charCount: 0,
    status: 'uploading',
  }).returning()
}

export async function updateDocumentStoragePath(id: number, storagePath: string) {
  return await db.update(documents).set({ storagePath }).where(eq(documents.id, id)).returning()
}

export async function getDocumentById(id: number) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id))
  return doc ?? null
}
```

Widen `updateDocumentStatus` to the new states + fields:

```ts
export async function updateDocumentStatus(
  id: number,
  status: 'uploading' | 'processing' | 'ready' | 'error',
  updates?: { chunkCount?: number; errorMessage?: string; charCount?: number; thumbnailPath?: string }
) {
  return await db.update(documents)
    .set({ status, ...updates })
    .where(eq(documents.id, id))
    .returning()
}
```

Make `deleteDocument` return the deleted row:

```ts
export async function deleteDocument(id: number) {
  return await db.delete(documents).where(eq(documents.id, id)).returning()
}
```

> The old inline `createDocument` is no longer used after Task 7 retires the inline POST; leave it for now (Task 7 removes it) to keep this task's diff focused.

- [ ] **Step 4: Run — expect PASS.** Also run `npx vitest run tests/unit/actions/` to confirm no regressions, and `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/app/actions.ts tests/unit/actions/documents-storage.test.ts && git commit -m "feat(c-storage): document upload lifecycle actions"`

---

## Task 5: upload-url route (Backend, TDD)

**Files:** Modify `src/lib/validation.ts`; create `src/app/api/documents/upload-url/route.ts`, `tests/unit/api/documents-upload-url.test.ts`

- [ ] **Step 1:** Add to `src/lib/validation.ts`:

```ts
export const uploadUrlRequestSchema = z.object({
  projectId: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
})

export const processDocumentRequestSchema = z.object({
  documentId: z.number().int().positive(),
})
```

- [ ] **Step 2: Write the failing test** — `tests/unit/api/documents-upload-url.test.ts`. Mock `@/lib/storage`, `@/app/actions`, and keep `@/lib/fileExtraction` real (for `isSupported`/`MAX_FILE_SIZE`). Pattern (per existing api tests with `vi.resetModules()` + `vi.doMock()` + dynamic import):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsConfigured = vi.fn()
const mockCreateSignedUploadUrl = vi.fn()
const mockCreateUploading = vi.fn()
const mockSetPath = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: mockIsConfigured,
    createSignedUploadUrl: mockCreateSignedUploadUrl,
  }))
  vi.doMock('@/app/actions', () => ({
    createUploadingDocument: mockCreateUploading,
    updateDocumentStoragePath: mockSetPath,
  }))
  const { POST } = await import('@/app/api/documents/upload-url/route')
  return POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/documents/upload-url', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/upload-url', () => {
  beforeEach(() => {
    [mockIsConfigured, mockCreateSignedUploadUrl, mockCreateUploading, mockSetPath].forEach(f => f.mockReset())
    mockIsConfigured.mockReturnValue(true)
    mockCreateUploading.mockResolvedValue([{ id: 7, projectId: 1 }])
    mockSetPath.mockResolvedValue([{ id: 7 }])
    mockCreateSignedUploadUrl.mockResolvedValue({ path: 'documents/1/7/plan.pdf', token: 'tok' })
  })

  it('503 when storage not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const POST = await importRoute()
    const res = await POST(await req({ projectId: 1, filename: 'a.pdf', contentType: 'application/pdf', size: 10 }) as never)
    expect(res.status).toBe(503)
  })

  it('400 for oversize', async () => {
    const { MAX_FILE_SIZE } = await import('@/lib/fileExtraction')
    const POST = await importRoute()
    const res = await POST(await req({ projectId: 1, filename: 'a.pdf', contentType: 'application/pdf', size: MAX_FILE_SIZE + 1 }) as never)
    expect(res.status).toBe(400)
  })

  it('400 for unsupported type', async () => {
    const POST = await importRoute()
    const res = await POST(await req({ projectId: 1, filename: 'a.exe', contentType: 'application/octet-stream', size: 10 }) as never)
    expect(res.status).toBe(400)
  })

  it('creates row, sets path, returns documentId + token (image allowed)', async () => {
    const POST = await importRoute()
    const res = await POST(await req({ projectId: 1, filename: 'plan.png', contentType: 'image/png', size: 10 }) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.documentId).toBe(7)
    expect(data.token).toBe('tok')
    expect(data.path).toBe('documents/1/7/plan.pdf')
    expect(mockSetPath).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** — `src/app/api/documents/upload-url/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createUploadingDocument, updateDocumentStoragePath } from '@/app/actions'
import { isStorageConfigured, createSignedUploadUrl, storageBucketName } from '@/lib/storage'
import { MAX_FILE_SIZE, isSupported, isImageExtension, getExtension } from '@/lib/fileExtraction'
import { uploadUrlRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function POST(request: NextRequest) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured. Set Supabase Storage env vars.' }, { status: 503 })
    }
    const parsed = uploadUrlRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { projectId, filename, contentType, size } = parsed.data

    if (size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` }, { status: 400 })
    }
    const ext = getExtension(filename)
    const isImage = isImageExtension(ext) || contentType.startsWith('image/')
    if (!isSupported(filename, contentType) && !isImage) {
      return NextResponse.json({ error: `Unsupported file type: ${filename}.` }, { status: 400 })
    }

    const [doc] = await createUploadingDocument({
      projectId, filename, mimeType: contentType || 'application/octet-stream', fileSize: size,
    })
    const path = `documents/${projectId}/${doc.id}/${sanitize(filename)}`
    await updateDocumentStoragePath(doc.id, path)
    const { token } = await createSignedUploadUrl(path)

    return NextResponse.json({ documentId: doc.id, path, token, bucket: storageBucketName })
  } catch (error) {
    return apiError(error, 'Failed to start upload', 500, true)
  }
}
```

- [ ] **Step 5: Run — expect PASS (4/4).** `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit:** `git add src/lib/validation.ts src/app/api/documents/upload-url/route.ts tests/unit/api/documents-upload-url.test.ts && git commit -m "feat(c-storage): signed upload-url endpoint"`

---

## Task 6: process route (Backend, TDD)

**Files:** Create `src/app/api/documents/process/route.ts`, `tests/unit/api/documents-process.test.ts`

- [ ] **Step 1: Write the failing test** — mock `@/app/actions`, `@/lib/embeddings`, `@/lib/chunking`, `@/lib/storage`, `@/lib/thumbnails`, `@/lib/visionExtraction`, and `@/lib/fileExtraction` (override `extractTextFromBuffer`, keep helpers real):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  getDocumentById: vi.fn(), updateDocumentStatus: vi.fn(), saveDocumentChunks: vi.fn(), updateChunkEmbedding: vi.fn(),
  ensureEmbeddingModel: vi.fn(), generateEmbedding: vi.fn(), chunkText: vi.fn(),
  downloadToBuffer: vi.fn(), uploadBuffer: vi.fn(),
  generatePdfThumbnail: vi.fn(), generateImageThumbnail: vi.fn(),
  extractTextFromBuffer: vi.fn(), extractViaVision: vi.fn(), extractViaVisionImage: vi.fn(),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    getDocumentById: m.getDocumentById, updateDocumentStatus: m.updateDocumentStatus,
    saveDocumentChunks: m.saveDocumentChunks, updateChunkEmbedding: m.updateChunkEmbedding,
  }))
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: m.ensureEmbeddingModel, generateEmbedding: m.generateEmbedding }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: m.chunkText }))
  vi.doMock('@/lib/storage', () => ({ downloadToBuffer: m.downloadToBuffer, uploadBuffer: m.uploadBuffer }))
  vi.doMock('@/lib/thumbnails', () => ({ generatePdfThumbnail: m.generatePdfThumbnail, generateImageThumbnail: m.generateImageThumbnail }))
  vi.doMock('@/lib/visionExtraction', () => ({ extractViaVision: m.extractViaVision, extractViaVisionImage: m.extractViaVisionImage }))
  vi.doMock('@/lib/fileExtraction', async (orig) => ({ ...(await (orig as () => Promise<Record<string, unknown>>)()), extractTextFromBuffer: m.extractTextFromBuffer }))
  const { POST } = await import('@/app/api/documents/process/route')
  return POST
}

function req(documentId: number) {
  return new Request('http://localhost/api/documents/process', {
    method: 'POST', body: JSON.stringify({ documentId }), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/process', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.ensureEmbeddingModel.mockResolvedValue({ available: true })
    m.downloadToBuffer.mockResolvedValue(Buffer.from('bytes'))
    m.chunkText.mockReturnValue([{ index: 0, content: 'chunk' }])
    m.saveDocumentChunks.mockResolvedValue([{ id: 11, content: 'chunk' }])
    m.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1))
    m.updateChunkEmbedding.mockResolvedValue(undefined)
    m.updateDocumentStatus.mockResolvedValue(undefined)
    m.uploadBuffer.mockResolvedValue(undefined)
    m.generatePdfThumbnail.mockResolvedValue(Buffer.from('thumb'))
    m.generateImageThumbnail.mockResolvedValue(Buffer.from('thumb'))
    m.extractViaVision.mockResolvedValue('')
    m.extractViaVisionImage.mockResolvedValue('')
  })

  it('404 when the document or its storagePath is missing', async () => {
    m.getDocumentById.mockResolvedValue(null)
    const POST = await importRoute()
    expect((await POST(await req(1) as never)).status).toBe(404)
  })

  it('text PDF: downloads, extracts text, uploads thumbnail, embeds, status ready', async () => {
    m.getDocumentById.mockResolvedValue({ id: 7, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'documents/1/7/doc.pdf' })
    m.extractTextFromBuffer.mockResolvedValue('A'.repeat(300))
    const POST = await importRoute()
    const res = await POST(await req(7) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ready')
    expect(m.downloadToBuffer).toHaveBeenCalledWith('documents/1/7/doc.pdf')
    expect(m.extractViaVision).not.toHaveBeenCalled()
    expect(m.uploadBuffer).toHaveBeenCalled() // thumbnail
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ chunkCount: 1, thumbnailPath: expect.stringContaining('thumb.webp') }))
  })

  it('thin-text PDF falls back to vision', async () => {
    m.getDocumentById.mockResolvedValue({ id: 8, projectId: 1, filename: 'scan.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('')
    m.extractViaVision.mockResolvedValue('V'.repeat(300))
    const POST = await importRoute()
    const res = await POST(await req(8) as never)
    expect(res.status).toBe(200)
    expect(m.extractViaVision).toHaveBeenCalled()
    expect(m.chunkText).toHaveBeenCalledWith('V'.repeat(300))
  })

  it('image upload uses extractViaVisionImage + image thumbnail', async () => {
    m.getDocumentById.mockResolvedValue({ id: 9, projectId: 1, filename: 'p.png', mimeType: 'image/png', storagePath: 'p' })
    m.extractViaVisionImage.mockResolvedValue('image text here')
    const POST = await importRoute()
    const res = await POST(await req(9) as never)
    expect(res.status).toBe(200)
    expect(m.extractViaVisionImage).toHaveBeenCalled()
    expect(m.generateImageThumbnail).toHaveBeenCalled()
    expect(m.extractTextFromBuffer).not.toHaveBeenCalled()
  })

  it('thumbnail failure is non-fatal (still ready, no thumbnailPath)', async () => {
    m.getDocumentById.mockResolvedValue({ id: 10, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('A'.repeat(300))
    m.generatePdfThumbnail.mockRejectedValue(new Error('render boom'))
    const POST = await importRoute()
    const res = await POST(await req(10) as never)
    expect(res.status).toBe(200)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(10, 'ready', expect.objectContaining({ thumbnailPath: undefined }))
  })

  it('empty extraction → error status + 400', async () => {
    m.getDocumentById.mockResolvedValue({ id: 12, projectId: 1, filename: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'p' })
    m.extractTextFromBuffer.mockResolvedValue('')
    m.extractViaVision.mockResolvedValue('')
    const POST = await importRoute()
    const res = await POST(await req(12) as never)
    expect(res.status).toBe(400)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(12, 'error', expect.objectContaining({ errorMessage: expect.any(String) }))
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `src/app/api/documents/process/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getDocumentById, updateDocumentStatus, saveDocumentChunks, updateChunkEmbedding } from '@/app/actions'
import { generateEmbedding, ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { MAX_TEXT_LENGTH, getExtension, isImageExtension, extractTextFromBuffer } from '@/lib/fileExtraction'
import { extractViaVision, extractViaVisionImage } from '@/lib/visionExtraction'
import { downloadToBuffer, uploadBuffer } from '@/lib/storage'
import { generatePdfThumbnail, generateImageThumbnail } from '@/lib/thumbnails'
import { processDocumentRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

const MIN_TEXT = Number(process.env.EXTRACTION_MIN_TEXT_CHARS) || 100

export async function POST(request: NextRequest) {
  try {
    const parsed = processDocumentRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const doc = await getDocumentById(parsed.data.documentId)
    if (!doc || !doc.storagePath) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    const { available } = await ensureEmbeddingModel()
    if (!available) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'No embedding provider available.' })
      return NextResponse.json({ error: 'No embedding provider available. Set a Gemini API key.' }, { status: 503 })
    }

    await updateDocumentStatus(doc.id, 'processing')
    const ext = getExtension(doc.filename)
    const isImage = isImageExtension(ext) || doc.mimeType.startsWith('image/')

    let buffer: Buffer
    try {
      buffer = await downloadToBuffer(doc.storagePath)
    } catch (e) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Failed to download uploaded file.' })
      return apiError(e, 'Failed to download uploaded file', 500, false)
    }

    let textContent = ''
    if (isImage) {
      textContent = await extractViaVisionImage(buffer, doc.mimeType)
    } else {
      textContent = await extractTextFromBuffer(buffer, ext)
      if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
        const vision = await extractViaVision(buffer)
        if (vision.trim().length > textContent.trim().length) textContent = vision
      }
    }
    if (textContent.length > MAX_TEXT_LENGTH) {
      console.warn(`[documents/process] ${doc.filename}: content truncated ${textContent.length} -> ${MAX_TEXT_LENGTH}`)
      textContent = textContent.slice(0, MAX_TEXT_LENGTH)
    }
    if (!textContent.trim()) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'No text content could be extracted.' })
      return NextResponse.json({ error: 'No text content could be extracted.' }, { status: 400 })
    }

    // Thumbnail — best-effort.
    let thumbnailPath: string | undefined
    try {
      const thumb = isImage
        ? await generateImageThumbnail(buffer)
        : ext === 'pdf' ? await generatePdfThumbnail(buffer) : undefined
      if (thumb) {
        thumbnailPath = `documents/${doc.projectId}/${doc.id}/thumb.webp`
        await uploadBuffer(thumbnailPath, thumb, 'image/webp')
      }
    } catch (e) {
      console.warn('[documents/process] thumbnail failed:', e instanceof Error ? e.message : e)
      thumbnailPath = undefined
    }

    const textChunks = chunkText(textContent)
    const saved = await saveDocumentChunks(textChunks.map(c => ({
      documentId: doc.id, projectId: doc.projectId, chunkIndex: c.index, content: c.content,
    })))
    const results = await Promise.allSettled(saved.map(async (chunk) => {
      const embedding = await generateEmbedding(chunk.content, 'document')
      await updateChunkEmbedding(chunk.id, embedding)
    }))
    const embedded = results.filter(r => r.status === 'fulfilled').length
    if (results.length - embedded > 0) {
      console.warn(`[documents/process] ${results.length - embedded}/${saved.length} chunks failed to embed`)
    }
    const status = embedded === 0 && saved.length > 0 ? 'error' : 'ready'
    await updateDocumentStatus(doc.id, status, { chunkCount: saved.length, charCount: textContent.length, thumbnailPath })

    return NextResponse.json({ documentId: doc.id, status, chunkCount: saved.length, charCount: textContent.length })
  } catch (error) {
    return apiError(error, 'Failed to process document', 500, true)
  }
}
```

- [ ] **Step 4: Run — expect PASS (6/6).** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit:** `git add src/app/api/documents/process/route.ts tests/unit/api/documents-process.test.ts && git commit -m "feat(c-storage): process endpoint (download -> extract -> thumbnail -> embed)"`

---

## Task 7: GET signed URLs + DELETE cleanup; retire inline POST (Backend, TDD)

**Files:** Modify `src/app/api/documents/route.ts`; update `tests/unit/api/documents-route.test.ts`

> READ the current route. It has `POST` (inline upload), `GET` (list), `DELETE`. This task: **remove `POST`** (replaced by upload-url + process), make `GET` attach signed URLs, make `DELETE` remove Storage objects. Remove the now-unused imports the old POST used (`createDocument`, `generateEmbedding`, `ensureEmbeddingModel`, `chunkText`, `MAX_*`, `getExtension`, `isSupported`, `extractTextFromBuffer`, vision imports).

- [ ] **Step 1: Replace `tests/unit/api/documents-route.test.ts`** — the old tests targeted the inline POST, which no longer exists. Replace its `describe` body with GET + DELETE coverage:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetProjectDocuments = vi.fn()
const mockGetDocumentById = vi.fn()
const mockDeleteDocument = vi.fn()
const mockCreateSignedDownloadUrl = vi.fn()
const mockRemoveObjects = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    getProjectDocuments: mockGetProjectDocuments,
    getDocumentById: mockGetDocumentById,
    deleteDocument: mockDeleteDocument,
  }))
  vi.doMock('@/lib/storage', () => ({
    createSignedDownloadUrl: mockCreateSignedDownloadUrl,
    removeObjects: mockRemoveObjects,
  }))
  return await import('@/app/api/documents/route')
}

describe('GET /api/documents', () => {
  beforeEach(() => {
    [mockGetProjectDocuments, mockGetDocumentById, mockDeleteDocument, mockCreateSignedDownloadUrl, mockRemoveObjects].forEach(f => f.mockReset())
    mockCreateSignedDownloadUrl.mockImplementation((p: string) => Promise.resolve(`signed:${p}`))
  })

  it('returns docs with signed original + thumbnail URLs', async () => {
    mockGetProjectDocuments.mockResolvedValue([
      { id: 1, projectId: 1, filename: 'a.pdf', storagePath: 'documents/1/1/a.pdf', thumbnailPath: 'documents/1/1/thumb.webp', status: 'ready' },
      { id: 2, projectId: 1, filename: 'b.pdf', storagePath: null, thumbnailPath: null, status: 'uploading' },
    ])
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/documents?projectId=1') as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.documents[0].url).toBe('signed:documents/1/1/a.pdf')
    expect(data.documents[0].thumbnailUrl).toBe('signed:documents/1/1/thumb.webp')
    expect(data.documents[1].url).toBeNull()
  })
})

describe('DELETE /api/documents', () => {
  beforeEach(() => {
    [mockGetProjectDocuments, mockGetDocumentById, mockDeleteDocument, mockCreateSignedDownloadUrl, mockRemoveObjects].forEach(f => f.mockReset())
  })

  it('removes storage objects then deletes the row', async () => {
    mockGetDocumentById.mockResolvedValue({ id: 5, storagePath: 'documents/1/5/a.pdf', thumbnailPath: 'documents/1/5/thumb.webp' })
    mockRemoveObjects.mockResolvedValue(undefined)
    mockDeleteDocument.mockResolvedValue([{ id: 5 }])
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request('http://localhost/api/documents?id=5', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    expect(mockRemoveObjects).toHaveBeenCalledWith(['documents/1/5/a.pdf', 'documents/1/5/thumb.webp'])
    expect(mockDeleteDocument).toHaveBeenCalledWith(5)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — rewrite `src/app/api/documents/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getProjectDocuments, getDocumentById, deleteDocument } from '@/app/actions'
import { createSignedDownloadUrl, removeObjects } from '@/lib/storage'

export async function GET(request: NextRequest) {
  const projectId = Number(request.nextUrl.searchParams.get('projectId'))
  if (!projectId || isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
  }
  const docs = await getProjectDocuments(projectId)
  const withUrls = await Promise.all(docs.map(async (d) => {
    const [url, thumbnailUrl] = await Promise.all([
      d.storagePath ? createSignedDownloadUrl(d.storagePath).catch(() => null) : Promise.resolve(null),
      d.thumbnailPath ? createSignedDownloadUrl(d.thumbnailPath).catch(() => null) : Promise.resolve(null),
    ])
    return { ...d, url, thumbnailUrl }
  }))
  return NextResponse.json({ documents: withUrls })
}

export async function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })
  }
  const doc = await getDocumentById(id)
  if (doc) {
    await removeObjects([doc.storagePath, doc.thumbnailPath].filter((p): p is string => Boolean(p))).catch((e) => {
      console.warn('[documents] storage cleanup failed:', e instanceof Error ? e.message : e)
    })
  }
  await deleteDocument(id)
  return NextResponse.json({ success: true })
}
```

> Also delete the now-unused inline `createDocument` action from `src/app/actions.ts` if nothing else references it (grep first: `grep -rn createDocument src tests`). If tests still reference it, leave it.

- [ ] **Step 4: Run — expect PASS.** Run the whole api suite: `npx vitest run tests/unit/api/` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit:** `git add src/app/api/documents/route.ts src/app/actions.ts tests/unit/api/documents-route.test.ts && git commit -m "feat(c-storage): signed-URL GET + storage cleanup on DELETE; retire inline upload"`

---

## Task 8: Client 3-step upload (Frontend)

**Files:** Create `src/lib/storageClient.ts`; modify `src/components/ui/ProjectDocumentsDialog.tsx`

- [ ] **Step 1:** Create the browser Supabase client `src/lib/storageClient.ts`:

```ts
'use client'
import { createClient } from '@supabase/supabase-js'

let cached: ReturnType<typeof createClient> | null = null

/** Browser Supabase client (anon key) — used only for uploadToSignedUrl. */
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase browser env not set (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).')
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}
```

- [ ] **Step 2:** In `src/components/ui/ProjectDocumentsDialog.tsx`, replace `handleUpload` with the 3-step flow:

```ts
  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      // 1. Mint a signed upload URL + create the documents row.
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
      })
      if (!urlRes.ok) throw new Error((await urlRes.json()).error || 'Upload failed')
      const { documentId, path, token, bucket } = await urlRes.json()

      // 2. Upload the bytes straight to Storage (bypasses the function body limit).
      const { getBrowserSupabase } = await import('@/lib/storageClient')
      const { error: upErr } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr

      // 3. Kick off server-side processing.
      const procRes = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (!procRes.ok) throw new Error((await procRes.json()).error || 'Processing failed')

      toast.success(`Uploaded and indexed: ${file.name}`)
      await loadDocuments()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed'
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }
```

- [ ] **Step 3:** Update the file input `accept` to include images, and the helper text to say 50MB:

```tsx
              accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.py,.js,.ts,.tsx,.jsx,.json,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.yaml,.yml,.xml,.sql,.png,.jpg,.jpeg,.webp"
```
```tsx
                  PDF, DOCX, images, text, and code files up to 50MB
```

- [ ] **Step 4:** Build to typecheck the client: `npm run build` → clean.
- [ ] **Step 5:** Commit: `git add src/lib/storageClient.ts src/components/ui/ProjectDocumentsDialog.tsx && git commit -m "feat(c-storage): 3-step direct-to-storage upload in documents dialog"`

---

## Task 9: Docs + full gate (Docs / QA)

**Files:** `CLAUDE.md`, `CHANGELOG.md`, `docs/SESSION_HANDOFF.md`, `docs/chatlog-2026-06-14-phase-c-storage.md`

- [ ] **Step 1:** Update `CLAUDE.md`: document the new document-upload flow (upload-url → direct PUT → process), the `/api/documents/*` routes, `src/lib/storage.ts` / `thumbnails.ts` / `storageClient.ts`, the private-bucket + signed-URL model, and the four `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` env vars + `SUPABASE_STORAGE_BUCKET`. Note originals/thumbnails now persist in Storage.

- [ ] **Step 2:** Add a `CHANGELOG.md` `[4.3.0]` entry — Phase C-storage Stage 1: direct-to-Storage document upload, originals + thumbnails, signed-URL serving, delete cleanup, schema columns, env. Reference spec + this plan.

- [ ] **Step 3:** Update `docs/SESSION_HANDOFF.md`: C-storage Stage 1 done; Stage 2 (attachments) still to plan; pending USER actions (create private bucket `atelier-files`, set the 4 env vars, `drizzle-kit migrate` the new migration).

- [ ] **Step 4:** Write `docs/chatlog-2026-06-14-phase-c-storage.md` (concise session log).

- [ ] **Step 5: Full gate:** `npm run lint && npm run build && npm test`. Expect 0 errors, 0 new warnings, all tests green. (E2E + live-Storage manual smoke require the Supabase bucket + env — pending USER actions; note in the handoff.)

- [ ] **Step 6:** Commit: `git add CLAUDE.md CHANGELOG.md docs/SESSION_HANDOFF.md docs/chatlog-2026-06-14-phase-c-storage.md && git commit -m "docs(c-storage): document Storage flow + env; changelog + handoff"`

---

## Self-review

**Spec coverage (Stage 1 scope):** storage client + helpers (T2) · private bucket + signed upload URL (T2/T5) · client direct upload via anon key (T8) · process endpoint downloads + runs C2 pipeline (T6) · thumbnails best-effort (T3/T6) · signed download URLs (T7) · delete cleanup (T7) · schema columns + migration (T1) · env incl. NEXT_PUBLIC (T1 dep, documented T9) · large files bypass body limit (T5/T8) · docs (T9). ✅ Stage 2 (attachments) intentionally deferred to its own plan.

**Placeholders:** modules + routes + client shown in full; tests shown with real assertions; the actions test references the existing PGlite harness (the implementer reads a sibling actions test for the exact `@/db` mock — that boilerplate is environment-specific and intentionally not re-inlined). ✅

**Type consistency:** `createUploadingDocument`/`updateDocumentStoragePath`/`getDocumentById`/widened `updateDocumentStatus`/`deleteDocument`-returns-row used consistently across T4–T7; storage helpers (`createSignedUploadUrl`→`{path,token}`, `downloadToBuffer`→`Buffer`, `createSignedDownloadUrl`→`string`, `removeObjects`, `uploadBuffer`, `storageBucketName`, `isStorageConfigured`) consistent T2→T5/T6/T7; thumbnails (`generatePdfThumbnail`/`generateImageThumbnail`) consistent T3→T6. ✅

**Deferred:** Stage 2 (chat-attachments migration); C3 thumbnail/preview UI; resumable uploads; orphaned-`uploading`-row cleanup sweep.
