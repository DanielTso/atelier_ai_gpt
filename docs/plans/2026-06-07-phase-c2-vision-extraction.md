# Phase C2 — Vision extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Frame implementers by role (Backend / QA / Reviewer / Docs). Steps use checkbox (`- [ ]`).

**Goal:** When an uploaded PDF has no usable text layer (scanned/drawing) or is an image, render its pages and use a vision model to extract the content, feeding it into the existing chunk→embed→pgvector pipeline.

**Architecture:** A new `src/lib/visionExtraction.ts` renders PDF pages (pdfjs-dist@5 legacy + @napi-rs/canvas, scale 3) and extracts each via Gemini Flash vision (`generateText` with an image content part), best-effort per page with a page cap. `/api/documents` calls it as a fallback when text extraction is empty/thin, and for image uploads. Downstream (chunk/embed/store/retrieve) is unchanged.

**Tech Stack:** Next.js 16, AI SDK v6 (`@ai-sdk/google` `generateText` image parts), unpdf + pdfjs-dist@^5 + @napi-rs/canvas, Vitest.

**Spike-validated facts (do not re-derive):** `gemini-3.5-flash` reads real IFC plans well; use `maxOutputTokens: 8000`; render `scale: 3`; pdfjs **legacy** build import `pdfjs-dist/legacy/build/pdf.mjs`; `@napi-rs/canvas` must be 0.1.x (unpdf peer); `pdfjs-dist` must be v5 (v6 breaks). Image content part shape that worked: `{ type: 'image', image: <Uint8Array> }`.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json` | Promote `pdfjs-dist@^5` + `@napi-rs/canvas@^0.1.69` from devDeps → **dependencies** (runtime render) |
| `src/lib/visionExtraction.ts` (new) | Render PDF pages + per-page Gemini-vision extraction; env knobs; best-effort + page cap |
| `src/lib/fileExtraction.ts` (modify) | Add image extensions (`png/jpg/jpeg/webp`) to supported types; export an `isImageExtension` helper |
| `src/app/api/documents/route.ts` (modify) | Vision fallback when text is empty/thin (PDF) or input is an image |
| Tests | `visionExtraction` unit (mock render + model); documents-route vision-path |
| `CLAUDE.md`, `CHANGELOG.md`, chatlog | Docs |

**Env knobs (read in `visionExtraction.ts`, defaults from the spike):** `EXTRACTION_MODEL` (default `gemini-3.5-flash`), `EXTRACTION_MAX_PAGES` (default `30`), `EXTRACTION_RENDER_SCALE` (default `3`), `EXTRACTION_MAX_OUTPUT_TOKENS` (default `8000`), `EXTRACTION_MIN_TEXT_CHARS` (default `100` — below this a PDF is treated as "needs vision").

---

## Task 1: Promote render deps to dependencies (Backend)

**Files:** `package.json`

- [ ] **Step 1:** Move `pdfjs-dist` and `@napi-rs/canvas` from `devDependencies` to `dependencies` (they now run at request time, not just in the spike). Pin: `"pdfjs-dist": "^5.7.284"`, `"@napi-rs/canvas": "^0.1.69"`. Run `npm install` to refresh the lockfile.
- [ ] **Step 2:** `npm run build` — expect clean.
- [ ] **Step 3:** Commit: `git add package.json package-lock.json && git commit -m "build(phase-c2): promote pdfjs-dist + @napi-rs/canvas to dependencies"`

---

## Task 2: visionExtraction module (Backend)

**Files:** Create `src/lib/visionExtraction.ts`, `tests/unit/lib/visionExtraction.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/visionExtraction.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockRender = vi.fn()

function setup(key: string | null = 'k', numPages = 2) {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
  vi.doMock('unpdf', () => ({
    definePDFJSModule: () => Promise.resolve(),
    getDocumentProxy: () => Promise.resolve({ numPages }),
    renderPageAsImage: (...a: unknown[]) => mockRender(...a),
  }))
}

