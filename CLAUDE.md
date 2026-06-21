# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Production build
npm run start        # Run production server
npm run lint         # Run ESLint
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
```

**Storage access model:** bucket is **private**. `SUPABASE_SERVICE_ROLE_KEY` (server-only, never sent to client) creates signed upload tokens and mints signed download URLs. The browser uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` only to `uploadToSignedUrl` — it never has broad storage access.

The two AI keys can also be configured at runtime via the **Settings dialog → API Keys tab** (stored in the `settings` table). DB values take priority over `.env.local`.

**Note:** `.env*.local` files are gitignored. Never commit secrets.

The app uses two AI providers with a clear split — **Claude is the brain, Gemini is the senses**:
- **Anthropic Claude** (cloud, `@ai-sdk/anthropic`): the chat brain. Without an Anthropic key, no Claude chat models appear.
- **Google Gemini** (cloud, `@ai-sdk/google`): image generation (Nano Banana 2) + embeddings (RAG) only. Anthropic has **no embeddings API**, so embeddings always run on Gemini regardless of the chat model. Gemini text models are not user-selectable.

### Database

**Supabase Postgres** via Drizzle on `postgres-js` (`drizzle-orm/postgres-js`). Connection at `src/db/index.ts`: `postgres(DATABASE_URL, { prepare: false })` — `prepare: false` is **required** for Supabase's transaction pooler (no prepared statements). Use the **pooled** URL (`DATABASE_URL`, port 6543) at runtime and the **direct** URL (`DIRECT_URL`, port 5432) for migrations.

- Schema at `src/db/schema.ts` (`pg-core`): integer PKs via `GENERATED ALWAYS AS IDENTITY`, `timestamptz`, `boolean`, FK cascade deletes enforced natively (no `PRAGMA`). Tables: `projects` → `chats` → `messages`, `settings`, `messageEmbeddings`, `documents`, `documentChunks`, `documentRevisions`, `messageAttachments`, `personaUsage`, `chatTopics`, `artifacts`, `memorySuggestions`.
- **`memorySuggestions` table** — `id, project_id, chat_id, text, status (pending|accepted|dismissed), created_at` + index on `(project_id, status)`. Added by migration `drizzle/0008_busy_miss_america.sql`. `chat_id` is **SET NULL** on chat delete (project-level suggestions survive). Rows are auto-memory candidates created by `POST /api/memory/suggest`; accepting one appends to `projects.memory`.
- **pgvector**: `messageEmbeddings.embedding` and `documentChunks.embedding` are `vector(768)` with **HNSW** indexes (`vector_cosine_ops`). The `vector` extension is enabled by migration `drizzle/0000_enable_vector.sql`.
- **`documents.extraction_method`** — text column (`'text'` | `'vision'`), nullable; added by migration `drizzle/0004_sudden_ben_grimm.sql`. Set by `/api/documents/process`; surfaced in `GET /api/documents` and displayed as a badge in `DocumentCard`.
- **`artifacts` table** — `id, chat_id, project_id, type, title, storage_path, status, error_message, created_at` + index on `chat_id`. Added by migration `drizzle/0005_lyrical_onslaught.sql` (applied to live Supabase). Rows are created by the `generate_artifact` tool during a Claude chat turn and read back by `GET /api/artifacts?chatId=`.
- **Migrations** (versioned, in `drizzle/`): `npx drizzle-kit generate` to author, `DIRECT_URL=... npx drizzle-kit migrate` to apply. `drizzle.config.ts` uses `dialect: "postgresql"`. (Legacy `npx drizzle-kit push` is no longer the workflow.) Applied to Supabase: `0000`–`0005`.

### Security

`getSetting()` and `getSettings()` server actions block the sensitive `gemini-api-key` and `anthropic-api-key` from being read by client code (`SENSITIVE_KEYS`). Keys are only accessed server-side via `src/lib/settings.ts` (`getGeminiApiKey()`, `getAnthropicApiKey()`). The `getApiKeyStatus()` server action returns booleans only (configured / not) so the API Keys UI can show status without exposing values. All POST API routes validate request bodies with Zod schemas; error responses are sanitized via `apiError()` helper (no raw error messages to clients).

## Architecture Overview

