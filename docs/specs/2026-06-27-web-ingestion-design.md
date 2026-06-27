# Web ingestion — "Add from web" (URL + site-crawl → project RAG) — Design

**Status:** Approved design (2026-06-27). Branch: `feat/web-ingestion` (off `master`, post v4.31.1). Targets release **v4.32.0**. This is "Design B" from the Tavily research (handoff `docs/SESSION_HANDOFF_2026-06-26-1734.md`).

## Goal

From a project's Files surface, let the user pull web content into the project's RAG store:

- **Add from URL** — paste a single page URL → its clean text becomes a project document (chunked + embedded), retrievable as chat context.
- **Crawl a site** — paste a site URL → we **Map** it (cheap, lists URLs without extracting) → the user **picks** which discovered pages to ingest → each selected page is extracted and ingested as its own document, with **live status in the existing document grid**.

Web content flows through the **same** `chunk → embed → pgvector` pipeline as uploaded files. Powered by Tavily (`@tavily/core`), gated behind a server-only `getTavilyApiKey()`. The win for a construction superintendent: pull a manufacturer's spec page, a code section, or a docs site into a project so the assistant can cite it — without downloading and uploading PDFs.

## Decisions (locked)

- **Provider: Tavily `@tavily/core`** (official JS SDK). `tavily({ apiKey })`, per-request client (mirrors `createProvider`). Verified API surface: `client.map(url, {maxDepth, limit, …})` → `{ results: string[] }`; `client.extract([url], { format: "markdown" })` → `{ results: [{ url, rawContent }] }`.
- **Crawl UX = "Map first, you pick pages."** No auto-crawl, no `client.crawl()` combined mode.
- **Client-orchestrated, per-page ingest.** Map returns URLs; the browser loops, calling a single-URL ingest endpoint once per selected page (mirrors the existing `useDocumentUpload` per-file loop). One small request per page (well under the 300s function limit), per-page error isolation, live grid status.
- **One document per page.** Each ingested page is its own `documents` row — independently retrievable and citeable.
- **No DB migration (v1).** Reuse the `documents` / `documentChunks` tables as-is. Source URL is recorded by: `filename` = page title, `mimeType` = `text/markdown`, and a `Source: <url>` header line prepended into the extracted text (so it survives into chunks). A dedicated `source_url` column is deferred to v2 if needed.
- **Store the extracted markdown in Storage** at `documents/<projectId>/<id>/source.md` so `DocumentPreviewDialog` ("Preview" / "Open original") works and matches uploaded docs.
- **`extractionMethod = 'text'`** for all web docs (Tavily returns clean markdown, not vision OCR).
- **Reuse the existing ingestion tail.** Factor `process/route.ts` lines 146–159 into a shared `ingestText()` and call it from both the file-process route and the new web-ingest route (one source of truth).

## Non-goals

- No `web_extract` chat tool (Claude pulling a URL mid-conversation) — that was the optional "Design A" the user declined for v1.
- No replacing the existing web search (Claude native `web_search` + Google grounding stay as-is).
- No `client.crawl()` auto-crawl mode; no scheduled re-crawl / refresh of ingested pages.
- No `@tavily/ai-sdk` dependency, no Tavily Search.
- No new DB column, no `documentRevisions` use for web docs (no replace/re-version flow in v1).
- No authenticated / paywalled page handling beyond what Tavily returns.

## Secret handling (hard requirement — "do not expose any keys anywhere")

The Tavily key follows the app's `SENSITIVE_KEYS` discipline and stays **fully server-side** (Tavily has no browser-side use at all — unlike Supabase Storage's anon key):

