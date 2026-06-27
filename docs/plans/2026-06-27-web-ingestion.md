# Web Ingestion ("Add from web") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

**Why:** "Design B" from the Tavily research. The app already has web *search* twice over (Claude native + Google grounding); the net-new value is pulling specific web pages/sites into a project's RAG store so the assistant can cite them — without downloading and re-uploading PDFs.

**What:** From a project's Documents dialog, **Add from URL** (single page) or **Crawl a site** (Map → user picks pages). Each page is extracted to markdown via Tavily, stored, chunked, embedded, and becomes a normal project document.

**Outcome:** Web content flows through the existing `chunk → embed → pgvector` pipeline; ships as **v4.32.0**.

**Source spec:** `docs/specs/2026-06-27-web-ingestion-design.md` (approved 2026-06-27).

**Goal:** Tavily-backed single-URL + Map-first crawl ingestion into the `documents` pipeline, gated behind a server-only `getTavilyApiKey()`, with no DB migration.

**Architecture:** A new server-only Tavily wrapper (`src/lib/tavily.ts`: `mapSite`, `extractUrl`). The post-extraction tail of `documents/process` is factored into a shared `src/lib/ingest.ts` (`ingestText`) used by both the file pipeline and a new `POST /api/documents/web-ingest` route; a `POST /api/documents/web-map` route lists a site's URLs. A client hook (`useWebIngest`) orchestrates per-page ingest; an `AddFromWebDialog` drives the UI from inside `ProjectDocumentsDialog` (which both the modal and the project landing page already route through). The Tavily key follows the `SENSITIVE_KEYS` discipline and never reaches the client.

**Tech Stack:** Next.js 16 App Router, `@tavily/core`, Drizzle (`postgres-js`, pgvector), Gemini embeddings (`@ai-sdk/google`), Zod, Vitest (PGlite for actions, `vi.resetModules`+`vi.doMock` scaffold for routes, jsdom for hooks/components), Radix Dialog, lucide-react, sonner.

## Global Constraints

- **Secret handling (hard requirement — "do not expose any keys anywhere"):** the Tavily key is read only server-side via `getTavilyApiKey()`; `src/lib/tavily.ts` is server-only **by convention** (never imported by client code, like `src/lib/storage.ts` — the `server-only` npm package is **not** used in this repo); `'tavily-api-key'` is in `SENSITIVE_KEYS`; the Settings field is write-only and the UI shows a boolean only (`getApiKeyStatus`); the key is never logged, echoed, returned in any response body, or exposed via `NEXT_PUBLIC_*`.
- **All DB access goes through `'use server'` actions** in `src/app/actions.ts`. Route/client code never touches `db` directly.
- **All POST routes validate the body with a Zod schema** in `src/lib/validation.ts`; errors go through `apiError()` (`src/lib/errors.ts`).
- **No DB migration.** Web docs reuse `documents`/`documentChunks` (`mimeType: 'text/markdown'`, `extractionMethod: 'text'`, `Source: <url>` header in the text).
- **Conventional Commits 1.0** (`feat`, `fix`, `docs`, `test`, `refactor`, …), imperative lowercase, no trailing period. Add the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Verification gate:** `npm run typecheck` (0), `npm run lint` (0 errors; ~26 baseline warnings ok), `npm run build`, `npm test`. All green before merge.
- **Branch:** `feat/web-ingestion` off `master` (already created). Solo dev → no PRs; merge `--no-ff` to `master` after gate + user approval, then tag `v4.32.0`. Live apply: none (no migration).
- **New UI uses semantic tokens** (`bg-card`, `border-border`, `hover:bg-accent`, `text-muted-foreground`) — do **not** add new `white/X`·`black/X` overlay utilities (those are Phase 2 cleanup debt).

---

### Task 1: Tavily dependency + key plumbing (settings, SENSITIVE_KEYS, status, docs)

**Files:**
- Modify: `package.json` (add `@tavily/core` to dependencies)
- Modify: `src/lib/settings.ts` (add `getTavilyApiKey`)
- Modify: `src/app/actions.ts:42` (`SENSITIVE_KEYS`) and `src/app/actions.ts:656-660` (`getApiKeyStatus`)
- Modify: `CLAUDE.md` (document `TAVILY_API_KEY` + `WEB_MAP_LIMIT`/`WEB_MAP_MAX_DEPTH`)
- Test: `tests/unit/actions/api-keys-tavily.test.ts`

**Interfaces:**
- Produces: `getTavilyApiKey(): Promise<string | null>` (from `@/lib/settings`); `getApiKeyStatus(): Promise<{ gemini: boolean; anthropic: boolean; tavily: boolean }>` (from `@/app/actions`); `'tavily-api-key'` blocked by `getSetting`/`getSettings`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @tavily/core`
Expected: `@tavily/core` appears in `package.json` dependencies; `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/actions/api-keys-tavily.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { getSetting, getSettings } from '@/app/actions'