Atelier Studio is a Next.js 16 App Router chat application. **Claude (Anthropic) is the chat brain; Google Gemini handles image generation and embeddings.**

### Data Flow

1. **Client** (`src/app/page.tsx`) — Single-page chat UI using `useChat` from `@ai-sdk/react`. All application state lives here. Three view states: **active chat**, **project landing page** (two-column: chats + documents), **empty state** (branding with always-visible input toolbar). Sending a message with no active chat auto-creates a standalone quick chat.
2. **Server Actions** (`src/app/actions.ts`) — "use server" functions for all DB reads/writes (CRUD for projects, chats, messages, settings, chat previews).
3. **API Routes**:
   - `POST /api/chat` — Streams LLM responses. Claude models (`claude-*`) route to Anthropic with **web search** enabled (`anthropic.tools.webSearch_20250305`). The Gemini image model (`*image*`) gets `responseModalities: ['TEXT', 'IMAGE']`. Applies five-layer context (see below). Default model fallback is `claude-opus-4-8`.
   - `GET /api/models` — Returns a static curated list (gated by key presence): Claude models when the Anthropic key is set (Opus 4.8 first → the default), Nano Banana 2 when the Gemini key is set. No Gemini text models. Cache-Control: 5 minutes.
   - `POST /api/summarize` — Compresses older messages. Auto-triggers at 30+ messages, keeps last 10 in full. Pinned to internal `gemini-3.5-flash` (housekeeping never burns Claude tokens).
   - `POST /api/embed` — Async 768-dim embedding generation via Gemini `gemini-embedding-001`. Best-effort after each exchange.
   - `POST /api/generate-title` — Auto-generates chat title (3-6 words) after first AI response. Pinned to internal `gemini-3.5-flash`.
   - `POST /api/extract` — Extracts text from files (PDF via `unpdf`, DOCX via `mammoth`, XLSX via `exceljs` — one tab-separated block per sheet, text/code via UTF-8). Max 200MB (`MAX_FILE_SIZE`; large construction plans). Vercel's platform request-body limit may cap below this on deploy — use the direct-upload flow (`/api/documents/upload-url` + `/api/documents/process`) for large files. **Supabase Storage must also allow the size:** the org is on the **Pro** plan, the `atelier-files` bucket `file_size_limit` is set to 200MB, and the **project-global Storage upload limit** (Supabase dashboard → Project Settings → Storage) must be ≥ 200MB or large signed uploads are rejected server-side.
   - **Document upload — 3-step direct-to-Storage flow (Phase C-storage):**
     - `POST /api/documents/upload-url` — validates name/type/size, creates a `documents` row with status `uploading`, returns `{ documentId, path, token, bucket }` for the browser.
     - Browser calls `uploadToSignedUrl` (`src/lib/storageClient.ts`, anon key) to PUT the file straight to Supabase Storage, bypassing the Vercel function request-body limit (large plans work).
     - `POST /api/documents/process` `{ documentId }` — downloads original from Storage, runs the C2 extract pipeline (text / thin-PDF vision fallback / image vision), uploads a WebP thumbnail, chunks + embeds, records `extraction_method` (`'text'` or `'vision'`), sets status `processing` → `ready | error`. The old inline `POST /api/documents` + `createDocument` action are retired.
   - `GET /api/documents` — returns each doc with short-lived signed `url` (original) + `thumbnailUrl` (best-effort, `null` if absent) + `extractionMethod` (`'text'` or `'vision'`). `DELETE /api/documents` — removes Storage objects (original + thumbnail) before deleting the DB row.
   - `POST /api/classify` — LLM-based topic classification. Pinned to internal `gemini-3.5-flash` (tolerates a Claude `model` in the body). Cached in `chatTopics`.
   - `POST /api/memory/suggest` — **auto-memory** (suggest, you approve). Throttled best-effort pass (Gemini `gemini-3.5-flash`, never Claude tokens) that extracts durable project facts and stores them as pending `memorySuggestions`. Key-guarded (`{ created: 0 }` with no key), cap-gated at ~10 pending (`{ created: 0, capped: true }`, no model call), dedups against current `projects.memory` + pending + recently-dismissed. Triggered every 6 messages in a **project** chat from `page.tsx`'s `onFinish`; reviewed via the "Suggested memories" strip in `ProjectContextRail` (Accept appends to `projects.memory`, Edit, Dismiss). Never surfaces as a user error. Actions: `createMemorySuggestions`, `getPendingSuggestions`, `countPendingSuggestions`, `getRecentlyDismissed`, `acceptSuggestion(id, overrideText?)`, `dismissSuggestion`.
   - `GET /api/artifacts?chatId=` — returns all artifacts for a chat with short-lived signed `downloadUrl` per row. `DELETE /api/artifacts?id=` — removes the Storage object then the DB row.

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
- `src/hooks/` — Custom hooks (useLocalStorage, usePersonas, useAppearanceSettings, etc.)
- `src/hooks/useDocumentUpload.ts` — Shared 3-step upload hook (request upload-url → `uploadToSignedUrl` → process). Used by both `ProjectDocumentsDialog` and `ProjectLandingPage`; fixes a regression where the landing page was still POSTing to the retired inline `/api/documents` endpoint.
- `src/lib/` — Utilities: `settings.ts` (DB-first/env-fallback config), `embeddings.ts` (pgvector search), `retrieval.ts` (RAG pipeline orchestrator), `ragConfig.ts` (tunable RAG knobs), `queryRewrite.ts` (conversational query rewrite), `rerank.ts` (LLM rerank), `mmr.ts` (diversity selection), `chunking.ts` (document chunker), `fileAttachments.ts` (image/file handling), `providers.ts` (shared AI provider factory), `fileExtraction.ts` (shared file parsing), `errors.ts` (API error helper), `validation.ts` (Zod request schemas), `storage.ts` (server-only Supabase Storage wrapper — `isStorageConfigured`, `createSignedUploadUrl`, `uploadBuffer`, `downloadToBuffer`, `createSignedDownloadUrl`, `removeObjects`; uses service-role key), `thumbnails.ts` (`generatePdfThumbnail` + `generateImageThumbnail` → WebP via `@napi-rs/canvas`, best-effort), `storageClient.ts` (browser-side anon-key Supabase client for `uploadToSignedUrl`)
- `src/lib/artifacts/` — Artifact engine (Phase D1): `types.ts` (`ArtifactType`, `SheetSpec`, `RenderedArtifact`); `toXlsx.ts` (exceljs renderer); `toDocx.ts` (docx renderer, Markdown → headings/paragraphs/bullets); `toPdf.ts` (pdf-lib renderer, Markdown → clean wrapped-text PDF); `render.ts` (`renderArtifact(type, title, content)` dispatch); `tool.ts` — the AI SDK v6 `tool()` definition for `generate_artifact`. Claude calls the tool with `{ type, title, format, content }`; `execute` renders the file, uploads to `artifacts/<projectId|standalone>/<id>/<slug>.<ext>` in the `atelier-files` bucket, persists an `artifacts` row, and returns `{ artifactId, title, type, downloadUrl }`. Wired into `/api/chat` for Claude models when a `chatId` exists and Storage is configured.
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

