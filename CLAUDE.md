# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start a new session by reading the latest `docs/SESSION_HANDOFF_<date>.md`** (currently `docs/SESSION_HANDOFF_2026-07-07.md`) — it is the authoritative current-state bootstrap (where the build is, what shipped, live infra, open items). This CLAUDE.md is the source of truth for *how the code works*; the handoff tracks *where the project is*.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Production build
npm run start        # Run production server
npm run lint         # Run ESLint
npm run typecheck    # tsc --noEmit (part of the verification gate)
npx drizzle-kit generate          # Author a migration from schema.ts changes
DIRECT_URL=... npx drizzle-kit migrate   # Apply migrations to Supabase (direct connection)
npm test             # Run Vitest unit/integration tests
npm run test:watch   # Run Vitest in watch mode
npm run test:e2e     # Run Playwright E2E tests (starts dev server automatically)
npm run test:all     # Run both Vitest and Playwright
npm run test:coverage # Vitest with coverage
npm run test:e2e:ui  # Playwright with interactive UI
```

Run a single test file:
```bash
npx vitest run tests/unit/lib/utils.test.ts        # Single Vitest file
npx playwright test e2e/chat.spec.ts                # Single Playwright file
npx vitest run tests/unit/api/                      # All tests in a directory
```

Path alias: `@/*` → `./src/*`.

**Verification gate** (run before tagging/shipping): `npm run typecheck` (0 errors) → `npm run lint` (0 errors; ~25 baseline warnings are fine) → `npm run build` → `npm test`. E2E (`npm run test:e2e`) runs in **CI only** — locally `.env.local` has the access gate ON and `DATABASE_URL` pointed at production Supabase, so live/manual smoke is done against prod, not a local dev server.

**Local code-style conventions (important):**
- **No Prettier config exists — never run `prettier --write`.** The codebase is hand-written **single-quote, no-semicolon**; a Prettier pass reformats whole files to double-quote+semicolon and creates massive spurious diffs. Make minimal, targeted edits that match the surrounding file (note: some older files still use semicolons — match the file you're in).
- **Tailwind v4.1**: the gradient utility is `bg-linear-to-br` (renamed from `bg-gradient-to-*`).
- **Header/CSP verification only works against prod** (`atelier-ai-app.vercel.app`). Vercel **preview** deployments sit behind Vercel Authentication, so `curl -I` of a preview returns Vercel's auth-page headers, not the app's.

## Environment Setup

Create `.env.local` with:
```
ANTHROPIC_API_KEY=your_key_here
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
DATABASE_URL=postgresql://...@...pooler.supabase.com:6543/postgres   # Supabase pooled (runtime)
DIRECT_URL=postgresql://...@...supabase.com:5432/postgres            # Supabase direct (migrations)

# Supabase Storage (Phase C-storage) — required for document originals + thumbnails
SUPABASE_URL=https://<project-ref>.supabase.co          # server-only
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here    # server-only; never expose to client
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co   # browser (signed upload)
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here             # browser (signed upload)
SUPABASE_STORAGE_BUCKET=atelier-files                   # default; create as a PRIVATE bucket
THUMBNAIL_WIDTH=600                                     # optional; default 600px WebP thumbnail

# Web ingestion (Design B, v4.32.0) — "Add from web" via Tavily. Server-only; OFF unless set.
TAVILY_API_KEY=your_tavily_key_here                     # or set in Settings → API Keys (DB-first); currently set in Vercel env
WEB_MAP_LIMIT=100                                       # optional; max URLs a site map returns
WEB_MAP_MAX_DEPTH=2                                     # optional; crawl depth for mapping

# Access gate (Phase 1 hardening) — single-password gate over the whole app.
# The gate is OFF unless APP_ACCESS_PASSWORD is set. See docs/AUTH.md.
APP_ACCESS_PASSWORD=your_access_password_here           # set to enable the gate
AUTH_SECRET=run_openssl_rand_hex_32                     # HMAC key for the auth cookie (recommended)
```

**Access gate:** single shared password over the whole app via `src/middleware.ts` (+ `/login`, `/api/auth`, `src/lib/auth.ts`). OFF unless `APP_ACCESS_PASSWORD` is set; signed httpOnly cookie = `HMAC-SHA256(AUTH_SECRET, …)`. Single-user app (no per-user data separation) — full per-user auth (Clerk + `ownerId` scoping) is a deferred, separate project. Full operating guide in [docs/AUTH.md](docs/AUTH.md).

**Storage access model:** bucket is **private**. `SUPABASE_SERVICE_ROLE_KEY` (server-only, never sent to client) creates signed upload tokens and mints signed download URLs. The browser uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` only to `uploadToSignedUrl` — it never has broad storage access.

The two AI keys can also be configured at runtime via the **Settings dialog → API Keys tab** (stored in the `settings` table). DB values take priority over `.env.local`.

**Web ingestion (Design B):** pull a URL/site into a project's RAG store via Tavily. Server-only; OFF unless set. Can also be set at runtime via Settings → API Keys.
```
TAVILY_API_KEY=your_tavily_key_here
WEB_MAP_LIMIT=100          # optional; max URLs a site map returns (default 100)
WEB_MAP_MAX_DEPTH=2        # optional; crawl depth for mapping (default 2)
```

**Note:** `.env*.local` files are gitignored. Never commit secrets.

The app uses two AI providers with a clear split — **Claude is the brain, Gemini is the senses**:
- **Anthropic Claude** (cloud, `@ai-sdk/anthropic`): the chat brain. Without an Anthropic key, no Claude chat models appear.
- **Google Gemini** (cloud, `@ai-sdk/google`): image generation (Nano Banana 2) + embeddings (RAG) only. Anthropic has **no embeddings API**, so embeddings always run on Gemini regardless of the chat model. Gemini text models are not user-selectable.

### Database

**Supabase Postgres** via Drizzle on `postgres-js` (`drizzle-orm/postgres-js`). Connection at `src/db/index.ts`: `postgres(DATABASE_URL, { prepare: false })` — `prepare: false` is **required** for Supabase's transaction pooler (no prepared statements). Use the **pooled** URL (`DATABASE_URL`, port 6543) at runtime and the **direct** URL (`DIRECT_URL`, port 5432) for migrations.

- Schema at `src/db/schema.ts` (`pg-core`): integer PKs via `GENERATED ALWAYS AS IDENTITY`, `timestamptz`, `boolean`, FK cascade deletes enforced natively (no `PRAGMA`). Tables: `projects` → `chats` → `messages`, `settings`, `messageEmbeddings`, `documents`, `documentChunks`, `documentRevisions`, `messageAttachments`, `personaUsage`, `chatTopics`, `artifacts`, `artifactVersions`, `memorySuggestions`, `generatedImages`. `projects` carries `memory`, `instructions`, and `updated_at` columns.
- **`memorySuggestions` table** — `id, project_id, chat_id, text, status (pending|accepted|dismissed), created_at` + index on `(project_id, status)`. Added by migration `drizzle/0008_busy_miss_america.sql`. `chat_id` is **SET NULL** on chat delete (project-level suggestions survive). Rows are auto-memory candidates created by `POST /api/memory/suggest`; accepting one appends to `projects.memory`.
- **pgvector**: `messageEmbeddings.embedding` and `documentChunks.embedding` are `vector(768)` with **HNSW** indexes (`vector_cosine_ops`). The `vector` extension is enabled by migration `drizzle/0000_enable_vector.sql`.
- **`documents.extraction_method`** — text column (`'text'` | `'vision'`), nullable; added by migration `drizzle/0004_sudden_ben_grimm.sql`. Set by `/api/documents/process`; surfaced in `GET /api/documents` and displayed as a badge in `DocumentCard`.
- **`artifacts` table** — `id, chat_id, project_id, type, title, storage_path, status, error_message, created_at` + index on `chat_id`. Added by migration `drizzle/0005_lyrical_onslaught.sql` (applied to live Supabase). Rows are created by the `generate_artifact` tool during a Claude chat turn and read back by `GET /api/artifacts?chatId=`.
- **Migrations** (versioned, in `drizzle/`): `npx drizzle-kit generate` to author, `DIRECT_URL=... npx drizzle-kit migrate` to apply. `drizzle.config.ts` uses `dialect: "postgresql"`. (Legacy `npx drizzle-kit push` is no longer the workflow.) Applied to Supabase: `0000`–`0012` (latest: `0010` `artifact_versions`, `0011` `projects.updated_at`, `0012` `generated_images`).

### Security

`getSetting()` and `getSettings()` server actions block the sensitive `gemini-api-key`, `anthropic-api-key`, and `tavily-api-key` from being read by client code (`SENSITIVE_KEYS`). Keys are only accessed server-side via `src/lib/settings.ts` (`getGeminiApiKey()`, `getAnthropicApiKey()`, `getTavilyApiKey()`). The `getApiKeyStatus()` server action returns booleans only (`{ gemini, anthropic, tavily }`, configured / not) so the API Keys UI can show status without exposing values. All POST API routes validate request bodies with Zod schemas; error responses are sanitized via `apiError()` helper (no raw error messages to clients). `POST /api/auth` (the access-gate login) is throttled by a best-effort in-memory login limiter (`src/lib/rateLimit.ts` — 10 failures / 15-min window per IP); it slows online password guessing but is per-instance, not distributed (add a Vercel WAF rule for a hard guarantee).

**Security headers (`next.config.ts`):** a CSP (with `'unsafe-inline'` — the Next 16 Turbopack nonce pipeline was attempted + found broken, see the inline comment), plus `X-Content-Type-Options: nosniff`, HSTS, and **`X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`** (relaxed from `DENY`/`'none'` so the app can frame its own same-origin PDF proxy at `/api/artifacts/:id/raw`; cross-origin framing of the app is still blocked). `frame-src`/`img-src` allow the Supabase origin. Note: Next's header `source` cannot negative-lookahead-exclude a path (that's the middleware matcher) — vary a header by relaxing the global value or setting it in the route handler.

## Architecture Overview

Atelier Studio is a Next.js 16 App Router chat application. **Claude (Anthropic) is the chat brain; Google Gemini handles image generation and embeddings.**

### Data Flow

1. **Client** (`src/app/page.tsx`) — Single-page chat UI using `useChat` from `@ai-sdk/react`. All application state lives here. A top-level `activeView` state (`AppView` = `home | projects | artifacts | images`) is driven by the left `SidebarNav` (New chat · Projects · Artifacts · Images · Customize/Settings) and swaps the main pane: **`home`** = the chat surface (active chat, project landing page, or the branded empty/home state with an always-visible input toolbar), **`projects`** = all-projects grid, **`artifacts`** = artifact gallery, **`images`** = the Images studio. Sending a message with no active chat auto-creates a standalone quick chat.
2. **Server Actions** (`src/app/actions.ts`) — "use server" functions for all DB reads/writes (CRUD for projects, chats, messages, settings, chat previews).
3. **API Routes**:
   - `POST /api/chat` — Streams LLM responses. Claude models (`claude-*`) route to Anthropic with **web search** enabled (`anthropic.tools.webSearch_20250305`). The Gemini image model (`*image*`) gets `responseModalities: ['TEXT', 'IMAGE']`. Applies five-layer context (see below). Default model fallback is `claude-opus-4-8`.
   - `GET /api/models` — Returns a static curated list (gated by key presence): Claude models when the Anthropic key is set (Opus 4.8 first → the default; then Fable 5, Sonnet 5, Haiku 4.5), Nano Banana 2 when the Gemini key is set. No Gemini text models. Cache-Control: 5 minutes.
   - `POST /api/summarize` — Compresses older messages. Auto-triggers at 30+ messages, keeps last 10 in full. Pinned to internal `gemini-3.5-flash` (housekeeping never burns Claude tokens).
   - `POST /api/embed` — Async 768-dim embedding generation via Gemini `gemini-embedding-001`. Best-effort after each exchange.
   - `POST /api/generate-title` — Auto-generates chat title (3-6 words) after first AI response. Pinned to internal `gemini-3.5-flash`.
   - `POST /api/extract` — Extracts text from files (PDF via `unpdf`, DOCX via `mammoth`, XLSX via `exceljs` — one tab-separated block per sheet, text/code via UTF-8). Max 200MB (`MAX_FILE_SIZE`; large construction plans). Vercel's platform request-body limit may cap below this on deploy — use the direct-upload flow (`/api/documents/upload-url` + `/api/documents/process`) for large files. **Supabase Storage must also allow the size:** the org is on the **Pro** plan, the `atelier-files` bucket `file_size_limit` is set to 200MB, and the **project-global Storage upload limit** (Supabase dashboard → Project Settings → Storage) must be ≥ 200MB or large signed uploads are rejected server-side.
   - **Document upload — 3-step direct-to-Storage flow (Phase C-storage):**
     - `POST /api/documents/upload-url` — validates name/type/size, creates a `documents` row with status `uploading`, returns `{ documentId, path, token, bucket }` for the browser.
     - Browser calls `uploadToSignedUrl` (`src/lib/storageClient.ts`, anon key) to PUT the file straight to Supabase Storage, bypassing the Vercel function request-body limit (large plans work).
     - `POST /api/documents/process` `{ documentId }` — downloads original from Storage, runs the C2 extract pipeline (text / thin-PDF vision fallback / image vision), uploads a WebP thumbnail, chunks + embeds, records `extraction_method` (`'text'` or `'vision'`), sets status `processing` → `ready | error`. The old inline `POST /api/documents` + `createDocument` action are retired.
   - `GET /api/documents` — returns each doc with short-lived signed `url` (original) + `thumbnailUrl` (best-effort, `null` if absent) + `extractionMethod` (`'text'` or `'vision'`). `DELETE /api/documents` — removes Storage objects (original + thumbnail) before deleting the DB row.
   - **Web ingestion — "Add from web" (Design B, v4.32.0):** `POST /api/documents/web-map` `{ url, maxDepth?, limit? }` → Tavily site map (`{ urls, configured }`, key-guarded); `POST /api/documents/web-ingest` `{ url, projectId }` → Tavily Extract → markdown → creates a `text/markdown` `documents` row (a `Source: <url>` header is prepended so provenance carries into chunks) → uploads `source.md` to Storage → runs the **shared `ingestText` tail** (chunk→embed→status). Status codes: 422 empty / 502 upstream Tavily failure / 503 no-key|storage|embeddings. The Tavily key is **server-only** (`getTavilyApiKey`, in `SENSITIVE_KEYS`, never returned/logged). Client orchestrates per-page via `useWebIngest`; UI is `AddFromWebDialog` (opened from the Files rail "Web" button + the Documents dialog).
   - `POST /api/classify` — LLM-based topic classification. Pinned to internal `gemini-3.5-flash` (tolerates a Claude `model` in the body). Cached in `chatTopics`.
   - `POST /api/memory/suggest` — **auto-memory** (suggest, you approve). Throttled best-effort pass (Gemini `gemini-3.5-flash`, never Claude tokens) that extracts durable project facts and stores them as pending `memorySuggestions`. Key-guarded (`{ created: 0 }` with no key), cap-gated at ~10 pending (`{ created: 0, capped: true }`, no model call), dedups against current `projects.memory` + pending + recently-dismissed. Triggered every 6 messages in a **project** chat from `page.tsx`'s `onFinish`; reviewed via the "Suggested memories" strip in `ProjectContextRail` (Accept appends to `projects.memory`, Edit, Dismiss). Never surfaces as a user error. Actions: `createMemorySuggestions`, `getPendingSuggestions`, `countPendingSuggestions`, `getRecentlyDismissed`, `acceptSuggestion(id, overrideText?)`, `dismissSuggestion`.
   - `GET /api/artifacts?chatId=` — returns all artifacts for a chat with short-lived signed `downloadUrl` per row. `DELETE /api/artifacts?id=` — removes the Storage object then the DB row.
   - `GET /api/artifacts/[id]/raw` — streams the artifact's stored file **same-origin** (`downloadToBuffer` → bytes, `Content-Type` by type, `Content-Disposition: inline`). The PDF preview embeds THIS, not the cross-origin Supabase signed URL — browsers increasingly block cross-origin PDFs in an `<iframe>` ("content is blocked"). Auth-gated by middleware. Pairs with the relaxed `X-Frame-Options: SAMEORIGIN` / CSP `frame-ancestors 'self'` (next.config) so the app can frame its own proxy.
   - **Images (Phase Images, v4.36.0):** `POST /api/images/generate` `{ prompt, aspectRatio?, projectId? }` — standalone Nano Banana 2 generation (no chat turn) → uploads to `images/<projectId|standalone>/<uuid>.<ext>` → inserts a `generated_images` row → returns `{ image }` (signed `url`). Guards: 400 invalid, 503 no Gemini key / no storage, 502 generation fail. Backed by the shared `src/lib/image/generate.ts` (`generateImageBytes`); actions `getGeneratedImages(projectId?)` / `deleteGeneratedImage(id)`; UI is the **Images** sidebar view (`ImagesView` — centered "Create images" hero + gallery, All/Standalone/per-project filter).

### Source Layout

- `src/app/page.tsx` — Single-page client; all application state lives here
- `src/app/actions.ts` — Server actions for all DB reads/writes
- `src/app/api/` — API routes (chat, models, embed, summarize, documents, etc.)
- `src/components/chat/sidebar/` — Decomposed sidebar: `Sidebar.tsx` (orchestrator), `types.ts` + `SidebarActionsContext.tsx` (shared types/context), section components (`QuickChatsSection`, `ProjectsSection`, `ArchivedSection`), item components (`ChatItem`, `ProjectItem`), layout (`SidebarHeader`, `SidebarFooter`, `CollapsedSidebar`, `SmartChatMenu`)
- `src/components/chat/` — Other chat components (MessagesList, ChatInputArea, ChatContextMenu, ProjectLandingPage, etc.)
- `src/components/chat/DocumentCard.tsx` — Shared thumbnail card for document grids: shows first-page WebP thumbnail (signed `thumbnailUrl`) with a file-type-tile fallback for text/code/docx; filename; status icon (spinners for `uploading`/`processing`, check for `ready`, alert for `error`); a `vision` chip when `extractionMethod === 'vision'`; chunk count; hover-to-reveal delete; click opens preview. Used in both `ProjectDocumentsDialog` and `ProjectLandingPage`.
- `src/components/chat/ArtifactCard.tsx` — Card for Claude-generated file artifacts: icon by type (xlsx/docx/pdf), title, type label, and a direct Download link using the signed `downloadUrl`. Rendered by `MessagesList` below assistant messages that produced artifacts.
- `src/components/ui/` — Reusable UI (dialogs, selectors, command palette)
- `src/components/ui/DocumentPreviewDialog.tsx` — Tabbed document preview: "Preview" tab shows the original file inline (images directly; PDFs in an `<iframe>` via the signed `url`; docx/text show text only) + "Extracted text" tab (existing chunk reconstruction). An "Open original" link is always available.
- `src/components/settings/` — Settings tab components
- `src/hooks/` — Custom hooks (useLocalStorage, usePersonas, useAppearanceSettings, etc.). **`useDialogs`** (the 10 dialog flags + 6 targets behind a per-dialog controller) and **`useChatPersistence`** (the `useChat` `onFinish` pipeline — save message/images/attachments, embed, persona usage, summarize, auto-memory, title, artifact re-fetch; unit-tested) were extracted from `page.tsx` in v4.33.0; **`useWebIngest`** drives "Add from web" (map + per-page ingest).
- `src/hooks/useDocumentUpload.ts` — Shared 3-step upload hook (request upload-url → `uploadToSignedUrl` → process). Used by both `ProjectDocumentsDialog` and `ProjectLandingPage`; fixes a regression where the landing page was still POSTing to the retired inline `/api/documents` endpoint.
- `src/lib/` — Utilities: `settings.ts` (DB-first/env-fallback config), `embeddings.ts` (pgvector search), `retrieval.ts` (RAG pipeline orchestrator), `ragConfig.ts` (tunable RAG knobs), `queryRewrite.ts` (conversational query rewrite), `rerank.ts` (LLM rerank), `mmr.ts` (diversity selection), `chunking.ts` (document chunker), `fileAttachments.ts` (image/file handling), `providers.ts` (shared AI provider factory), `fileExtraction.ts` (shared file parsing), `errors.ts` (API error helper), `validation.ts` (Zod request schemas), `storage.ts` (server-only Supabase Storage wrapper — `isStorageConfigured`, `createSignedUploadUrl`, `uploadBuffer`, `downloadToBuffer`, `createSignedDownloadUrl`, **`createSignedDownloadUrls`/`signedArtifactUrls`** (batch — one `createSignedUrls` request signs many vs N round-trips; HTML split for download-disposition; used by `getAllArtifacts`/`getGeneratedImages`/`getChatAttachments`/documents route), `removeObjects`; uses service-role key), `thumbnails.ts` (`generatePdfThumbnail` + `generateImageThumbnail` → WebP via `@napi-rs/canvas`, best-effort), `storageClient.ts` (browser-side anon-key Supabase client for `uploadToSignedUrl`), `tavily.ts` (server-only Tavily `mapSite`/`extractUrl` wrapper — web ingestion, key via `getTavilyApiKey`), `ingest.ts` (shared `ingestText` tail: chunk→save→embed→status, used by both `documents/process` and `documents/web-ingest`)
- `src/lib/artifacts/` — Artifact engine: `types.ts` (`ArtifactType` = `xlsx|docx|pdf|pptx|html`, `SheetSpec`, `RenderedArtifact`); `style.ts` (Atelier brand palette + per-library color/font helpers); `markdown.ts` (`parseMarkdown` → neutral AST via the `marked` lexer, plus `mdToPlainText`); `toXlsx.ts`/`toDocx.ts`/`toPdf.ts`/`toPptx.ts` (brand-styled renderers — styled headers, real tables, lists, page numbers; xlsx cells run through `mdToPlainText` so raw Markdown never leaks); HTML needs no renderer (the model's HTML string IS the file, `text/html`); `render.ts` (`renderArtifact(type, title, content)` dispatch); `tool.ts` — the AI SDK v6 `tool()` for `generate_artifact`. Claude calls it with `{ type, title, format, content }` (`format` = `markdown|sheets|html`); `execute` renders the file, uploads to `artifacts/<projectId|standalone>/<id>/<slug>.<ext>`, persists an `artifacts` row (+ seeds version 1), and returns `{ artifactId, title, type, downloadUrl }` (signed URL TTL `ARTIFACT_URL_TTL_SECONDS` = 24h). The tool is **chat-first**: only generate a file on an explicit file/web-page request, otherwise answer in chat. Wired into `/api/chat` for Claude when a `chatId` exists and Storage is configured.
- `src/lib/image/generate.ts` — shared `generateImageBytes(prompt, aspectRatio?) → { bytes, mediaType, ext }` (Nano Banana 2 `gemini-3.1-flash-image` via `generateText` + `responseModalities`; key-guarded with specific error messages). Used by BOTH the chat `generate_image` tool and the standalone `POST /api/images/generate` route (DRY).
- `src/lib/download.ts` — `downloadFile(url, filename)` blob-fetches a (cross-origin) URL and saves it on-page (the HTML `download` attr is ignored cross-origin), tab-fallback on CORS; `imageExt(mediaType)`. `src/components/ui/Lightbox.tsx` — shared portal-based (to `document.body`) image lightbox used by the Images gallery + chat (escapes ancestor stacking/overflow contexts).
- `src/lib/image/tool.ts` — the AI SDK v6 `tool()` for `generate_image`: Claude generates an image **inline** via Nano Banana 2 using `generateImageBytes`, uploads it to storage, and returns a small descriptor `{ storagePath, url, mediaType, filename, fileSize }` (no base64 in the conversation). `page.tsx`'s `onFinish` links it to the assistant message via `saveGeneratedImage` and renders it inline. Merged into the Claude tool set alongside `generate_artifact` (see `TOOL_GUIDANCE` in `/api/chat`).
- `src/types.ts` — Shared TypeScript interfaces (`Model`, `DocumentStatus`, `DocumentSummary`). `DocumentSummary` is the canonical document shape used across `ProjectDocumentsDialog`, `ProjectLandingPage`, and `DocumentCard`, replacing three former local `Document` interface duplicates.
- `src/db/` — `schema.ts` (Drizzle schema), `index.ts` (connection with FK enforcement)

### Context Pipeline (`/api/chat`)

Five layers, in order (all degrade gracefully if providers unavailable):
1. **System prompt** — Always included, never trimmed
2. **Document retrieval** — Top-3 similar document chunks (cosine ≥ 0.5) scoped to the project. Uses a single query embedding shared with semantic retrieval.
3. **Semantic retrieval** — Top-5 similar past messages (cosine ≥ 0.7) scoped to the project. Injected as synthetic context messages after document chunks.
4. **Summary** — Compressed older messages (auto-triggers at 30+ messages, keeps last 10 in full)
5. **Recent messages** — Last 20 messages in full detail

Embeddings: 768-dim vectors via Gemini `gemini-embedding-001`. `generateEmbedding()` accepts `taskType` (`'query'`/`'document'`) — Gemini uses this for optimization. Retrieval uses **native pgvector** (`findSimilarMessages`/`findSimilarDocumentChunks` run one indexed SQL query each via Drizzle's `cosineDistance`, backed by HNSW indexes).

**Advanced retrieval pipeline (Phase B2)** — `src/lib/retrieval.ts` `retrieveContext()` orchestrates: **query-rewrite** (`queryRewrite.ts`, Gemini Flash → standalone query) → embed → **vector top-N** (default 20) → **MMR** diversity (`mmr.ts`, λ 0.7) → **LLM rerank** (`rerank.ts`, Gemini Flash) → top-k (docs 3 / msgs 5). Every stage is **best-effort and degrades to the prior stage** (with all toggles off it's plain vector top-k). All knobs live in `src/lib/ragConfig.ts` (`getRagConfig()`) with env overrides: `RAG_DOC_THRESHOLD`, `RAG_MSG_THRESHOLD`, `RAG_TOP_N`, `RAG_DOC_TOP_K`, `RAG_MSG_TOP_K`, `RAG_MMR_LAMBDA`, `RAG_REWRITE_ENABLED`, `RAG_RERANK_ENABLED`, `RAG_MMR_ENABLED`. Note: rewrite + rerank add two Gemini Flash calls per message (~1–2s latency) — toggle off via env if needed. Reranking/rewrite LLM calls reuse the proven `generateText`+parse+fallback pattern (like `classify`).

**Vision-extraction fallback (Phase C2)** — `src/lib/visionExtraction.ts` handles two paths: `extractViaVision(buffer)` renders PDF pages via **pdfjs-dist@5 legacy** (`pdfjs-dist/legacy/build/pdf.mjs`) + **`@napi-rs/canvas`** (scale 3) and calls Gemini Flash per page; `extractViaVisionImage(buffer, mimeType)` vision-extracts a single image. Both degrade to `''` if no Gemini key. Env knobs: `EXTRACTION_MODEL` (default `gemini-3.5-flash`), `EXTRACTION_MAX_PAGES` (default `30`), `EXTRACTION_RENDER_SCALE` (default `3`), `EXTRACTION_MAX_OUTPUT_TOKENS` (default `8000`), `EXTRACTION_MIN_TEXT_CHARS` (default `100`). Once text is extracted the downstream chunk → embed → pgvector RAG pipeline is unchanged. Note: `@napi-rs/canvas` is a native module — Vercel Fluid Compute compatibility is unverified (Task 6); client-side pdf.js render is the documented fallback.

### State Management

- **Server state**: SQLite via server actions
- **Settings**: `src/lib/settings.ts` — DB-first, env-fallback pattern. All API routes create providers **per-request** (not module-level singletons) for runtime config changes without restart.
- **UI persistence**: `useLocalStorage` hook with deferred hydration (reads in `useEffect` to avoid SSR mismatch)
- **Theme**: `next-themes` with class-based dark/light/system switching
- **Refs for closures**: Dynamic values (selectedModel, activeChatId, chats) use `useRef` to avoid stale closures in `useChat` transport and `onFinish` callback

### Styling

Tailwind CSS v4, **warm-minimal palette** (re-theme of 2026-06-25, v4.30.0 — "Manus/Claude" warm look). Light-first; default theme is `light`; dark mode is re-themed to a **warm near-black** with a lifted terracotta accent, not dropped. (Supersedes the prior cool steel-blue/navy "Atelier Technologies" palette in `ATELIER_BRAND_SKILL_V2.md`, which is now historical for color.)

Brand tokens live in [src/app/globals.css](src/app/globals.css). **Token names are preserved from the old system; values are warm** (the cool names `--brand-navy` / `--brand-steel-blue` are intentionally repurposed to warm values — no component uses `bg-navy`/`bg-steel-blue` directly):

- **Raw swatches** (don't use directly unless semantic tokens don't fit): `--brand-steel-blue` `#C96442` (**terracotta — the accent/primary**), `--brand-terracotta-light` `#D98A6A` (dark-mode accent), `--brand-navy` `#6B4A38` (deep warm clay — accent-foreground), `--brand-ink` `#20201E` (warm near-black text), `--brand-canvas-light` `#FAF9F6` (warm paper), `--brand-pure-surface` `#FFFFFF`, `--brand-warm-sand` `#E0D6C5`, `--brand-stone-sage` `#94977F`, `--brand-soft-mist` `#F2EFE9`, `--brand-muted-line` `#E8E6DF`, `--brand-slate-text` `#78776E`, `--brand-success` `#4F7A4A`, `--brand-warning` `#A06D2E`. Dark mode overrides surfaces directly (bg `#1A1815`, card `#26231D`, border `#322E26`, foreground `#ECEAE3`).
- **Semantic tokens (prefer these in components)**: `bg-background` (warm paper / warm near-black), `bg-card`, `bg-primary` (**Terracotta — CTA color**), `bg-secondary`/`bg-muted`/`bg-accent` (Soft Mist light / warm charcoal dark), `text-foreground` (warm Ink), `text-muted-foreground` (warm Slate), `border-border` (warm Muted Line), `ring-ring` (Terracotta), `bg-destructive`.
- **Direct brand utilities** (rare; for cases where semantic tokens don't express intent): `text-ink`, `bg-warm-sand`, `text-stone-sage`, `text-success`, `text-warning` (these are the only ones in use). The remaining `--color-*` exports still resolve to warm values.
- **Typography:** **Fraunces** (variable serif via `next/font/google`, exposed as `--font-serif`) on **display headings only** — the home hero greeting and the top-level view titles (Artifacts/Projects/project name). Body & UI stay **Geist Sans**; code stays **Geist Mono**. Apply with the `font-serif` utility; do not put serif on body text.

**Surfaces.** The legacy `.glass-panel` class is retained (16 consumers across dialogs/menus/sidebar) but **redefined** as a light modular card: Pure Surface bg, Muted Line border, soft layered shadow. Dark mode uses an elevated Ink variant. There is **no backdrop-blur, no bg/60 opacity, no dark translucent glass** anywhere in the system.

**Styling guidance** (brand guide — preferences, not hard rules): **prefer the semantic tokens** for surfaces, borders, hover, and text (`bg-card`/`bg-muted`/`bg-accent`, `border-border`, `hover:bg-accent`, `text-muted-foreground`) — they adapt to the warm palette and dark mode, whereas a raw `bg-white/X`·`bg-black/X` wash doesn't. **Opacity utilities are allowed where they're genuinely the right tool** — intentional scrims/overlays (modal & lightbox backdrops use `bg-black/60`–`/80`), gradients, and one-off effects. Avoid blue→purple gradient text/CTAs and oversaturated multi-accent gradients (off-brand for the warm palette).

**Other styling infra**: Animations via Framer Motion, CSS keyframes, and `SmoothStreamingWrapper` (ResizeObserver). Radix UI primitives for accessibility. Fonts via `next/font/google`: **Fraunces** (serif, display headings) + **Geist Sans** (body/UI) + **Geist Mono** (code).

### Provider Routing

Centralized in `src/lib/providers.ts` via `createProvider(modelName)`, which routes by model-name prefix:

- **`claude-*` → Anthropic** (`@ai-sdk/anthropic`, `createAnthropic({ apiKey })`). Web search is enabled via `tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) }`. **Adaptive thinking + effort (Persona System v2):** `createProvider(modelName, effort?)` sets `providerOptions.anthropic = { thinking: { type: 'adaptive' }, effort }` for Claude models. **`effort` is omitted for `claude-haiku-*`** (the API 400s on Haiku). `budget_tokens` is gone — adaptive thinking is the supported on-mode. Throws if no Anthropic key.
- **`gemini-*image*` → Gemini image** — `providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }`, no grounding.
- **other `gemini-*` → internal Gemini text** (utility tasks + the embedding plumbing) — Google Search grounding via `google.tools.googleSearch({})`.
- **anything else → throws** `Unknown model provider`.

Embeddings always run on Gemini (`gemini-embedding-001`) regardless of chat model — Anthropic has no embeddings API. Sources stream as `source-url` parts and render as link chips (both Google grounding and Claude web search emit them). All POST routes validate request bodies with Zod schemas (`src/lib/validation.ts`).

### Multimodal

**Input**: Images sent as `FileUIPart` via `sendMessage({ text, files })`, persisted in `message_attachments` table, reloaded as `file` parts on page load. `convertToModelMessages()` handles format conversion automatically. Gemini has vision support.

**Document surfaces (Phase C3)**: Both `ProjectDocumentsDialog` (modal) and `ProjectLandingPage` (Files panel) render a `DocumentCard` grid and use `useDocumentUpload` for uploads. Both now accept images (png/jpg/jpeg/webp) in addition to PDF/DOCX/XLSX. Clicking a card opens `DocumentPreviewDialog` (tabbed: "Preview" renders originals inline; "Extracted text" reconstructs chunks). The `vision` badge on a card indicates the document was processed via Gemini vision extraction (vs. text extraction). **Phase C is complete (C2 + C-storage + C3).**

**Attachment persistence (Phase C-storage Stage 2)**: `saveMessageAttachments` uses a **dual-write** strategy — when Storage is configured (`isStorageConfigured()`), it decodes the base64 data URL, uploads bytes to `attachments/<chatId>/<messageId>/<i>-<filename>` in the private Supabase Storage bucket, and stores `storage_path` with `data_url` null. When Storage is NOT configured, it falls back to storing the base64 `data_url` in the DB column (graceful degradation — unlike documents, chat attachments keep working with no Storage configured). `message_attachments.storage_path` is nullable; `data_url` is also nullable (one or the other is populated). `getChatAttachments` does a **dual-read**: rows with `storage_path` get a short-lived signed URL via `createSignedDownloadUrl`; legacy `data_url` rows are returned unchanged. No backfill of old rows. `deleteChat` / `deleteMessage` remove relevant Storage objects best-effort before the DB cascade. Migration `drizzle/0003_superb_roughhouse.sql` added `storage_path` + made `data_url` nullable. Known deferral: deleting a whole **project** does not sweep attachment Storage objects (consistent with the Stage 1 orphan-sweep deferral).

**Output (Nano Banana 2)**: Gemini image models (`gemini-3.1-flash-image`) return generated images as `file` parts in assistant messages. The `onFinish` callback extracts these `file` parts and persists them to `messageAttachments` (same table as user-attached images). Both user-attached and AI-generated images render inline in `MessagesList` with a click-to-expand lightbox overlay (Framer Motion animated, fullscreen with backdrop blur). Generated images display at 512px; user images at 300px.

**Artifacts**: Claude can generate **brand-styled** file artifacts — **XLSX, DOCX, PDF, PPTX** (downloadable) and **HTML** (live preview) — via the `generate_artifact` tool (pure-JS renderers: `exceljs`, `docx`, `pdf-lib`, `pptxgenjs`; HTML passes through). The tool is **chat-first** (only fires on an explicit file/web-page request — see `TOOL_GUIDANCE`). `page.tsx` fetches artifacts from `GET /api/artifacts?chatId=` on chat open and re-fetches after each response; `ArtifactCard` renders below the assistant message; clicking opens **`ArtifactWorkspace`** — a right-side panel with **Preview / Edit / Versions** tabs, **Download**, and AI **regenerate** (`POST /api/artifacts/[id]/{edit,regenerate}`). Preview is live: PDFs via the **same-origin proxy** (`<iframe src="/api/artifacts/:id/raw">` — NOT the cross-origin signed URL, which browsers block in an iframe), HTML in a sandboxed `<iframe srcDoc>` (`sandbox="allow-scripts"`, no same-origin), sheets→table, markdown→HTML. The workspace panel is **resizable** (drag its left edge; width clamped 360px..80vw and persisted in `artifact-panel-width`); dragging it wide enough to cramp the chat **auto-collapses the sidebar** (and restores it on narrow/close, only if it auto-collapsed). Source `content`/`format` + an `artifact_versions` table back preview/edit/versioning. **Inline images** are separate: the `generate_image` tool (`src/lib/image/tool.ts`) makes Claude produce images inline via Nano Banana (see provider routing). Migrations: `0005` (artifacts), `0010` (artifact_versions). Deps: `docx`, `pdf-lib`, `pptxgenjs`, `marked`.

## AI SDK v6 Gotchas

1. **Stale closure in transport body**: Use a `ref` for dynamic values like selected model
2. **Message format**: Use `convertToModelMessages()` on server; messages use `parts` array, not `content` string
3. **Response format**: Use `toUIMessageStreamResponse({ sendSources: true })` for Google Search sources
4. **SDK v6 API changes**: No `input`/`handleInputChange`/`handleSubmit` — manage input state yourself. No `isLoading` — use `status === 'streaming' || status === 'submitted'`. Send with `sendMessage({ text })`.
5. **Postgres driver**: Uses `postgres-js` (`drizzle-orm/postgres-js`) with `prepare: false` for the Supabase transaction pooler; runs on Node (Fluid Compute), not Edge
6. **Google Search tool name**: Must be exactly `google_search` in the `tools` object
7. **AI SDK v6 naming**: Use `maxOutputTokens` (not `maxTokens`) in `generateText()`/`streamText()`
8. **Source deduplication**: Google Search grounding sends `source-url` parts in `message.parts[]` — deduplicate by URL before rendering
9. **Multimodal images**: `sendMessage({ text, files: FileUIPart[] })` on client, `convertToModelMessages()` on server handles data URL → inline base64 automatically
10. **Gemini image generation**: Image models (name contains `image`) require `providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }` — without this, no images are returned. Must NOT have Google Search grounding tools (incompatible).
11. **Claude provider**: `claude-*` models route via `@ai-sdk/anthropic` (`createAnthropic({ apiKey })`). Web search via `anthropic.tools.webSearch_20250305({ maxUses: 5 })` under `tools: { web_search }`. **Adaptive thinking + effort:** pass `providerOptions.anthropic = { thinking: { type: 'adaptive' }, effort }` (AI SDK v6 supports both). `budget_tokens` is removed (400 on Opus 4.8). **Omit `effort` for Haiku** — the API rejects it there. Effort flows from the active persona (and the composer effort pill) → chat request body → `createProvider`. Embeddings stay on Gemini (Anthropic has no embeddings API).
12. **Model IDs**: User-selectable picker (`src/app/api/models/route.ts`): `claude-opus-4-8` (default), `claude-fable-5` (flagship — most capable, ~2× Opus token cost, adaptive thinking always-on, needs 30-day data retention), `claude-sonnet-5`, `claude-haiku-4-5`, and `gemini-3.1-flash-image` (Nano Banana 2). **`claude-sonnet-4-6` was retired from the picker** (superseded by Sonnet 5) but is **kept in `MODEL_IDS`** (`src/lib/validation.ts`) so chats already pinned to it still route. New Claude IDs must be added to `MODEL_IDS` or the chat route's Zod enum rejects them. Fable 5 / Sonnet 5 route through the existing `claude-*` path in `providers.ts` (adaptive thinking + `effort`, Haiku-exempt) with no provider change. Gemini *text* models were retired from the picker. `gemini-3.5-flash` survives as an internal-only utility/housekeeping model (title/summarize/classify) and is not user-selectable. The Deep Think virtual model was removed.
13. **AI-generated image persistence**: The `onFinish` callback must save `file` parts (not just `text` parts) from assistant messages to `messageAttachments` via `saveMessageAttachments()`. Without this, generated images are lost on page refresh. The load flow (`loadMessages`) already reconstructs `file` parts from attachments.
14. **Image data URLs in new tabs**: Browsers block `data:` URLs opened via `<a target="_blank">` for security. Use a lightbox overlay instead of linking to `data:` URLs directly.
15. **Server action body size limit**: `next.config.ts` sets `experimental.serverActions.bodySizeLimit` to `'10mb'`. Without this, `saveMessageAttachments()` fails silently for Gemini-generated images (base64 data URLs are 1-2MB+, exceeding the default 1MB limit).

## Testing

### Vitest (Unit + Integration)

Config: `vitest.config.ts`. Tests in `tests/`. Node environment by default; hook tests use `// @vitest-environment jsdom` per-file.

**Test structure:** `tests/unit/lib/` (utilities), `tests/unit/actions/` (server actions with in-memory SQLite), `tests/unit/api/` (API routes with mocked providers), `tests/hooks/` (React hooks, jsdom).

**In-process Postgres (PGlite)**: Import `createTestDb`/`testDb` from `tests/helpers/test-db.ts`, mock `@/db` with a getter, call `createTestDb()` in `beforeEach`. The `PGlite` instance (with the `vector` extension) + real Drizzle migrations from `drizzle/` are created **once per worker**; each `createTestDb()` then `TRUNCATE … RESTART IDENTITY CASCADE`s all tables for isolation — so the suite runs ~15s (was ~40s when it spun a fresh instance per test). Tests exercise the actual schema incl. pgvector + HNSW; no DB secrets needed in CI. (PGlite is pinned to `^0.4.6` — v0.5.x dropped the `./vector` export.)

**API route tests**: Require `vi.resetModules()` + `vi.doMock()` + dynamic `import()` to re-register mocks after module reset. Must mock `@/lib/settings`, `@/lib/embeddings`, and AI SDK providers alongside `@/db`. The `@ai-sdk/google` mock must include `tools.googleSearch`, and the `@ai-sdk/anthropic` mock (`createAnthropic`) must include `tools.webSearch_20250305` on the provider function. The `@/lib/settings` mock should expose both `getGeminiApiKey` and `getAnthropicApiKey`.

### Playwright (E2E)

Config: `playwright.config.ts`. Tests in `e2e/`. Chromium only. Auto-starts dev server.

**Key behaviors:**
- Textarea is always enabled — sending a message auto-creates a standalone quick chat
- Command palette opens with `Control+k` (not `Meta+k` on Linux)
- `CommandPalette` renders a plain `div`, not `dialog` — locate by content

## Deployment

Production: **Vercel** at [atelier-ai-app.vercel.app](https://atelier-ai-app.vercel.app) (also [atelier-ai-studio.vercel.app](https://atelier-ai-studio.vercel.app)). The Vercel **project is named `atelier-ai`** (under `danieltsos-projects`; prod alias `atelier-ai-app.vercel.app`) — the repo is linked to it (`.vercel/`, gitignored). Note: the bare `atelier-ai.vercel.app` **URL** is a different, unrelated project — don't use that URL. GitHub: [DanielTso/atelier_ai_gpt](https://github.com/DanielTso/atelier_ai_gpt). Production deploys automatically on push to `master`; `vercel --prod` / `vercel redeploy atelier-ai-app.vercel.app` also work. **Vercel CLI is installed and authenticated** (as `danieltso`). Env-var changes don't auto-deploy — redeploy to pick them up. Do NOT run `vercel env pull` / `vercel dev` (they clobber `.env.local`). Set `DATABASE_URL` (Supabase pooled, :6543) and `DIRECT_URL` (Supabase direct, :5432) in the Vercel dashboard. Apply schema changes separately: `DIRECT_URL=... npx drizzle-kit migrate`.

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml` — runs on push to `master` and PRs. Single job (ubuntu-latest, Node 22): lint → typecheck → build → vitest → `drizzle-kit migrate` → playwright. **No secrets required**, but the job runs a **`pgvector/pgvector` Postgres service** (with `DATABASE_URL`/`DIRECT_URL` pointing at it) because the E2E dev server needs a real Postgres and migration `0000` does `CREATE EXTENSION vector`. Unit tests (Vitest) ignore the service — they use in-process PGlite. Provider calls are still mocked. To run E2E **locally**, set `DATABASE_URL`/`DIRECT_URL` (your Supabase URLs or a local pgvector Postgres) and `npx drizzle-kit migrate` first.

## Chat Logs

Session logs in `docs/chatlog-*.md`. Update before compacting context or ending long sessions.