describe('tavily-api-key is a sensitive, server-only setting', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('getSetting throws for tavily-api-key', async () => {
    await expect(getSetting('tavily-api-key')).rejects.toThrow('Access denied')
  })

  it('getSettings filters out tavily-api-key', async () => {
    const result = await getSettings(['tavily-api-key'])
    expect(result).toEqual({})
  })

  it('getApiKeyStatus reports tavily configured from the DB', async () => {
    const { getApiKeyStatus, setSetting } = await import('@/app/actions')
    delete process.env.TAVILY_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    await setSetting('tavily-api-key', 'tvly-test')
    const status = await getApiKeyStatus()
    expect(status.tavily).toBe(true)
    expect(status.anthropic).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/actions/api-keys-tavily.test.ts`
Expected: FAIL — `getSetting('tavily-api-key')` resolves instead of throwing, and `status.tavily` is `undefined`.

- [ ] **Step 4: Add `getTavilyApiKey` to `src/lib/settings.ts`**

Append after `getAnthropicApiKey` (line 48):

```ts
export async function getTavilyApiKey(): Promise<string | null> {
  return getServerSetting('tavily-api-key', 'TAVILY_API_KEY')
}
```

- [ ] **Step 5: Add the key to `SENSITIVE_KEYS` and `getApiKeyStatus`**

In `src/app/actions.ts` line 42:

```ts
const SENSITIVE_KEYS = new Set(['gemini-api-key', 'anthropic-api-key', 'tavily-api-key'])
```

Replace `getApiKeyStatus` (lines 656-660):

```ts
export async function getApiKeyStatus(): Promise<{ gemini: boolean; anthropic: boolean; tavily: boolean }> {
  const { getGeminiApiKey, getAnthropicApiKey, getTavilyApiKey } = await import('@/lib/settings')
  const [gemini, anthropic, tavily] = await Promise.all([getGeminiApiKey(), getAnthropicApiKey(), getTavilyApiKey()])
  return { gemini: Boolean(gemini), anthropic: Boolean(anthropic), tavily: Boolean(tavily) }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/actions/api-keys-tavily.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Document the env vars in `CLAUDE.md`**

In the `.env.local` block (after the Supabase Storage section), add:

```
# Web ingestion (Design B) — pull a URL/site into a project's RAG store via Tavily.
# Server-only; OFF unless set. Can also be set at runtime via Settings → API Keys.
TAVILY_API_KEY=your_tavily_key_here
WEB_MAP_LIMIT=100          # optional; max URLs a site map returns (default 100)
WEB_MAP_MAX_DEPTH=2        # optional; crawl depth for mapping (default 2)
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/settings.ts src/app/actions.ts CLAUDE.md tests/unit/actions/api-keys-tavily.test.ts
git commit -m "feat: add Tavily key plumbing (server-only, SENSITIVE_KEYS, status)"
```

---

### Task 2: Tavily wrapper (`src/lib/tavily.ts`)

**Files:**
- Create: `src/lib/tavily.ts`
- Test: `tests/unit/lib/tavily.test.ts`

**Interfaces:**
- Consumes: `getTavilyApiKey` (Task 1); `tavily` from `@tavily/core`.
- Produces: `isTavilyConfigured(): Promise<boolean>`; `mapSite(url: string, opts?: { maxDepth?: number; limit?: number }): Promise<string[]>`; `extractUrl(url: string): Promise<{ url: string; title: string; markdown: string }>` (throws `'No content extracted'` on empty, `'Tavily API key not configured'` on missing key).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/tavily.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getKey = vi.fn()
const mapMock = vi.fn()
const extractMock = vi.fn()

vi.mock('@/lib/settings', () => ({ getTavilyApiKey: getKey }))
vi.mock('@tavily/core', () => ({ tavily: () => ({ map: mapMock, extract: extractMock }) }))

import { isTavilyConfigured, mapSite, extractUrl } from '@/lib/tavily'

describe('tavily wrapper', () => {
  beforeEach(() => {
    getKey.mockReset(); mapMock.mockReset(); extractMock.mockReset()
    getKey.mockResolvedValue('tvly-test')
  })

  it('isTavilyConfigured reflects the key presence', async () => {
    getKey.mockResolvedValueOnce('tvly-test')
    expect(await isTavilyConfigured()).toBe(true)
    getKey.mockResolvedValueOnce(null)
    expect(await isTavilyConfigured()).toBe(false)
  })

  it('mapSite returns results and clamps the limit', async () => {
    mapMock.mockResolvedValue({ results: ['https://a', 'https://b'] })
    const urls = await mapSite('https://site', { limit: 9999 })
    expect(urls).toEqual(['https://a', 'https://b'])
    expect(mapMock).toHaveBeenCalledWith('https://site', expect.objectContaining({ limit: 100 }))
  })

  it('extractUrl derives the title from the first heading', async () => {
    extractMock.mockResolvedValue({ results: [{ url: 'https://x', rawContent: '# Hello World\n\nbody' }] })
    const r = await extractUrl('https://x')
    expect(r.title).toBe('Hello World')
    expect(r.markdown).toContain('body')
  })

  it('extractUrl falls back to host+path when there is no heading', async () => {
    extractMock.mockResolvedValue({ results: [{ url: 'https://x.com/a', rawContent: 'plain text' }] })
    const r = await extractUrl('https://x.com/a')
    expect(r.title).toBe('x.com/a')
  })

  it('extractUrl throws on empty content', async () => {
    extractMock.mockResolvedValue({ results: [{ url: 'https://x', rawContent: '   ' }] })
    await expect(extractUrl('https://x')).rejects.toThrow('No content extracted')
  })

  it('throws when no key is configured', async () => {
    getKey.mockResolvedValue(null)
    await expect(mapSite('https://site')).rejects.toThrow('Tavily API key not configured')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/tavily.test.ts`
Expected: FAIL with "Cannot find module '@/lib/tavily'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/tavily.ts`:

```ts
// Server-only Tavily wrapper (map + extract). Never import from client code —
// the API key is read here via getTavilyApiKey() and must not reach the browser.
import { tavily } from '@tavily/core'
import { getTavilyApiKey } from '@/lib/settings'

const MAP_LIMIT = Number(process.env.WEB_MAP_LIMIT) || 100
const MAP_MAX_DEPTH = Number(process.env.WEB_MAP_MAX_DEPTH) || 2

export async function isTavilyConfigured(): Promise<boolean> {
  return Boolean(await getTavilyApiKey())
}

async function client() {
  const apiKey = await getTavilyApiKey()
  if (!apiKey) throw new Error('Tavily API key not configured')
  return tavily({ apiKey })
}

export async function mapSite(url: string, opts?: { maxDepth?: number; limit?: number }): Promise<string[]> {
  const c = await client()
  const limit = Math.min(Math.max(1, opts?.limit ?? MAP_LIMIT), MAP_LIMIT)
  const maxDepth = Math.min(Math.max(1, opts?.maxDepth ?? MAP_MAX_DEPTH), 3)
  const res = await c.map(url, { maxDepth, limit })
  return Array.isArray(res.results) ? res.results : []
}

export async function extractUrl(url: string): Promise<{ url: string; title: string; markdown: string }> {
  const c = await client()
  const res = await c.extract([url], { format: 'markdown' })
  const markdown = (res.results?.[0]?.rawContent ?? '').trim()
  if (!markdown) throw new Error('No content extracted')
  return { url, title: deriveTitle(markdown, url), markdown }
}

function deriveTitle(markdown: string, url: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)
  if (h1?.[1]) return h1[1].trim().slice(0, 200)
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`.replace(/\/$/, '').slice(0, 200) || url.slice(0, 200)
  } catch {
    return url.slice(0, 200)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/tavily.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tavily.ts tests/unit/lib/tavily.test.ts
git commit -m "feat: add server-only Tavily wrapper (map + extract)"
```

---

### Task 3: Shared ingestion tail (`src/lib/ingest.ts`) + refactor `documents/process`

**Files:**
- Create: `src/lib/ingest.ts`
- Modify: `src/app/api/documents/process/route.ts` (imports line 2-4, shared chunk line 114, new-upload block lines 146-161)
- Test: `tests/unit/lib/ingest.test.ts` (new) + the existing `tests/unit/api/documents-process.test.ts` must stay green.

**Interfaces:**
- Consumes: `saveDocumentChunks`, `updateChunkEmbedding`, `updateDocumentStatus` (`@/app/actions`); `generateEmbedding` (`@/lib/embeddings`); `chunkText` (`@/lib/chunking`).
- Produces: `ingestText(doc: { id: number; projectId: number }, textContent: string, opts: { extractionMethod: 'text' | 'vision'; thumbnailPath?: string }): Promise<{ status: 'ready' | 'error'; chunkCount: number }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/ingest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  saveDocumentChunks: vi.fn(), updateChunkEmbedding: vi.fn(), updateDocumentStatus: vi.fn(),
  generateEmbedding: vi.fn(), chunkText: vi.fn(),
}

async function importIngest() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    saveDocumentChunks: m.saveDocumentChunks, updateChunkEmbedding: m.updateChunkEmbedding, updateDocumentStatus: m.updateDocumentStatus,
  }))
  vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: m.generateEmbedding }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: m.chunkText }))
  return (await import('@/lib/ingest')).ingestText
}

