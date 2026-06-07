# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Production build
npm run start        # Run production server
npm run lint         # Run ESLint
npx drizzle-kit push # Push schema changes to database (local SQLite or remote Turso)
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
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
DASHSCOPE_API_KEY=your_key_here
```

API keys can also be configured at runtime via the **Settings dialog** (stored in the `settings` SQLite table). DB values take priority over `.env.local`.

**Note:** `.env*.local` files and `sqlite.db` are gitignored. Never commit secrets or the local database.

Two providers are supported — both optional, the app works with either or both:
- **Google Gemini** (cloud): Requires a Gemini API key
- **Alibaba Cloud Qwen** (cloud): Requires a DashScope API key from [Alibaba Cloud Model Studio](https://modelstudio.console.alibabacloud.com). Uses the Singapore international endpoint (`dashscope-intl.aliyuncs.com`)

### Database

SQLite via `@libsql/client` + `drizzle-orm/libsql`. Supports both local SQLite files and remote Turso. Driver selected automatically:

- **Local dev** (default): No env vars needed — uses `file:sqlite.db`
- **Vercel/Production**: Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel dashboard

Schema at `src/db/schema.ts`, connection at `src/db/index.ts` (with `PRAGMA foreign_keys = ON` for local SQLite). Drizzle config uses `dialect: "turso"`. Ten tables: `projects` → `chats` → `messages` (cascade deletes), `settings`, `messageEmbeddings`, `documents`, `documentChunks`, `messageAttachments`, `personaUsage`, `chatTopics`. See schema file for field details.

### Security

`getSetting()` and `getSettings()` server actions block sensitive keys (`gemini-api-key`, `dashscope-api-key`) from being read by client code. API keys are only accessed server-side via `src/lib/settings.ts` (`getGeminiApiKey()`, `getDashScopeApiKey()`). All POST API routes validate request bodies with Zod schemas; error responses are sanitized via `apiError()` helper (no raw error messages to clients).

## Architecture Overview

Atelier Studio is a Next.js 16 App Router chat application with multi-provider AI backend (Google Gemini + Alibaba Cloud Qwen).

### Data Flow

1. **Client** (`src/app/page.tsx`) — Single-page chat UI using `useChat` from `@ai-sdk/react`. All application state lives here. Three view states: **active chat**, **project landing page** (two-column: chats + documents), **empty state** (branding with always-visible input toolbar). Sending a message with no active chat auto-creates a standalone quick chat.
2. **Server Actions** (`src/app/actions.ts`) — "use server" functions for all DB reads/writes (CRUD for projects, chats, messages, settings, chat previews).
3. **API Routes**:
   - `POST /api/chat` — Streams LLM responses. Routes to provider based on model name prefix (`gemini` → Google, `qwen` → DashScope). Applies five-layer context (see below). Gemini text models have Google Search grounding enabled automatically. Image models (`*image*`) get `responseModalities: ['TEXT', 'IMAGE']` instead of grounding. Deep Think (`*deep-think*`) routes to `gemini-3.1-pro-preview` with `thinkingConfig: { thinkingLevel: 'high' }`. Thinking variants (`*-think-{minimal|low|medium|high}*`) strip the suffix and apply `thinkingConfig` with the matching level (Flash: all 4 levels; Pro: low/medium; Flash-Lite: all 4 levels).
   - `GET /api/models` — Returns a static curated list of available models (gated by API key presence). Cache-Control: 5 minutes.
   - `POST /api/summarize` — Compresses older messages. Auto-triggers at 30+ messages, keeps last 10 in full.
   - `POST /api/embed` — Async 768-dim embedding generation via Gemini `gemini-embedding-001`. Best-effort after each exchange.
   - `POST /api/generate-title` — Auto-generates chat title (3-6 words) after first AI response.
   - `POST /api/extract` — Extracts text from files (PDF via `unpdf`, DOCX via `mammoth`, XLSX via `exceljs` — one tab-separated block per sheet, text/code via UTF-8). Max 10MB.
   - `POST /api/documents` — Upload + process: extract text → chunk (2000 chars, 400 overlap, sentence-aware) → embed → store.
   - `POST /api/classify` — LLM-based topic classification. Gemini only. Cached in `chatTopics`.

### Source Layout

- `src/app/page.tsx` — Single-page client; all application state lives here
- `src/app/actions.ts` — Server actions for all DB reads/writes
- `src/app/api/` — API routes (chat, models, embed, summarize, documents, etc.)
- `src/components/chat/sidebar/` — Decomposed sidebar: `Sidebar.tsx` (orchestrator), `types.ts` + `SidebarActionsContext.tsx` (shared types/context), section components (`QuickChatsSection`, `ProjectsSection`, `ArchivedSection`), item components (`ChatItem`, `ProjectItem`), layout (`SidebarHeader`, `SidebarFooter`, `CollapsedSidebar`, `SmartChatMenu`)
- `src/components/chat/` — Other chat components (MessagesList, ChatInputArea, ChatContextMenu, ProjectLandingPage, etc.)
- `src/components/ui/` — Reusable UI (dialogs, selectors, command palette)
- `src/components/settings/` — Settings tab components
- `src/hooks/` — Custom hooks (useLocalStorage, usePersonas, useAppearanceSettings, etc.)
- `src/lib/` — Utilities: `settings.ts` (DB-first/env-fallback config), `embeddings.ts` (vector search), `chunking.ts` (document chunker), `fileAttachments.ts` (image/file handling), `providers.ts` (shared AI provider factory), `fileExtraction.ts` (shared file parsing), `errors.ts` (API error helper), `validation.ts` (Zod request schemas)
- `src/types.ts` — Shared TypeScript interfaces (`Model`)
- `src/db/` — `schema.ts` (Drizzle schema), `index.ts` (connection with FK enforcement)

### Context Pipeline (`/api/chat`)

Five layers, in order (all degrade gracefully if providers unavailable):
1. **System prompt** — Always included, never trimmed
2. **Document retrieval** — Top-3 similar document chunks (cosine ≥ 0.5) scoped to the project. Uses a single query embedding shared with semantic retrieval.
3. **Semantic retrieval** — Top-5 similar past messages (cosine ≥ 0.7) scoped to the project. Injected as synthetic context messages after document chunks.
4. **Summary** — Compressed older messages (auto-triggers at 30+ messages, keeps last 10 in full)
5. **Recent messages** — Last 20 messages in full detail

Embeddings: 768-dim vectors via Gemini `gemini-embedding-001`. `generateEmbedding()` accepts `taskType` (`'query'`/`'document'`) — Gemini uses this for optimization. Brute-force cosine similarity (fast up to ~50K vectors).

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

Centralized in `src/lib/providers.ts` via `createProvider(modelName)`. Model name prefixes determine the provider: `gemini` → `@ai-sdk/google`, `qwen` → `@ai-sdk/openai` (DashScope OpenAI-compatible endpoint, URL constant `DASHSCOPE_BASE_URL`). Google Search grounding is auto-enabled for all Gemini text models (including thinking variants and Deep Think) via `google.tools.googleSearch({})`. Image models (name contains `image`) are the exception — they skip grounding and instead set `providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }`. Deep Think (name contains `deep-think`) is a virtual model that routes to `gemini-3.1-pro-preview` with `thinkingConfig: { thinkingLevel: 'high' }` plus grounding. Sources stream as `source-url` parts and render as link chips. All POST routes validate request bodies with Zod schemas (`src/lib/validation.ts`).

### Multimodal

**Input**: Images sent as `FileUIPart` via `sendMessage({ text, files })`, persisted in `message_attachments` table (base64 data URLs), reloaded as `file` parts on page load. `convertToModelMessages()` handles format conversion automatically. Both Gemini and Qwen have vision support.

**Output (Nano Banana 2)**: Gemini image models (`gemini-3.1-flash-image-preview`) return generated images as `file` parts in assistant messages. The `onFinish` callback extracts these `file` parts and persists them to `messageAttachments` (same table as user-attached images). Both user-attached and AI-generated images render inline in `MessagesList` with a click-to-expand lightbox overlay (Framer Motion animated, fullscreen with backdrop blur). Generated images display at 512px; user images at 300px.

## AI SDK v6 Gotchas

1. **Stale closure in transport body**: Use a `ref` for dynamic values like selected model
2. **Message format**: Use `convertToModelMessages()` on server; messages use `parts` array, not `content` string
3. **Response format**: Use `toUIMessageStreamResponse({ sendSources: true })` for Google Search sources
4. **SDK v6 API changes**: No `input`/`handleInputChange`/`handleSubmit` — manage input state yourself. No `isLoading` — use `status === 'streaming' || status === 'submitted'`. Send with `sendMessage({ text })`.
5. **libSQL client**: Uses `@libsql/client` (not `better-sqlite3`) — bundles natively in serverless
6. **Google Search tool name**: Must be exactly `google_search` in the `tools` object
7. **AI SDK v6 naming**: Use `maxOutputTokens` (not `maxTokens`) in `generateText()`/`streamText()`
8. **DashScope**: Uses `@ai-sdk/openai` with `createOpenAI({ baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' })`. Must use `.chat(modelName)` (not `provider(modelName)`) — DashScope doesn't support the Responses API. API keys are region-specific (US Virginia, Singapore, Beijing use different hostnames).
9. **Qwen model prefix**: Use `startsWith('qwen')` (not `startsWith('qwen-')`) to match `qwen-plus`, `qwen3-max`, `qwen3.5-plus`, etc.
10. **Source deduplication**: Google Search grounding sends `source-url` parts in `message.parts[]` — deduplicate by URL before rendering
11. **Multimodal images**: `sendMessage({ text, files: FileUIPart[] })` on client, `convertToModelMessages()` on server handles data URL → inline base64 automatically
12. **Gemini image generation**: Image models (name contains `image`) require `providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }` — without this, no images are returned. Must NOT have Google Search grounding tools (incompatible).
13. **Deep Think virtual model**: `gemini-3.1-pro-preview-deep-think` is a virtual model ID — the chat route strips `-deep-think` and routes to `gemini-3.1-pro-preview` with `thinkingConfig: { thinkingLevel: 'high' }`.
14. **Thinking variant virtual models**: Any Gemini model suffixed with `-think-{minimal|low|medium|high}` is a virtual ID — the chat route strips the suffix, resolves to the base model, and sets `thinkingConfig: { thinkingLevel }`. Supported levels per model: Flash (`gemini-3-flash-preview`) → minimal/low/medium/high; Pro (`gemini-3.1-pro-preview`) → low/medium (high = Deep Think); Flash-Lite (`gemini-3.1-flash-lite-preview`) → minimal/low/medium/high. Image models do not support thinking.
15. **Gemini model IDs**: Use `gemini-3-flash-preview` (not `gemini-3.1-flash-preview` — 3.1 Flash doesn't exist). Valid 3.1 models: `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite-preview`, `gemini-3.1-flash-image-preview`.
16. **AI-generated image persistence**: The `onFinish` callback must save `file` parts (not just `text` parts) from assistant messages to `messageAttachments` via `saveMessageAttachments()`. Without this, generated images are lost on page refresh. The load flow (`loadMessages`) already reconstructs `file` parts from attachments.
17. **Image data URLs in new tabs**: Browsers block `data:` URLs opened via `<a target="_blank">` for security. Use a lightbox overlay instead of linking to `data:` URLs directly.
18. **Server action body size limit**: `next.config.ts` sets `experimental.serverActions.bodySizeLimit` to `'10mb'`. Without this, `saveMessageAttachments()` fails silently for Gemini-generated images (base64 data URLs are 1-2MB+, exceeding the default 1MB limit).

## Testing

### Vitest (Unit + Integration)

Config: `vitest.config.ts`. Tests in `tests/`. Node environment by default; hook tests use `// @vitest-environment jsdom` per-file.

**Test structure:** `tests/unit/lib/` (utilities), `tests/unit/actions/` (server actions with in-memory SQLite), `tests/unit/api/` (API routes with mocked providers), `tests/hooks/` (React hooks, jsdom).

**In-memory SQLite**: Import `createTestDb`/`testDb` from `tests/helpers/test-db.ts`, mock `@/db` with a getter, call `createTestDb()` in `beforeEach` (async — uses `@libsql/client`).

**API route tests**: Require `vi.resetModules()` + `vi.doMock()` + dynamic `import()` to re-register mocks after module reset. Must mock `@/lib/settings`, `@/lib/embeddings`, and AI SDK providers alongside `@/db`. The `@ai-sdk/google` mock must include `tools.googleSearch` on the provider function.

### Playwright (E2E)

Config: `playwright.config.ts`. Tests in `e2e/`. Chromium only. Auto-starts dev server.

**Key behaviors:**
- Textarea is always enabled — sending a message auto-creates a standalone quick chat
- Command palette opens with `Control+k` (not `Meta+k` on Linux)
- `CommandPalette` renders a plain `div`, not `dialog` — locate by content

## Deployment

Production: **Vercel** at [atelier-ai.vercel.app](https://atelier-ai.vercel.app). GitHub: [DanielTso/atelier-ai](https://github.com/DanielTso/atelier-ai). Deploy with `vercel --prod`. Schema changes pushed separately: `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx drizzle-kit push`.

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml` — runs on push to `master` and PRs. Single job (ubuntu-latest, Node 22): lint → build → vitest → playwright. No secrets required — all tests mock providers and use in-memory DB.

## Chat Logs

Session logs in `docs/chatlog-*.md`. Update before compacting context or ending long sessions.