Tailwind CSS v4 on the **Atelier Technologies master brand system** (`ATELIER_BRAND_SKILL_V2.md`). Light-first, executive-grade, calm palette. Default theme is `light`; dark mode is re-themed around Ink with Steel Blue accents, not dropped.

Brand tokens live in [src/app/globals.css](src/app/globals.css):

- **Raw swatches** (don't use directly unless semantic tokens don't fit): `--brand-navy` `#1F3447`, `--brand-steel-blue` `#4F7396`, `--brand-ink` `#16202A`, `--brand-canvas-light` `#F7F6F2`, `--brand-pure-surface` `#FFFFFF`, `--brand-warm-sand` `#D9CFBF`, `--brand-stone-sage` `#8C9A86`, `--brand-soft-mist` `#F3F1EC`, `--brand-muted-line` `#E3DDD2`, `--brand-slate-text` `#6F7781`, `--brand-success` `#3F7252`, `--brand-warning` `#A06D2E`.
- **Semantic tokens (prefer these in components)**: `bg-background`, `bg-card`, `bg-primary` (Steel Blue — CTA color), `bg-secondary`/`bg-muted`/`bg-accent` (all Soft Mist in light mode), `text-foreground` (Ink), `text-muted-foreground` (Slate Text), `border-border` (Muted Line), `ring-ring` (Steel Blue), `bg-destructive`.
- **Direct brand utilities** (for cases where semantic tokens don't express intent): `bg-navy`, `bg-steel-blue`, `bg-canvas`, `bg-warm-sand`, `bg-stone-sage`, `bg-soft-mist`, `text-ink`, `text-slate-text`, `border-muted-line`, `text-success`, `text-warning`.

**Surfaces.** The legacy `.glass-panel` class is retained (16 consumers across dialogs/menus/sidebar) but **redefined** as a light modular card: Pure Surface bg, Muted Line border, soft layered shadow. Dark mode uses an elevated Ink variant. There is **no backdrop-blur, no bg/60 opacity, no dark translucent glass** anywhere in the system.

**Forbidden patterns** (brand guide): blue→purple gradient text/CTAs, `bg-white/X` / `border-white/X` / `via-white/X` opacity utilities (replace with semantic tokens), oversaturated multi-accent gradients. Hover states use `hover:bg-accent`, not `hover:bg-white/10`.

**Other styling infra**: Animations via Framer Motion, CSS keyframes, and `SmoothStreamingWrapper` (ResizeObserver). Radix UI primitives for accessibility. Typography is Geist Sans / Geist Mono via `next/font/google`.

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

**Artifacts (Phase D1)**: Claude can generate downloadable file artifacts (XLSX, DOCX, PDF) via the `generate_artifact` tool. When the model is Claude, a `chatId` is present, and Storage is configured, `/api/chat` includes the tool in the `tools` object. Claude calls it with `{ type, title, format, content }`; the tool's `execute` function renders the file (pure-JS: `exceljs` for XLSX, `docx` for Word, `pdf-lib` for PDF), uploads it to the `atelier-files` bucket at `artifacts/…`, persists an `artifacts` row (migration `0005`), and returns a signed `downloadUrl`. `page.tsx` fetches artifacts from `GET /api/artifacts?chatId=` on chat open and re-fetches after each assistant response. `ArtifactCard` components render below the relevant assistant message with a download link. Artifacts are currently keyed by chat (not per-message); D2 will add the artifact workspace panel, versioning, and live preview. New deps: `docx`, `pdf-lib` (pure-JS; `exceljs` already present).

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
12. **Model IDs**: User-selectable picker (`src/app/api/models/route.ts`): `claude-opus-4-8` (default), `claude-sonnet-4-6`, `claude-haiku-4-5`, and `gemini-3.1-flash-image` (Nano Banana 2). Gemini *text* models were retired from the picker. `gemini-3.5-flash` survives as an internal-only utility/housekeeping model (title/summarize/classify) and is not user-selectable. The Deep Think virtual model was removed.
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

Production: **Vercel** at [atelier-ai-app.vercel.app](https://atelier-ai-app.vercel.app) (also [atelier-ai-studio.vercel.app](https://atelier-ai-studio.vercel.app)). Note: the bare `atelier-ai.vercel.app` is a **different, unrelated project** — do not use it. GitHub: [DanielTso/atelier_ai_gpt](https://github.com/DanielTso/atelier_ai_gpt). Production deploys automatically on push to `master`; `vercel --prod` also works. Set `DATABASE_URL` (Supabase pooled, :6543) and `DIRECT_URL` (Supabase direct, :5432) in the Vercel dashboard. Apply schema changes separately: `DIRECT_URL=... npx drizzle-kit migrate`.

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml` — runs on push to `master` and PRs. Single job (ubuntu-latest, Node 22): lint → build → vitest → `drizzle-kit migrate` → playwright. **No secrets required**, but the job runs a **`pgvector/pgvector` Postgres service** (with `DATABASE_URL`/`DIRECT_URL` pointing at it) because the E2E dev server needs a real Postgres and migration `0000` does `CREATE EXTENSION vector`. Unit tests (Vitest) ignore the service — they use in-process PGlite. Provider calls are still mocked. To run E2E **locally**, set `DATABASE_URL`/`DIRECT_URL` (your Supabase URLs or a local pgvector Postgres) and `npx drizzle-kit migrate` first.

## Chat Logs

Session logs in `docs/chatlog-*.md`. Update before compacting context or ending long sessions.