1. **Server-only access.** `getTavilyApiKey()` in `src/lib/settings.ts`; `src/lib/tavily.ts` is server-only **by convention** — never imported by any client component, exactly like `src/lib/storage.ts` (the `server-only` npm package isn't used in this repo). The key is read only inside the route handlers.
2. **Blocked from client reads.** `'tavily-api-key'` is added to `SENSITIVE_KEYS` (`src/app/actions.ts`) so `getSetting()` / `getSettings()` refuse to return it to client code.
3. **Status, not value.** The Settings → API Keys field is write-only; the UI shows only a configured/not boolean via `getApiKeyStatus()`. The stored value is never returned to the browser.
4. **Never on the wire / in the bundle.** The browser sends only URLs to our routes. No `NEXT_PUBLIC_*` for this key; it never appears in responses, the DOM, or client JS.
5. **Never logged or echoed.** Excluded from all logs and error messages; responses go through `apiError()` (sanitized). Not in commits, this spec, or examples; `.env.local` stays gitignored.

## Current state (what we build on)

- **3-step file upload** establishes the pattern: `upload-url` creates a `documents` row → browser PUTs to Storage → `process` extracts → chunk → embed → status. We reuse the **tail** of `process`.
- **`src/app/api/documents/process/route.ts` lines 146–159** (new-upload path): `saveDocumentChunks` → `Promise.allSettled(generateEmbedding → updateChunkEmbedding)` → `updateDocumentStatus(status, { chunkCount, charCount, thumbnailPath, extractionMethod })`. **This is the reusable tail.**
- **`src/lib/settings.ts`** — `getServerSetting(key, envFallback)` (DB-first, env fallback, cached); `getGeminiApiKey()` / `getAnthropicApiKey()` are the pattern to mirror.
- **`src/app/actions.ts`** — `SENSITIVE_KEYS` guard in `getSetting`/`getSettings`; `getApiKeyStatus()` returns booleans only; document actions `createUploadingDocument`, `updateDocumentStoragePath`, `updateDocumentStatus`, `saveDocumentChunks`, `updateChunkEmbedding`, `getDocumentById`.
- **`src/lib/storage.ts`** (server-only, service role) — `uploadBuffer(path, buf, contentType)`, `createSignedDownloadUrl`, `sanitizeStorageName`, `isStorageConfigured`.
- **`src/lib/chunking.ts`** `chunkText(text)` ; **`src/lib/embeddings.ts`** `generateEmbedding(text, 'document')`, `ensureEmbeddingModel()`.
- **`src/lib/validation.ts`** — Zod schema per route; **`src/lib/errors.ts`** `apiError()`.
- **UI:** `src/hooks/useDocumentUpload.ts` (3-step loop, the orchestration pattern to mirror); `src/components/chat/DocumentCard.tsx` (status spinner → ready, signed `thumbnailUrl`/`url`); `ProjectDocumentsDialog` (modal) + `ProjectLandingPage` (Files panel) both render the grid and own an upload entry point; `src/types.ts` `DocumentSummary` (canonical shape returned by `GET /api/documents`).

## Data model

**No migration.** Reuse `documents` + `documentChunks`. A web document is a normal `documents` row:

| column | web-ingest value |
| --- | --- |
| `filename` | page title (fallback: the URL) |
| `mimeType` | `text/markdown` |
| `fileSize` | byte length of extracted markdown |
| `storagePath` | `documents/<projectId>/<id>/source.md` |
| `thumbnailPath` | `null` (no thumbnail for web text) |
| `extractionMethod` | `'text'` |
| `status` | `processing` → `ready` \| `error` |

Chunks include the `Source: <url>` header (in chunk 0), so retrieval/citations carry provenance with no schema change.

## Flow

### Tavily wrapper (`src/lib/tavily.ts`, server-only)
- `isTavilyConfigured(): Promise<boolean>` — `!!(await getTavilyApiKey())`.
- `mapSite(url, { maxDepth?, limit? }): Promise<string[]>` — `client.map(url, { maxDepth, limit })`, returns `results`. Bounds `limit` (≤ `WEB_MAP_LIMIT`, default 100); `maxDepth` default 2.
- `extractUrl(url): Promise<{ url: string; title: string; markdown: string }>` — `client.extract([url], { format: 'markdown' })`; title = first `# ` heading in markdown, else the URL host+path. Throws a sanitized error on empty/failed extraction.
- Throws a clear "Tavily API key not configured" if no key (callers convert to a friendly response).

### `POST /api/documents/web-map` (key-guarded)
Request `{ url: string(url), maxDepth?: number, limit?: number }`.
1. Validate (`webMapRequestSchema`). No Tavily key → `{ urls: [], configured: false }` 200 (silent degrade; UI shows the "set a key" hint).
2. `mapSite(url, { maxDepth, limit })` → `{ urls }`. Errors → `apiError(…, 'Failed to map site', 502)`.

### `POST /api/documents/web-ingest` (key-guarded; one page)
Request `{ url: string(url), projectId: number }`.
1. Validate (`webIngestRequestSchema`). Guards: Tavily key present (else 503 "Set a Tavily API key"), `ensureEmbeddingModel().available` (else 503), `isStorageConfigured()` (else 503).
2. `extractUrl(url)` → `{ title, markdown }`. Empty → 422 "No content extracted" (no row created).
3. Prepend `Source: ${url}\n\n` to the markdown; clamp to `MAX_TEXT_LENGTH`.
4. `createUploadingDocument({ projectId, filename: title, mimeType: 'text/markdown', fileSize: bytes })` → row id; immediately `updateDocumentStatus(id, 'processing')`.
5. `uploadBuffer('documents/<projectId>/<id>/source.md', Buffer.from(text), 'text/markdown')`; `updateDocumentStoragePath(id, path)`.
6. **`ingestText(doc, text, { extractionMethod: 'text' })`** (shared tail). Returns final status.
7. Return the `DocumentSummary` (with a signed `url`) so the client swaps its optimistic card for the real one. Wrap in `try/catch` → on failure set the row to `error` (if created) and `apiError(…, 'Failed to ingest URL', 500)`.

### Shared tail — `src/lib/ingest.ts` (server-only)
`ingestText(doc, textContent, { extractionMethod, thumbnailPath? })`:
- `saveDocumentChunks(chunkText(textContent).map(…))` → `Promise.allSettled(generateEmbedding → updateChunkEmbedding)` → `updateDocumentStatus(doc.id, embedded === 0 && chunks > 0 ? 'error' : 'ready', { chunkCount, charCount, thumbnailPath, extractionMethod })`. Returns `{ status, chunkCount }`.
- **Refactor `process/route.ts`** new-upload path (lines 146–159) to call `ingestText` (identical behavior; the replace path stays as-is in v1).

### Client orchestration (`src/hooks/useWebIngest.ts`)
- `mapSite(url, opts)` → calls `web-map`, returns urls (+ `configured` flag).
- `ingestUrls(urls: string[], projectId)` → for each url, POST `web-ingest`; push an optimistic `processing` card, replace with the returned summary (or mark error) as each resolves; bounded concurrency (e.g. 3 at a time) to be gentle on credits + the embed API. Exposes progress for the dialog.

## Validation (`src/lib/validation.ts`)
- `webMapRequestSchema`: `{ url: z.string().url(), maxDepth: z.number().int().min(1).max(3).optional(), limit: z.number().int().min(1).max(100).optional() }`.
- `webIngestRequestSchema`: `{ url: z.string().url(), projectId: z.number().int().positive() }`.

## Settings / key plumbing
- `getTavilyApiKey()` in `src/lib/settings.ts` → `getServerSetting('tavily-api-key', 'TAVILY_API_KEY')`.
- Add `'tavily-api-key'` to `SENSITIVE_KEYS`; extend `getApiKeyStatus()` to include `tavily: boolean`.
- Add a **Tavily** write-only field + configured/not status to `src/components/settings/ApiKeysSettingsTab.tsx`, mirroring the Gemini/Anthropic fields exactly.
- Document `TAVILY_API_KEY` in `CLAUDE.md` Environment Setup. Env knobs: `WEB_MAP_LIMIT` (default 100), `WEB_MAP_MAX_DEPTH` (default 2).

## Types & UI
- **`src/types.ts`** — no change to `DocumentSummary` needed (web docs reuse it). Optional cosmetic: a "web" badge in `DocumentCard` keyed on `mimeType === 'text/markdown'` (accepted minor collision with an uploaded `.md`; revisit with a column in v2).
- **`AddFromWebDialog`** (`src/components/ui/AddFromWebDialog.tsx`) — URL input + mode toggle:
  - **Single page** → `ingestUrls([url], projectId)`, close.
  - **Crawl site** → `mapSite(url)` → checklist of discovered URLs (select-all, count, capped) → **Ingest selected** → `ingestUrls(selected, projectId)`. Shows a credit-aware hint ("~N pages"). No-key state shows the "Set a Tavily API key in Settings" hint.
- **"Add from web"** button beside the upload zone in `ProjectDocumentsDialog` (the project landing page routes document management through this dialog via `onAddFiles`, so one integration point covers both surfaces). Ingested docs appear in the same `DocumentCard` grid; the dialog refreshes the grid on completion (same as upload).

## File layout (new / changed)
```
src/
├─ app/
│  ├─ api/documents/web-map/route.ts      # NEW — Tavily map (key-guarded)
│  ├─ api/documents/web-ingest/route.ts   # NEW — extract one URL → document (key-guarded)
│  ├─ api/documents/process/route.ts      # refactor new-upload tail → ingestText()
│  └─ actions.ts                          # + 'tavily-api-key' in SENSITIVE_KEYS; getApiKeyStatus() + tavily
├─ lib/
│  ├─ tavily.ts                           # NEW — server-only Tavily wrapper (map/extract)
│  ├─ ingest.ts                           # NEW — server-only shared ingestText() tail
│  ├─ settings.ts                         # + getTavilyApiKey()
│  └─ validation.ts                       # + webMapRequestSchema, webIngestRequestSchema
├─ hooks/useWebIngest.ts                  # NEW — map + per-URL ingest loop (mirrors useDocumentUpload)
├─ components/
│  ├─ ui/AddFromWebDialog.tsx             # NEW — URL / crawl-pick dialog
│  ├─ ui/ProjectDocumentsDialog.tsx       # + "Add from web" entry (covers landing page too via onAddFiles)
│  └─ settings/ApiKeysSettingsTab.tsx     # + Tavily write-only field + status
package.json                              # + @tavily/core
```

## Testing
- **Unit (`tavily.ts`, mock `@tavily/core`):** `mapSite` returns `results` and clamps `limit`; `extractUrl` parses title from the first heading and falls back to the URL; empty extraction throws; no key → throws/guarded.
- **Unit (`ingest.ts`, PGlite):** chunks saved + embedded; status `ready`; all-embeddings-fail → `error`; `process/route.ts` still behaves identically after the refactor (existing process tests stay green).
- **Unit (routes, mock Tavily + embeddings + storage, PGlite):**
  - `web-map`: no key → `{ urls: [], configured: false }`; happy path returns urls; map error → 502.
  - `web-ingest`: no key → 503; empty extract → 422 (no row); happy path creates a `text/markdown` doc, uploads `source.md`, embeds chunks, returns a `DocumentSummary`; ingest failure marks the row `error`.
  - **Secret-handling assertions:** `getSetting('tavily-api-key')` (client path) is blocked by `SENSITIVE_KEYS`; `getApiKeyStatus()` returns a boolean and never the value; no route response body contains the key.
- **Validation:** `webMap`/`webIngest` schemas reject bad URLs, oversized `limit`, missing `projectId`.
- **Component (`AddFromWebDialog`, jsdom):** single-page mode calls ingest; crawl mode maps then ingests selected; no-key state shows the hint.
- All existing tests stay green; lint 0 errors (26 baseline warnings ok); build clean; PGlite suite green.

## Verification gate
`npm run typecheck` (0) · `npm run lint` (0 errors) · `npm run build` · `npm test`. E2E runs in CI only. **Manual smoke (browser, real Tavily key in Settings):** in a project → "Add from web" → paste a single URL → a `ready` card appears; open it → "Extracted text" shows the content with the `Source:` header, "Open original" serves the `.md`. Then "Crawl site" → Map lists pages → select a few → cards stream `processing → ready`. Open a chat in the project and confirm the assistant retrieves/cites the ingested content. With **no** Tavily key set, "Add from web" shows the friendly hint and never errors.

## Risks / mitigations
- **Key exposure** — addressed by the Secret-handling section (server-only module, `SENSITIVE_KEYS`, status-only UI, sanitized errors); covered by explicit tests.
- **Credit spend on crawl** — Map-first + user selection + capped `limit`; mapping a failed request isn't billed; credit-aware hint in the dialog. Free tier (1,000 credits/mo) covers normal use (map ≈ 1cr/10 pages, extract ≈ 1cr/5 pages).
- **Nebius acquisition of Tavily** — re-verify pricing/SDK before merge; the wrapper isolates the provider so a swap (Firecrawl, etc.) is contained to `src/lib/tavily.ts`.
- **Long crawl / many pages** — per-page requests stay small; client bounds concurrency; selection is capped.
- **JS-rendered / paywalled pages** — Tavily handles most; empty extraction → a clean 422, no orphan row.
- **`process/route.ts` refactor regression** — the new-upload tail is behavior-preserving; existing process tests guard it.

## Definition of done
"Add from web" appears on both Files surfaces; single-URL and Map-first crawl ingest pages into the project as `text/markdown` documents through the shared `ingestText` tail; ingested content is retrievable/citeable in project chats; the Tavily key is server-only, blocked from client reads, status-only in the UI, and never logged or returned; feature degrades silently with no key; gate green. Released as **v4.32.0**.