describe('ingestText', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.chunkText.mockReturnValue([{ index: 0, content: 'chunk' }])
    m.saveDocumentChunks.mockResolvedValue([{ id: 11, content: 'chunk' }])
    m.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1))
    m.updateChunkEmbedding.mockResolvedValue(undefined)
    m.updateDocumentStatus.mockResolvedValue(undefined)
  })

  it('chunks, saves, embeds, sets status ready', async () => {
    const ingestText = await importIngest()
    const res = await ingestText({ id: 7, projectId: 1 }, 'hello body', { extractionMethod: 'text' })
    expect(res).toEqual({ status: 'ready', chunkCount: 1 })
    expect(m.chunkText).toHaveBeenCalledWith('hello body')
    expect(m.saveDocumentChunks).toHaveBeenCalledWith([{ documentId: 7, projectId: 1, chunkIndex: 0, content: 'chunk' }])
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ chunkCount: 1, charCount: 10, extractionMethod: 'text' }))
  })

  it('all embeddings failing → status error', async () => {
    m.generateEmbedding.mockRejectedValue(new Error('embed down'))
    const ingestText = await importIngest()
    const res = await ingestText({ id: 8, projectId: 1 }, 'body', { extractionMethod: 'text' })
    expect(res.status).toBe('error')
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(8, 'error', expect.objectContaining({ chunkCount: 1 }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/ingest.test.ts`
Expected: FAIL with "Cannot find module '@/lib/ingest'".

- [ ] **Step 3: Create `src/lib/ingest.ts`**

```ts
// Shared post-extraction tail: chunk → save → embed → status. Used by the file
// upload pipeline (documents/process) and web ingestion (documents/web-ingest)
// so both share one source of truth. Server-only (imports server actions).
import { saveDocumentChunks, updateChunkEmbedding, updateDocumentStatus } from '@/app/actions'
import { generateEmbedding } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'

export async function ingestText(
  doc: { id: number; projectId: number },
  textContent: string,
  opts: { extractionMethod: 'text' | 'vision'; thumbnailPath?: string },
): Promise<{ status: 'ready' | 'error'; chunkCount: number }> {
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
    console.warn(`[ingest] ${results.length - embedded}/${saved.length} chunks failed to embed`)
  }
  const status: 'ready' | 'error' = embedded === 0 && saved.length > 0 ? 'error' : 'ready'
  await updateDocumentStatus(doc.id, status, {
    chunkCount: saved.length, charCount: textContent.length,
    thumbnailPath: opts.thumbnailPath, extractionMethod: opts.extractionMethod,
  })
  return { status, chunkCount: saved.length }
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run tests/unit/lib/ingest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor `documents/process/route.ts` to use `ingestText`**

(a) Imports — replace line 2 and add the ingest import:

```ts
import { getDocumentById, updateDocumentStatus, createDocumentRevision, commitDocumentReplacement } from '@/app/actions'
import { generateEmbedding, ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { ingestText } from '@/lib/ingest'
```

(b) Delete the shared chunk line (current line 114): `const textChunks = chunkText(textContent)`.

(c) Inside `if (isReplace) {` add it as the first line of the block:

```ts
    if (isReplace) {
      const textChunks = chunkText(textContent)
      // Replace: embed FIRST (no destructive writes yet) ...
```

(d) Replace the new-upload block (current lines 146-161, from `// New upload: save chunks then embed in place.` through its `return NextResponse.json(...)`) with:

```ts
    // New upload: chunk → save → embed → status via the shared ingestion tail.
    const { status, chunkCount } = await ingestText({ id: doc.id, projectId: doc.projectId }, textContent, { extractionMethod, thumbnailPath })
    return NextResponse.json({ documentId: doc.id, status, revision: doc.revision, chunkCount, charCount: textContent.length })
```

- [ ] **Step 6: Run the process route tests to verify the refactor is behavior-preserving**

Run: `npx vitest run tests/unit/api/documents-process.test.ts`
Expected: PASS (all existing tests green — the real `ingestText` runs under the test's existing `@/app/actions` / `@/lib/embeddings` / `@/lib/chunking` mocks).

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/lib/ingest.ts src/app/api/documents/process/route.ts tests/unit/lib/ingest.test.ts
git commit -m "refactor: extract shared ingestText tail from documents/process"
```

---

### Task 4: `POST /api/documents/web-map` route (+ schema)

**Files:**
- Modify: `src/lib/validation.ts` (add `webMapRequestSchema`)
- Create: `src/app/api/documents/web-map/route.ts`
- Test: `tests/unit/api/documents-web-map.test.ts`

**Interfaces:**
- Consumes: `isTavilyConfigured`, `mapSite` (Task 2).
- Produces: `POST` handler returning `{ urls: string[]; configured: boolean }` (200), `{ error }` (400 invalid, 502 map failure).

- [ ] **Step 1: Add the Zod schema**

In `src/lib/validation.ts` append:

```ts
export const webMapRequestSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(1).max(3).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const webIngestRequestSchema = z.object({
  url: z.string().url(),
  projectId: z.number().int().positive(),
})
```

(Both schemas added now; Task 5 uses `webIngestRequestSchema`.)

- [ ] **Step 2: Write the failing test**

Create `tests/unit/api/documents-web-map.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = { isTavilyConfigured: vi.fn(), mapSite: vi.fn() }

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/tavily', () => ({ isTavilyConfigured: m.isTavilyConfigured, mapSite: m.mapSite }))
  return (await import('@/app/api/documents/web-map/route')).POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/documents/web-map', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/web-map', () => {
  beforeEach(() => { Object.values(m).forEach(f => f.mockReset()) })

  it('400 on an invalid URL', async () => {
    const POST = await importRoute()
    expect((await POST(req({ url: 'not-a-url' }) as never)).status).toBe(400)
  })

  it('returns configured:false with no key (no map call)', async () => {
    m.isTavilyConfigured.mockResolvedValue(false)
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://site.com' }) as never)
    const data = await res.json()
    expect(data).toEqual({ urls: [], configured: false })
    expect(m.mapSite).not.toHaveBeenCalled()
  })

  it('maps and returns urls', async () => {
    m.isTavilyConfigured.mockResolvedValue(true)
    m.mapSite.mockResolvedValue(['https://a', 'https://b'])
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://site.com', limit: 10 }) as never)
    const data = await res.json()
    expect(data).toEqual({ urls: ['https://a', 'https://b'], configured: true })
  })

  it('502 when mapping throws', async () => {
    m.isTavilyConfigured.mockResolvedValue(true)
    m.mapSite.mockRejectedValue(new Error('tavily down'))
    const POST = await importRoute()
    expect((await POST(req({ url: 'https://site.com' }) as never)).status).toBe(502)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/api/documents-web-map.test.ts`
Expected: FAIL with "Cannot find module '.../web-map/route'".

- [ ] **Step 4: Write the route**

Create `src/app/api/documents/web-map/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { isTavilyConfigured, mapSite } from '@/lib/tavily'
import { webMapRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  try {
    const parsed = webMapRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if (!(await isTavilyConfigured())) return NextResponse.json({ urls: [], configured: false })
    const urls = await mapSite(parsed.data.url, { maxDepth: parsed.data.maxDepth, limit: parsed.data.limit })
    return NextResponse.json({ urls, configured: true })
  } catch (error) {
    return apiError(error, 'Failed to map site', 502)
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/api/documents-web-map.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation.ts src/app/api/documents/web-map/route.ts tests/unit/api/documents-web-map.test.ts
git commit -m "feat: add /api/documents/web-map route (Tavily site map)"
```

---

### Task 5: `POST /api/documents/web-ingest` route

**Files:**
- Create: `src/app/api/documents/web-ingest/route.ts`
- Test: `tests/unit/api/documents-web-ingest.test.ts`

**Interfaces:**
- Consumes: `isTavilyConfigured`, `extractUrl` (Task 2); `ingestText` (Task 3); `createUploadingDocument`, `updateDocumentStatus`, `updateDocumentStoragePath`, `getDocumentById` (`@/app/actions`); `ensureEmbeddingModel` (`@/lib/embeddings`); `isStorageConfigured`, `uploadBuffer`, `createSignedDownloadUrl`, `DOCUMENT_URL_TTL_SECONDS` (`@/lib/storage`); `MAX_TEXT_LENGTH` (`@/lib/fileExtraction`); `webIngestRequestSchema` (Task 4).
- Produces: `POST` handler returning `{ document: DocumentSummary; status }` (200); 503 (no key / no storage / no embed provider), 422 (empty extraction), 400 (invalid), 500 (failure, row marked `error`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api/documents-web-ingest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  isTavilyConfigured: vi.fn(), extractUrl: vi.fn(), ingestText: vi.fn(),
  createUploadingDocument: vi.fn(), updateDocumentStatus: vi.fn(), updateDocumentStoragePath: vi.fn(), getDocumentById: vi.fn(),
  ensureEmbeddingModel: vi.fn(), isStorageConfigured: vi.fn(), uploadBuffer: vi.fn(), createSignedDownloadUrl: vi.fn(),
}

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/tavily', () => ({ isTavilyConfigured: m.isTavilyConfigured, extractUrl: m.extractUrl }))
  vi.doMock('@/lib/ingest', () => ({ ingestText: m.ingestText }))
  vi.doMock('@/app/actions', () => ({
    createUploadingDocument: m.createUploadingDocument, updateDocumentStatus: m.updateDocumentStatus,
    updateDocumentStoragePath: m.updateDocumentStoragePath, getDocumentById: m.getDocumentById,
  }))
  vi.doMock('@/lib/embeddings', () => ({ ensureEmbeddingModel: m.ensureEmbeddingModel }))
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: m.isStorageConfigured, uploadBuffer: m.uploadBuffer,
    createSignedDownloadUrl: m.createSignedDownloadUrl, DOCUMENT_URL_TTL_SECONDS: 3600,
  }))
  vi.doMock('@/lib/fileExtraction', () => ({ MAX_TEXT_LENGTH: 100_000 }))
  return (await import('@/app/api/documents/web-ingest/route')).POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/documents/web-ingest', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/web-ingest', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.isTavilyConfigured.mockResolvedValue(true)
    m.isStorageConfigured.mockReturnValue(true)
    m.ensureEmbeddingModel.mockResolvedValue({ available: true })
    m.extractUrl.mockResolvedValue({ url: 'https://x.com/a', title: 'Page A', markdown: '# Page A\n\nbody' })
    m.createUploadingDocument.mockResolvedValue([{ id: 42, projectId: 1 }])
    m.updateDocumentStatus.mockResolvedValue(undefined)
    m.updateDocumentStoragePath.mockResolvedValue(undefined)
    m.uploadBuffer.mockResolvedValue(undefined)
    m.ingestText.mockResolvedValue({ status: 'ready', chunkCount: 2 })
    m.getDocumentById.mockResolvedValue({ id: 42, projectId: 1, filename: 'Page A', mimeType: 'text/markdown', status: 'ready', chunkCount: 2, extractionMethod: 'text' })
    m.createSignedDownloadUrl.mockResolvedValue('https://signed/source.md')
  })

  it('503 with no Tavily key', async () => {
    m.isTavilyConfigured.mockResolvedValue(false)
    const POST = await importRoute()
    expect((await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)).status).toBe(503)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('422 when extraction is empty (no row created)', async () => {
    m.extractUrl.mockRejectedValue(new Error('No content extracted'))
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(422)
    expect(m.createUploadingDocument).not.toHaveBeenCalled()
  })

  it('happy path: creates a markdown doc, stores source.md, ingests, returns the document', async () => {
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ready')
    expect(data.document).toMatchObject({ id: 42, mimeType: 'text/markdown', url: 'https://signed/source.md' })
    expect(m.createUploadingDocument).toHaveBeenCalledWith(expect.objectContaining({ projectId: 1, mimeType: 'text/markdown', filename: 'Page A' }))
    expect(m.uploadBuffer).toHaveBeenCalledWith('documents/1/42/source.md', expect.any(Buffer), 'text/markdown')
    expect(m.ingestText).toHaveBeenCalledWith({ id: 42, projectId: 1 }, expect.stringContaining('Source: https://x.com/a'), { extractionMethod: 'text' })
    // secret-handling: the key never appears in the response body
    expect(JSON.stringify(data)).not.toMatch(/tvly-/)
  })

  it('marks the row error and returns 500 when ingestion throws', async () => {
    m.ingestText.mockRejectedValue(new Error('db down'))
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://x.com/a', projectId: 1 }) as never)
    expect(res.status).toBe(500)
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(42, 'error', expect.objectContaining({ errorMessage: expect.any(String) }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/api/documents-web-ingest.test.ts`
Expected: FAIL with "Cannot find module '.../web-ingest/route'".

- [ ] **Step 3: Write the route**

Create `src/app/api/documents/web-ingest/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { isTavilyConfigured, extractUrl } from '@/lib/tavily'
import { ingestText } from '@/lib/ingest'
import { createUploadingDocument, updateDocumentStatus, updateDocumentStoragePath, getDocumentById } from '@/app/actions'
import { ensureEmbeddingModel } from '@/lib/embeddings'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, DOCUMENT_URL_TTL_SECONDS } from '@/lib/storage'
import { MAX_TEXT_LENGTH } from '@/lib/fileExtraction'
import { webIngestRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  let docId: number | null = null
  try {
    const parsed = webIngestRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { url, projectId } = parsed.data

    if (!(await isTavilyConfigured())) return NextResponse.json({ error: 'Set a Tavily API key in Settings.' }, { status: 503 })
    if (!isStorageConfigured()) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 503 })
    if (!(await ensureEmbeddingModel()).available) return NextResponse.json({ error: 'No embedding provider available. Set a Gemini API key.' }, { status: 503 })

    let title: string
    let markdown: string
    try {
      ({ title, markdown } = await extractUrl(url))
    } catch {
      return NextResponse.json({ error: 'No content could be extracted from that URL.' }, { status: 422 })
    }

    let text = `Source: ${url}\n\n${markdown}`
    if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH)

    const [doc] = await createUploadingDocument({
      projectId, filename: title, mimeType: 'text/markdown', fileSize: Buffer.byteLength(text, 'utf-8'),
    })
    docId = doc.id
    await updateDocumentStatus(doc.id, 'processing')

    const storagePath = `documents/${projectId}/${doc.id}/source.md`
    await uploadBuffer(storagePath, Buffer.from(text, 'utf-8'), 'text/markdown')
    await updateDocumentStoragePath(doc.id, storagePath)

    const { status } = await ingestText({ id: doc.id, projectId }, text, { extractionMethod: 'text' })

    const fresh = await getDocumentById(doc.id)
    const url_ = await createSignedDownloadUrl(storagePath, DOCUMENT_URL_TTL_SECONDS).catch(() => null)
    return NextResponse.json({ document: { ...fresh, url: url_, thumbnailUrl: null }, status })
  } catch (error) {
    if (docId) await updateDocumentStatus(docId, 'error', { errorMessage: 'Failed to ingest URL.' }).catch(() => {})
    return apiError(error, 'Failed to ingest URL', 500)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/api/documents-web-ingest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documents/web-ingest/route.ts tests/unit/api/documents-web-ingest.test.ts
git commit -m "feat: add /api/documents/web-ingest route (URL → project document)"
```

---

### Task 6: `useWebIngest` client hook

**Files:**
- Create: `src/hooks/useWebIngest.ts`
- Test: `tests/hooks/useWebIngest.test.ts`

**Interfaces:**
- Produces: `useWebIngest()` → `{ mapSite(url, opts?) => Promise<{ urls: string[]; configured: boolean }>, ingestUrl(url, projectId) => Promise<DocumentSummary>, ingestUrls(urls, projectId, onResult, concurrency?) => Promise<void>, busy: boolean }`. `onResult` is `(r: { url: string; document?: DocumentSummary; error?: string }) => void`.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useWebIngest.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebIngest } from '@/hooks/useWebIngest'

describe('useWebIngest', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('mapSite posts to web-map and returns the payload', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ urls: ['https://a'], configured: true }) })
    const { result } = renderHook(() => useWebIngest())
    let out!: { urls: string[]; configured: boolean }
    await act(async () => { out = await result.current.mapSite('https://site.com') })
    expect(out).toEqual({ urls: ['https://a'], configured: true })
    expect(fetch).toHaveBeenCalledWith('/api/documents/web-map', expect.objectContaining({ method: 'POST' }))
  })

  it('ingestUrls fires onResult per url (success and error)', async () => {
    ;(fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ document: { id: 1, filename: 'A' } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) })
    const { result } = renderHook(() => useWebIngest())
    const seen: Array<{ url: string; ok: boolean }> = []
    await act(async () => {
      await result.current.ingestUrls(['https://a', 'https://b'], 1, (r) => seen.push({ url: r.url, ok: !!r.document }), 1)
    })
    expect(seen).toContainEqual({ url: 'https://a', ok: true })
    expect(seen).toContainEqual({ url: 'https://b', ok: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/useWebIngest.test.ts`
Expected: FAIL with "Cannot find module '@/hooks/useWebIngest'".

- [ ] **Step 3: Write the hook**

Create `src/hooks/useWebIngest.ts`:

```ts
'use client'
import { useState, useCallback } from 'react'
import type { DocumentSummary } from '@/types'

/** Map a site + per-page ingest of web URLs into a project (mirrors useDocumentUpload). */
export function useWebIngest() {
  const [busy, setBusy] = useState(false)

  const mapSite = useCallback(async (
    url: string, opts?: { maxDepth?: number; limit?: number },
  ): Promise<{ urls: string[]; configured: boolean }> => {
    const res = await fetch('/api/documents/web-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...opts }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Map failed')
    return res.json()
  }, [])

  const ingestUrl = useCallback(async (url: string, projectId: number): Promise<DocumentSummary> => {
    const res = await fetch('/api/documents/web-ingest', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, projectId }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Ingest failed')
    return (await res.json()).document
  }, [])

  const ingestUrls = useCallback(async (
    urls: string[], projectId: number,
    onResult: (r: { url: string; document?: DocumentSummary; error?: string }) => void,
    concurrency = 3,
  ): Promise<void> => {
    setBusy(true)
    try {
      const queue = [...urls]
      const worker = async () => {
        for (;;) {
          const url = queue.shift()
          if (!url) return
          try { onResult({ url, document: await ingestUrl(url, projectId) }) }
          catch (e) { onResult({ url, error: e instanceof Error ? e.message : 'Ingest failed' }) }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) || 1 }, worker))
    } finally {
      setBusy(false)
    }
  }, [ingestUrl])

  return { mapSite, ingestUrl, ingestUrls, busy }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hooks/useWebIngest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWebIngest.ts tests/hooks/useWebIngest.test.ts
git commit -m "feat: add useWebIngest hook (map + per-page ingest)"
```

---

### Task 7: `AddFromWebDialog` + integrate into `ProjectDocumentsDialog`

**Files:**
- Create: `src/components/ui/AddFromWebDialog.tsx`
- Modify: `src/components/ui/ProjectDocumentsDialog.tsx` (add a trigger button + render the dialog + refresh on done)
- Test: `tests/hooks/AddFromWebDialog.test.tsx`

**Interfaces:**
- Consumes: `useWebIngest` (Task 6); `DocumentSummary` (`@/types`).
- Produces: `AddFromWebDialog({ open, onOpenChange, projectId, onIngested })` where `onIngested: () => void` is called after any successful ingest so the host can reload its document grid.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/AddFromWebDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const map = vi.fn()
const ingestUrls = vi.fn()
vi.mock('@/hooks/useWebIngest', () => ({
  useWebIngest: () => ({ mapSite: map, ingestUrl: vi.fn(), ingestUrls, busy: false }),
}))

import { AddFromWebDialog } from '@/components/ui/AddFromWebDialog'

describe('AddFromWebDialog', () => {
  beforeEach(() => { map.mockReset(); ingestUrls.mockReset() })

  it('single-page mode ingests the entered URL', async () => {
    ingestUrls.mockImplementation(async (urls, _pid, onResult) => { onResult({ url: urls[0], document: { id: 1 } }) })
    const onIngested = vi.fn()
    render(<AddFromWebDialog open onOpenChange={() => {}} projectId={1} onIngested={onIngested} />)
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByRole('button', { name: /add page/i }))
    await waitFor(() => expect(ingestUrls).toHaveBeenCalledWith(['https://x.com/a'], 1, expect.any(Function), expect.anything()))
    await waitFor(() => expect(onIngested).toHaveBeenCalled())
  })

  it('crawl mode maps then lists discovered pages', async () => {
    map.mockResolvedValue({ urls: ['https://x.com/a', 'https://x.com/b'], configured: true })
    render(<AddFromWebDialog open onOpenChange={() => {}} projectId={1} onIngested={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /crawl site/i }))
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /find pages/i }))
    await waitFor(() => expect(screen.getByText('https://x.com/a')).toBeTruthy())
  })

  it('shows the no-key hint when map returns configured:false', async () => {
    map.mockResolvedValue({ urls: [], configured: false })
    render(<AddFromWebDialog open onOpenChange={() => {}} projectId={1} onIngested={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /crawl site/i }))
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /find pages/i }))
    await waitFor(() => expect(screen.getByText(/Tavily API key/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/AddFromWebDialog.test.tsx`
Expected: FAIL with "Cannot find module '@/components/ui/AddFromWebDialog'".

- [ ] **Step 3: Write the component**

Create `src/components/ui/AddFromWebDialog.tsx` (Radix Dialog shell like `ProjectDocumentsDialog`, but **semantic tokens only**):

```tsx
'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Globe, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useWebIngest } from '@/hooks/useWebIngest'

interface AddFromWebDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  onIngested: () => void
}

type Mode = 'single' | 'crawl'

export function AddFromWebDialog({ open, onOpenChange, projectId, onIngested }: AddFromWebDialogProps) {
  const { mapSite, ingestUrls, busy } = useWebIngest()
  const [mode, setMode] = useState<Mode>('single')
  const [url, setUrl] = useState('')
  const [mapping, setMapping] = useState(false)
  const [noKey, setNoKey] = useState(false)
  const [found, setFound] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(0)

  const reset = () => { setUrl(''); setFound([]); setSelected(new Set()); setNoKey(false); setDone(0) }

  const handleClose = (o: boolean) => { if (!o) reset(); onOpenChange(o) }

  const runIngest = async (urls: string[]) => {
    let ok = 0
    await ingestUrls(urls, projectId, (r) => {
      setDone(d => d + 1)
      if (r.document) { ok++; onIngested() }
      else toast.error(`Failed: ${r.url}`)
    })
    if (ok > 0) toast.success(`Added ${ok} page${ok !== 1 ? 's' : ''} from the web`)
  }

  const handleAddSingle = async () => {
    if (!url.trim()) return
    await runIngest([url.trim()])
    handleClose(false)
  }

  const handleFindPages = async () => {
    if (!url.trim()) return
    setMapping(true); setNoKey(false); setFound([])
    try {
      const { urls, configured } = await mapSite(url.trim())
      if (!configured) { setNoKey(true); return }
      setFound(urls)
      setSelected(new Set(urls))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not map that site')
    } finally {
      setMapping(false)
    }
  }

  const toggle = (u: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(u)) next.delete(u); else next.add(u)
    return next
  })

  const handleIngestSelected = async () => {
    const urls = found.filter(u => selected.has(u))
    if (urls.length === 0) return
    await runIngest(urls)
    handleClose(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-foreground/30 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg glass-panel rounded-2xl p-6 z-50 shadow-xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Add from web
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 mb-4 bg-muted rounded-lg" role="tablist">
            <button role="tab" aria-selected={mode === 'single'} onClick={() => { setMode('single'); reset() }}
              className={cn('flex-1 text-sm py-1.5 rounded-md transition-colors', mode === 'single' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
              Single page
            </button>
            <button role="tab" aria-selected={mode === 'crawl'} onClick={() => { setMode('crawl'); reset() }}
              className={cn('flex-1 text-sm py-1.5 rounded-md transition-colors', mode === 'crawl' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
              Crawl site
            </button>
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/page"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />

          {mode === 'single' ? (
            <button onClick={handleAddSingle} disabled={busy || !url.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add page
            </button>
          ) : (
            <div className="flex flex-col min-h-0">
              <button onClick={handleFindPages} disabled={mapping || !url.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-secondary hover:bg-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-3">
                {mapping && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Find pages
              </button>

              {noKey && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Set a Tavily API key in Settings → API Keys to crawl sites.
                </p>
              )}

              {found.length > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>{selected.size} of {found.length} selected</span>
                    <button className="hover:text-foreground" onClick={() => setSelected(selected.size === found.length ? new Set() : new Set(found))}>
                      {selected.size === found.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0 space-y-1 mb-3 max-h-64">
                    {found.map(u => (
                      <label key={u} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                        <input type="checkbox" checked={selected.has(u)} onChange={() => toggle(u)} />
                        <span className="truncate">{u}</span>
                      </label>
                    ))}
                  </div>
                  <button onClick={handleIngestSelected} disabled={busy || selected.size === 0}
                    className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Ingesting {done}/{selected.size}…</> : <><Check className="h-3.5 w-3.5" /> Ingest {selected.size} page{selected.size !== 1 ? 's' : ''}</>}
                  </button>
                </>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `npx vitest run tests/hooks/AddFromWebDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into `ProjectDocumentsDialog`**

In `src/components/ui/ProjectDocumentsDialog.tsx`:

(a) Add imports:

```tsx
import { Globe } from 'lucide-react'
import { AddFromWebDialog } from '@/components/ui/AddFromWebDialog'
```

(b) Add state near the other `useState` calls (after line 30):

```tsx
  const [webOpen, setWebOpen] = useState(false)
```

(c) Add an "Add from web" button directly under the upload zone `</div>` (after line 152, before the `{/* Document list */}` comment):

```tsx
          <button
            onClick={() => setWebOpen(true)}
            className="mb-4 -mt-1 self-start flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Globe className="h-4 w-4" /> Add from web
          </button>
```

(d) Render the dialog next to `DocumentPreviewDialog` (after line 187):

```tsx
          <AddFromWebDialog
            open={webOpen}
            onOpenChange={setWebOpen}
            projectId={projectId}
            onIngested={loadDocuments}
          />
```

- [ ] **Step 6: Typecheck + run the UI tests + commit**

Run: `npm run typecheck && npx vitest run tests/hooks/AddFromWebDialog.test.tsx`
Expected: 0 type errors; component tests PASS.

```bash
git add src/components/ui/AddFromWebDialog.tsx src/components/ui/ProjectDocumentsDialog.tsx tests/hooks/AddFromWebDialog.test.tsx
git commit -m "feat: add AddFromWebDialog and wire it into ProjectDocumentsDialog"
```

---

### Task 8: Tavily field in the Settings → API Keys tab

**Files:**
- Modify: `src/components/settings/ApiKeysSettingsTab.tsx`
- Test: `tests/hooks/ApiKeysSettingsTab-tavily.test.tsx`

**Interfaces:**
- Consumes: `getApiKeyStatus` (now returns `{ gemini, anthropic, tavily }`, Task 1), `setSettings` (`@/app/actions`).

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/ApiKeysSettingsTab-tavily.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getStatus = vi.fn()
const setSettings = vi.fn()
vi.mock('@/app/actions', () => ({ getApiKeyStatus: getStatus, setSettings }))

import { ApiKeysSettingsTab } from '@/components/settings/ApiKeysSettingsTab'

describe('ApiKeysSettingsTab — Tavily', () => {
  beforeEach(() => {
    getStatus.mockReset(); setSettings.mockReset()
    getStatus.mockResolvedValue({ gemini: false, anthropic: false, tavily: false })
    setSettings.mockResolvedValue(undefined)
  })

  it('renders a Tavily key field and saves it', async () => {
    render(<ApiKeysSettingsTab />)
    const input = await screen.findByPlaceholderText(/tvly-/i)
    fireEvent.change(input, { target: { value: 'tvly-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /save keys/i }))
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(
      expect.arrayContaining([{ key: 'tavily-api-key', value: 'tvly-secret' }]),
    ))
  })

  it('shows Configured when status.tavily is true', async () => {
    getStatus.mockResolvedValue({ gemini: false, anthropic: false, tavily: true })
    render(<ApiKeysSettingsTab />)
    expect(await screen.findByText(/Web ingestion/i)).toBeTruthy()
    // a Configured chip is present for the Tavily section
    expect(screen.getAllByText(/Configured/i).length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/ApiKeysSettingsTab-tavily.test.tsx`
Expected: FAIL — no `tvly-` placeholder field exists yet.

- [ ] **Step 3: Add the Tavily field**

In `src/components/settings/ApiKeysSettingsTab.tsx`:

(a) Widen the status type + add input state (lines 14-16):

```tsx
  const [status, setStatus] = useState<{ gemini: boolean; anthropic: boolean; tavily: boolean } | null>(null)
  const [anthropicInput, setAnthropicInput] = useState('')
  const [geminiInput, setGeminiInput] = useState('')
  const [tavilyInput, setTavilyInput] = useState('')
```

(b) In `handleSave`, push the Tavily entry and clear it (after the gemini push, line 26, and after `setGeminiInput('')`, line 32):

```tsx
    if (tavilyInput.trim()) entries.push({ key: 'tavily-api-key', value: tavilyInput.trim() })
```
```tsx
      setTavilyInput('')
```

(c) Add a field block after the Gemini block (after line 86), mirroring the existing fields but with semantic tokens:

```tsx
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Tavily API Key</label>
          {status.tavily && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Web ingestion — pull a URL or site into a project&apos;s documents. Stored securely; never read back into this field.</p>
        <input
          type="password"
          value={tavilyInput}
          onChange={(e) => setTavilyInput(e.target.value)}
          placeholder={status.tavily ? 'Enter a new key to replace' : 'tvly-...'}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
```

(d) Update the Save button's `disabled` condition to include the Tavily input (line 90):

```tsx
        disabled={saving || (!anthropicInput.trim() && !geminiInput.trim() && !tavilyInput.trim())}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hooks/ApiKeysSettingsTab-tavily.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ApiKeysSettingsTab.tsx tests/hooks/ApiKeysSettingsTab-tavily.test.tsx
git commit -m "feat: add Tavily API key field to settings"
```

---

### Task 9: Full gate + docs sweep

**Files:**
- Modify: `CHANGELOG.md` (new v4.32.0 entry — defer the version/tag until the user approves release)

- [ ] **Step 1: Run the full verification gate**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: typecheck 0 errors; lint 0 errors (≤26 warnings); build clean; **all** Vitest suites green (including the unchanged `documents-process` tests).

- [ ] **Step 2: Add the CHANGELOG entry (Unreleased / v4.32.0)**

Add a `## v4.32.0` section summarizing: "Add from web" — single-URL + Map-first site crawl ingestion into project RAG via Tavily (`@tavily/core`); shared `ingestText` tail; server-only Tavily key under `SENSITIVE_KEYS`; no DB migration.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for web ingestion (v4.32.0)"
```

---

## Self-Review

**Spec coverage:** Goal/flow → Tasks 4-7; `getTavilyApiKey`/`SENSITIVE_KEYS`/status → Task 1; `tavily.ts` map+extract → Task 2; shared `ingestText` + process refactor → Task 3; `web-map`/`web-ingest` routes + schemas → Tasks 4-5; `useWebIngest` → Task 6; `AddFromWebDialog` + integration → Task 7; settings field → Task 8; secret-handling → enforced in Tasks 1/2/5/8 with explicit assertions (`getSetting` blocked, key never in `web-ingest` response, status-only UI); testing/gate/DoD → Task 9.

**Deviations from spec (intentional, noted):** (1) `server-only` is by convention, not the npm package (the repo doesn't use it; `lib/storage.ts` is the precedent). (2) Only `ProjectDocumentsDialog` is modified, not `ProjectLandingPage` — the landing page routes document management through that dialog via `onAddFiles`, so one integration point covers both surfaces. (3) The `DocumentCard` "web" badge is omitted from v1 as cosmetic-only (no reliable no-migration signal); ingested pages still show title + chunk count and carry the `Source:` header in their extracted text.

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** `ingestText(doc, text, opts)` signature identical in Tasks 3/5; `getApiKeyStatus` returns `{ gemini, anthropic, tavily }` in Tasks 1/8; `useWebIngest` `onResult` shape identical in Tasks 6/7; `webIngestRequestSchema`/`webMapRequestSchema` defined in Task 4, consumed in Tasks 4/5.

## Release (user-gated, after the gate is green)
On the user's go: bump `package.json` to **4.32.0**, finalize `CHANGELOG.md`, merge `feat/web-ingestion` → `master` (`--no-ff`), tag `v4.32.0`, push `master` + tag, `gh release create`, watch CI. No migration to apply. No env-var changes needed for deploy unless setting `TAVILY_API_KEY` in Vercel (otherwise users set it in-app via Settings).