describe('extractViaVision', () => {
  beforeEach(() => { mockGenerateText.mockReset(); mockRender.mockReset() })

  it('renders each page and concatenates per-page extractions', async () => {
    setup('k', 2)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText
      .mockResolvedValueOnce({ text: 'PAGE ONE TEXT' })
      .mockResolvedValueOnce({ text: 'PAGE TWO TEXT' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out).toContain('PAGE ONE TEXT')
    expect(out).toContain('PAGE TWO TEXT')
    expect(mockRender).toHaveBeenCalledTimes(2)
  })

  it('returns empty string when no API key', async () => {
    setup(null, 2)
    const { extractViaVision } = await import('@/lib/visionExtraction')
    expect(await extractViaVision(Buffer.from('pdf'))).toBe('')
    expect(mockRender).not.toHaveBeenCalled()
  })

  it('caps pages at EXTRACTION_MAX_PAGES', async () => {
    process.env.EXTRACTION_MAX_PAGES = '1'
    setup('k', 5)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText.mockResolvedValue({ text: 'X' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    await extractViaVision(Buffer.from('pdf'))
    expect(mockRender).toHaveBeenCalledTimes(1)
    delete process.env.EXTRACTION_MAX_PAGES
  })

  it('tolerates a per-page failure and keeps going', async () => {
    setup('k', 2)
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    mockGenerateText
      .mockRejectedValueOnce(new Error('page 1 boom'))
      .mockResolvedValueOnce({ text: 'PAGE TWO OK' })
    const { extractViaVision } = await import('@/lib/visionExtraction')
    const out = await extractViaVision(Buffer.from('pdf'))
    expect(out).toContain('PAGE TWO OK')
  })

  it('extractViaVisionImage sends a single image directly', async () => {
    setup('k')
    mockGenerateText.mockResolvedValue({ text: 'IMAGE TEXT' })
    const { extractViaVisionImage } = await import('@/lib/visionExtraction')
    const out = await extractViaVisionImage(Buffer.from('img'), 'image/png')
    expect(out).toBe('IMAGE TEXT')
    expect(mockRender).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/unit/lib/visionExtraction.test.ts`)

- [ ] **Step 3: Implement** — `src/lib/visionExtraction.ts` (based on the validated spike)

```ts
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'

const EXTRACTION_PROMPT =
  'You are reading a single page of a construction document (plan/drawing/schedule). ' +
  'Transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
  'notes, callouts, and any schedule/table contents (preserve table structure as markdown). ' +
  'Then add a short paragraph describing what the drawing depicts. Do not invent content.'

function num(v: string | undefined, d: number) { const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d }

function cfg() {
  return {
    model: process.env.EXTRACTION_MODEL || 'gemini-3.5-flash',
    maxPages: num(process.env.EXTRACTION_MAX_PAGES, 30),
    scale: num(process.env.EXTRACTION_RENDER_SCALE, 3),
    maxOutputTokens: num(process.env.EXTRACTION_MAX_OUTPUT_TOKENS, 8000),
  }
}

async function extractImage(image: Uint8Array, model: string, maxOutputTokens: number, apiKey: string): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({
    model: google(model),
    messages: [{ role: 'user', content: [{ type: 'text', text: EXTRACTION_PROMPT }, { type: 'image', image }] }],
    maxOutputTokens,
  })
  return text.trim()
}

/** Render each PDF page and vision-extract it. Best-effort; '' if no key. */
export async function extractViaVision(buffer: Buffer): Promise<string> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return ''
  const { model, maxPages, scale, maxOutputTokens } = cfg()
  const { definePDFJSModule, getDocumentProxy, renderPageAsImage } = await import('unpdf')
  await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(buffer)
  const pdf = await getDocumentProxy(data)
  const total = Math.min(pdf.numPages, maxPages)
  if (pdf.numPages > maxPages) {
    console.warn(`[visionExtraction] capping at ${maxPages}/${pdf.numPages} pages`)
  }
  const parts: string[] = []
  for (let page = 1; page <= total; page++) {
    try {
      const ab = await renderPageAsImage(data, page, { canvasImport: () => import('@napi-rs/canvas'), scale })
      const text = await extractImage(new Uint8Array(ab), model, maxOutputTokens, apiKey)
      if (text) parts.push(`# Page ${page}\n${text}`)
    } catch (err) {
      console.warn(`[visionExtraction] page ${page} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return parts.join('\n\n')
}

/** Vision-extract a single uploaded image. Best-effort; '' if no key. */
export async function extractViaVisionImage(buffer: Buffer, _mimeType: string): Promise<string> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return ''
  const { model, maxOutputTokens } = cfg()
  try {
    return await extractImage(new Uint8Array(buffer), model, maxOutputTokens, apiKey)
  } catch (err) {
    console.warn('[visionExtraction] image failed:', err instanceof Error ? err.message : err)
    return ''
  }
}
```

> Note: the test mocks `unpdf` so `pdfjs-dist`/`@napi-rs/canvas` aren't loaded in unit tests. Concurrency is intentionally sequential for simplicity + rate-limit safety; a bounded-concurrency pass is a later optimization.

- [ ] **Step 4: Run — expect PASS (5/5)**
- [ ] **Step 5: Commit:** `git add src/lib/visionExtraction.ts tests/unit/lib/visionExtraction.test.ts && git commit -m "feat(phase-c2): vision extraction module (render + Gemini Flash)"`

---

## Task 3: Image support in fileExtraction (Backend)

**Files:** Modify `src/lib/fileExtraction.ts`

- [ ] **Step 1:** Add image extensions + an `isImageExtension` helper. Add to `SUPPORTED_EXTENSIONS`: `'png', 'jpg', 'jpeg', 'webp'`. Append:

```ts
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext)
}
```

Also update `isSupported` so image MIME types count: in `isSupported`, after the text-prefix check add `if (mimeType.startsWith('image/')) return true`.

- [ ] **Step 2:** Typecheck: `npx tsc --noEmit 2>&1 | grep fileExtraction || echo clean`
- [ ] **Step 3:** Commit: `git add src/lib/fileExtraction.ts && git commit -m "feat(phase-c2): accept image uploads (png/jpg/webp)"`

---

## Task 4: Wire vision fallback into /api/documents (Backend)

**Files:** Modify `src/app/api/documents/route.ts`

> READ the current route first. It currently: validates file/size/`isSupported` → `ensureEmbeddingModel` → `extractTextFromBuffer(buffer, ext)` → truncates to `MAX_TEXT_LENGTH` → **errors if `!textContent.trim()`** → `createDocument` → `chunkText` → save → embed.

- [ ] **Step 1:** Add imports: `import { extractViaVision, extractViaVisionImage } from '@/lib/visionExtraction'` and `import { isImageExtension } from '@/lib/fileExtraction'`. Add `EXTRACTION_MIN_TEXT_CHARS` read: `const MIN_TEXT = Number(process.env.EXTRACTION_MIN_TEXT_CHARS) || 100`.

- [ ] **Step 2:** Replace the extraction block. Current shape:
```ts
let textContent = await extractTextFromBuffer(buffer, ext)
if (textContent.length > MAX_TEXT_LENGTH) textContent = textContent.slice(0, MAX_TEXT_LENGTH)
if (!textContent.trim()) {
  return NextResponse.json({ error: 'No text content could be extracted from the file.' }, { status: 400 })
}
```
becomes:
```ts
let textContent = ''
if (isImageExtension(ext) || file.type.startsWith('image/')) {
  // Image upload → vision directly.
  textContent = await extractViaVisionImage(buffer, file.type)
} else {
  textContent = await extractTextFromBuffer(buffer, ext)
  // Scanned/drawing PDF: thin/empty text layer → fall back to vision per page.
  if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
    const vision = await extractViaVision(buffer)
    if (vision.trim().length > textContent.trim().length) textContent = vision
  }
}
if (textContent.length > MAX_TEXT_LENGTH) textContent = textContent.slice(0, MAX_TEXT_LENGTH)
if (!textContent.trim()) {
  return NextResponse.json({ error: 'No text content could be extracted (text layer empty and vision extraction unavailable — set a Gemini key).' }, { status: 400 })
}
```

- [ ] **Step 3:** Verify the documents-route test still passes; add a vision-path test (mock `@/lib/visionExtraction`: text-PDF path doesn't call vision; empty-text PDF path uses vision result; image path uses `extractViaVisionImage`). Run: `npx vitest run tests/unit/api/` (and the documents-route test specifically if one exists; if not, add `tests/unit/api/documents-route.test.ts` mocking `@/db`, `@/lib/settings`, `@/lib/embeddings`, `@/lib/fileExtraction`, `@/lib/visionExtraction`).
- [ ] **Step 4:** Commit: `git add src/app/api/documents/route.ts tests/unit/api/ && git commit -m "feat(phase-c2): vision fallback for scanned PDFs + image uploads"`

---

## Task 5: Documentation (Docs)

- [ ] Update `CLAUDE.md` (`/api/documents` + Context Pipeline: vision fallback, `EXTRACTION_*` env knobs, gemini-3.5-flash, pdfjs@5+napi-canvas render). Add a CHANGELOG `[4.2.0]` entry. Write `docs/chatlog-2026-06-07-phase-c2.md`. Commit.

---

## Task 6: Gate + Vercel native-canvas check (QA/DevOps)

- [ ] **Step 1:** Full gate: `npm run lint && npm run build && npm test && npm run test:e2e`. Expect green.
- [ ] **Step 2: ⚠️ Vercel native-dep check (the one real deploy risk).** Deploy a **preview** (`vercel`) and upload a scanned/drawing PDF, OR confirm `@napi-rs/canvas` loads in the Vercel Node runtime. If `@napi-rs/canvas` fails to load/build on Vercel Fluid Compute, switch the render step to the **client-side pdf.js fallback** (browser renders page images, uploads them; server skips `renderPageAsImage`). This is the documented fallback in the Phase C spec.
- [ ] **Step 3: Manual smoke:** upload `GradingPlanIFC.pdf` in the running app → confirm it processes to "ready" with chunks, then ask the chat a question answerable from the plan and confirm it cites it.
- [ ] **Step 4:** Tag: `git tag -a phase-c2 -m "Phase C2: vision extraction"`

---

## Self-review

**Spec coverage:** vision model + tokens + scale (validated, Task 2) · render deps promoted (T1) · trigger on empty text / image (T4) · image support (T3) · page cap + best-effort (T2) · downstream unchanged (no retrieval edits) · Vercel native-dep risk (T6) · docs (T5). ✅
**Placeholders:** module + tests shown in full; route edit shows exact before/after; Task 4's documents-route test is described with the mocks to use (the implementer reads the current route first — its exact text wasn't re-inlined here). ✅
**Types:** `extractViaVision(buffer)`, `extractViaVisionImage(buffer, mime)`, `isImageExtension(ext)`, `EXTRACTION_*` env — consistent across tasks. ✅
**Deferred (own sub-phases):** C-storage (Supabase Storage for originals/thumbnails), C3 (UI: thumbnails/status), bounded-concurrency render optimization.
