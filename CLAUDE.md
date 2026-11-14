# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Model routing for agent work:** subagent dispatches (implementers, reviewers, audit lanes) are routed by stakes × work shape per [docs/MODEL_ROUTING.md](docs/MODEL_ROUTING.md) — Sonnet for mechanical execution, Opus for planning and judgment, Fable only for architecture-from-prose and the final whole-branch review. Always pass `model:` explicitly on a dispatch.

**Start a new session by reading the latest `docs/SESSION_HANDOFF_<date>.md`** (currently `docs/SESSION_HANDOFF_2026-11-12.md`) — it is the authoritative current-state bootstrap (where the build is, what shipped, live infra, open items). This CLAUDE.md, together with the `docs/architecture/*.md` deep-dives it links to, is the source of truth for *how the code works*; the handoff tracks *where the project is*.

## Build & Development Commands

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
AUTH_SECRET=run_openssl_rand_hex_32                     # HMAC key for the auth cookie + file sigs (REQUIRED in production: gate 503s without it)
```

**Access gate:** single shared password over the whole app via `src/proxy.ts` (Next 16's renamed middleware convention, runs on Node) (+ `/login`, `/api/auth`, `src/lib/auth.ts`). OFF unless `APP_ACCESS_PASSWORD` is set; signed httpOnly cookie = `HMAC-SHA256(AUTH_SECRET, …)`. Single-user app (no per-user data separation) — full per-user auth (Clerk + `ownerId` scoping) is a deferred, separate project. Full operating guide in [docs/AUTH.md](docs/AUTH.md).

**Storage access model:** bucket is **private**. `SUPABASE_SERVICE_ROLE_KEY` (server-only, never sent to client) creates signed upload tokens and mints signed download URLs. The browser uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` only to `uploadToSignedUrl` — it never has broad storage access.

The two AI keys can also be configured at runtime via the **Settings dialog → API Keys tab** (stored in the `settings` table). DB values take priority over `.env.local`.

**Note:** `.env*.local` files are gitignored. Never commit secrets.

The app uses two AI providers with a clear split — **Claude is the brain, Gemini is the senses**:
- **Anthropic Claude** (cloud, `@ai-sdk/anthropic`): the chat brain. Without an Anthropic key, no Claude chat models appear.
- **Google Gemini** (cloud, `@ai-sdk/google`): image generation (Nano Banana 2) + embeddings (RAG) only. Anthropic has **no embeddings API**, so embeddings always run on Gemini regardless of the chat model. Gemini text models are not user-selectable.

### Database

**Supabase Postgres** via Drizzle on `postgres-js` (`drizzle-orm/postgres-js`). Connection at `src/db/index.ts`: `postgres(DATABASE_URL, { prepare: false, max: 10, idle_timeout: 20, connect_timeout: 10, max_lifetime: 60 * 30 })` — `prepare: false` is **required** for Supabase's transaction pooler (no prepared statements); the pool bounds/timeouts (seconds) were added in v4.51.0, and a missing `DATABASE_URL` now throws at startup. Use the **pooled** URL (`DATABASE_URL`, port 6543) at runtime and the **direct** URL (`DIRECT_URL`, port 5432) for migrations.

- **Schema reference:** per-table and per-column notes (the table list, `memorySuggestions`, pgvector/HNSW, `documents.extraction_method` / `failed_pages`, `artifacts`, `document_chunks.content_tsv` and `page_start`/`page_end`, `usage_events`) live in [docs/architecture/database.md](docs/architecture/database.md). Read it before changing `src/db/schema.ts` or authoring a migration.
- **Not in `schema.ts`:** `document_chunks.content_tsv` (generated `tsvector`) and the GIN indexes `idx_chunks_tsv` / `idx_chunks_trgm` exist only in raw-SQL migration `drizzle/0016_hybrid_search.sql` — Drizzle cannot see them (this is why `push` is forbidden, below).
- **`usage_events` is a billing ledger:** `input_tokens` stores FRESH (non-cached) input only, `cost_usd` is frozen at write time, and `chat_id`/`project_id` are `ON DELETE SET NULL` so spend history survives chat/project deletion.
- **Migrations** (versioned, in `drizzle/`): `npx drizzle-kit generate` to author, `DIRECT_URL=... npx drizzle-kit migrate` to apply. `drizzle.config.ts` uses `dialect: "postgresql"`. **`npx drizzle-kit push` is FORBIDDEN in this repo** — it introspects the live DB and would emit DROPs for `document_chunks.content_tsv` + `idx_chunks_tsv`/`idx_chunks_trgm` (raw migration `0016`, invisible to `schema.ts`) and, before `0020`, `DISABLE ROW LEVEL SECURITY` for the tables whose RLS lived only in the dashboard. Always `generate` → `migrate`. Applied to Supabase: `0000`–`0021` (verified 2026-09-11: `drizzle.__drizzle_migrations` = 22 rows; `0018` created `usage_events`, `0019` its `created_at`/`project_id` indexes and CHECKs, `0020` enabled RLS on every table, `0021` revoked `anon`/`authenticated` table grants). **Standing rule for schema-adding releases: migrate BEFORE pushing/deploying.** Deployed Drizzle code emits explicit column lists, so an unmigrated DB breaks whole tables' queries app-wide (e.g. a missing `failed_pages` would break all of `GET/POST /api/documents*` — listing, uploads, the Files panel), not just the new feature. **Keep this line current when a migration is actually APPLIED, not when it's merely authored** — an authored-but-unapplied migration described here as applied (or vice versa) is exactly the kind of stale claim that has already caused one reviewer to raise a false production-degradation alarm; verify against the live DB (`drizzle.__drizzle_migrations` row count) or `drizzle/meta/_journal.json`, not against memory of what should have shipped.

### Security

`getSetting()` and `getSettings()` server actions block the sensitive `gemini-api-key`, `anthropic-api-key`, and `tavily-api-key` from being read by client code (`SENSITIVE_KEYS`). Keys are only accessed server-side via `src/lib/settings.ts` (`getGeminiApiKey()`, `getAnthropicApiKey()`, `getTavilyApiKey()`). The `getApiKeyStatus()` server action returns booleans only (`{ gemini, anthropic, tavily }`, configured / not) so the API Keys UI can show status without exposing values. All POST API routes validate request bodies with Zod schemas; error responses are sanitized via `apiError()` helper (no raw error messages to clients). `POST /api/auth` (the access-gate login) is throttled by a best-effort in-memory login limiter (`src/lib/rateLimit.ts` — 10 attempts / 15-min window per IP, reserved synchronously before any await so a parallel burst cannot slip past, keyed on the rightmost `X-Forwarded-For` hop); it slows online password guessing but is per-instance, not distributed (add a Vercel WAF rule on `POST /api/auth` for a hard guarantee). The proxy exempts `/login` for GET/HEAD only, and in production refuses to run the gate without `AUTH_SECRET` (503 on every path).

**Database exposure model:** every `public` table has row-level security enabled with zero policies (migration `0020` — declared in `schema.ts` via `.enableRLS()`, no longer a dashboard-only setting) and `anon`/`authenticated` hold no table grants (`0021`), so the browser-shipped `NEXT_PUBLIC_SUPABASE_ANON_KEY` cannot read or write app tables through PostgREST. The app itself is unaffected: it connects as the table-owning `postgres` role, which bypasses RLS.

**Security headers (`next.config.ts`):** a CSP (with `'unsafe-inline'` — the Next 16 Turbopack nonce pipeline was attempted + found broken, see the inline comment), with `connect-src 'self' <supabase origin>` (no blanket `https:`, so HTML artifacts cannot exfiltrate; `https:` only as the fallback when the Supabase URL is unset) and `object-src 'self'`, plus `X-Content-Type-Options: nosniff`, HSTS, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Powered-By` off, and **`X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`** (relaxed from `DENY`/`'none'` so the app can frame its own same-origin PDF proxy at `/api/artifacts/:id/raw`; cross-origin framing of the app is still blocked). `frame-src`/`img-src` allow the Supabase origin (`img-src` also `i.ytimg.com` for video thumbnail cards; no YouTube frames). Headers are built in `src/lib/securityHeaders.ts`. Note: Next's header `source` cannot negative-lookahead-exclude a path (that's the middleware matcher) — vary a header by relaxing the global value or setting it in the route handler.

## Architecture Overview

Atelier Studio is a Next.js 16 App Router chat application. **Claude (Anthropic) is the chat brain; Google Gemini handles image generation and embeddings.**

### Data Flow

1. **Client** (`src/app/page.tsx`) — single-page chat UI on the AI SDK's `useChat` (`@ai-sdk/react`), one chat session per DB chat (`useChatSessions`); all application state lives here. Sending a message with no active chat auto-creates a standalone quick chat.
2. **Server Actions** (`src/app/actions.ts`) — "use server" functions for all DB reads/writes.
3. **API routes** (`src/app/api/`) — streaming chat, model list, documents (3-step direct-to-Storage upload), web ingestion, artifacts, images, and the Gemini Flash housekeeping routes (summarize, title, classify, memory-suggest).

**Chat turns are persisted by the server.** `POST /api/chat` saves the user's message and the assistant's reply to the request's `chatId` (the reply exactly once — full text at finish, streamed-so-far text on abort) and reports `{ chatId, projectId, userMessageDbId, assistantMessageDbId }` as message metadata. The client writes no message text; its turn steps (`useChatPersistence` — attachments, embeds, memory, title…) take every id from that metadata, never from `activeChatId`/`activeProjectId`. Switching chats never calls `stop()` — each chat has its own session, and a reply left streaming is still saved to the chat it was sent from. Read "Chat turns" in [docs/architecture/data-flow.md](docs/architecture/data-flow.md) before touching `/api/chat` persistence, `useChatSessions`, `useChatPersistence` or the send paths in `page.tsx`.

Route-by-route reference (request shapes, status codes, guards): [docs/architecture/data-flow.md](docs/architecture/data-flow.md).

### Deep-dive references (read before touching the area)

These sections were moved out of this file word for word so they load only when needed. **Read the matching doc before changing code in that area** — they carry gotchas, not just description — and keep them current the same way this file is kept current.

| Working on… | Read first |
|---|---|
| API routes, upload/ingest flows, client ↔ server data flow | [docs/architecture/data-flow.md](docs/architecture/data-flow.md) |
| Finding where something lives (`src/` tour: components, hooks, `src/lib/*`) | [docs/architecture/source-map.md](docs/architecture/source-map.md) |
| RAG: retrieval, hybrid search, `read_document`, citations/grounding, vision extraction | [docs/architecture/rag-pipeline.md](docs/architecture/rag-pipeline.md) |
| Model registry, pricing, effort capabilities, persona tiers, cost capture | [docs/architecture/model-registry.md](docs/architecture/model-registry.md) |
| Attachments, image generation, artifacts and `ArtifactWorkspace` | [docs/architecture/multimodal-artifacts.md](docs/architecture/multimodal-artifacts.md) |
| Tables/columns, pgvector, raw-SQL migration `0016`, `usage_events` shape | [docs/architecture/database.md](docs/architecture/database.md) |

### Context Pipeline (`/api/chat`)

Five layers, in order (all degrade gracefully if providers are unavailable): system prompt → document retrieval → semantic (past-message) retrieval → summary → recent messages. Embeddings are 768-dim Gemini `gemini-embedding-001`; retrieval is native pgvector; every advanced stage (query rewrite, hybrid keyword + RRF, MMR, LLM rerank) is best-effort and tunable in `src/lib/ragConfig.ts`.

Full reference — retrieval stages and env knobs, whole-document `read_document` mode, grounded & cited answers, vision/hybrid extraction: [docs/architecture/rag-pipeline.md](docs/architecture/rag-pipeline.md).

⚠️ **Tailwind scanner gotcha (can BREAK cold builds):** a literal citation marker (the bracketed `cite:` form followed by digits) in a scanned source file becomes an arbitrary-property CSS candidate. `globals.css` has `@source not` exclusions (tests/, docs/, e2e/, `src/app/api`, `citations.ts`, `documents/tool.ts`, and this file); never write literal markers in other scanned files (describe, don't exemplify) and keep gate builds cold (`rm -rf .next`).

### State Management

- **Server state**: Supabase Postgres (Drizzle) via server actions
- **Settings**: `src/lib/settings.ts` — DB-first, env-fallback pattern. All API routes create providers **per-request** (not module-level singletons) for runtime config changes without restart.
- **UI persistence**: `useLocalStorage` hook with deferred hydration (reads in `useEffect` to avoid SSR mismatch). Instances sharing a key sync **cross-tab** (`storage` event) and, since v4.51.0, **within the same tab** via a `local-storage` CustomEvent broadcast on write — a last-seen-raw ref breaks echo loops on object values (don't remove it; objects never bail on `Object.is`). Since Grounded & Cited Answers: **dynamic keys are safe** — a key change re-hydrates (or resets to the initial on an empty bucket, without carry-over or phantom writes), and initial values are never persisted until the first real `set`.
- **Theme**: `next-themes` with class-based dark/light/system switching
- **Refs for closures**: Dynamic values (selectedModel, effort, grounded, chats) use `useRef` to avoid stale closures in the chat request body and the turn-finish callback. The request's `chatId` is **not** one of them — it is bound to the chat session a message is sent through (`useChatSessions`), so it cannot go stale

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

Centralized in `src/lib/providers.ts` via `createProvider(modelName, effort?)`, which routes by model-name prefix:

- **`claude-*` → Anthropic** (`@ai-sdk/anthropic`, `createAnthropic({ apiKey })`). Web search is enabled via `tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) }`. **Adaptive thinking + effort:** `providerOptions.anthropic = { thinking: { type: 'adaptive' }, effort }` for Claude models. `effort` is only attached when the resolved model's registry **capabilities** report that exact level as supported (`getModelCapabilities(modelName).effortLevels.includes(effort)`, `src/lib/models/registry.ts`) — a per-level check, not just per-model: legacy pins like `claude-sonnet-4-6` predate `xhigh` and only report `['low','medium','high','max']`, and would 400 if sent it. **Effort is never attached for Haiku** (empty `effortLevels` — the API 400s on Haiku regardless). `budget_tokens` is gone — adaptive thinking is the supported on-mode. Throws if no Anthropic key.
- **`gemini-*image*` → Gemini image** — `providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }`, no grounding.
- **other `gemini-*` → internal Gemini text** (utility tasks + the embedding plumbing) — Google Search grounding via `google.tools.googleSearch({})`.
- **anything else → throws** `Unknown model provider`.

Embeddings always run on Gemini (`gemini-embedding-001`) regardless of chat model — Anthropic has no embeddings API. Sources stream as `source-url` parts and render as link chips (both Google grounding and Claude web search emit them). All POST routes validate request bodies with Zod schemas (`src/lib/validation.ts`) — the `model` field is a **shape guard only** (`z.string().min(1).max(64).regex(...)`), not an allow-list; the real allow-list is the live registry (see below), which degrades an unknown/stale id instead of 400ing.

### Model Registry & Cost Visibility

Model ids, pricing, effort capabilities and persona tiers come from the live registry in `src/lib/models/`; `recordUsage()` (`src/lib/usage.ts`) writes one best-effort `usage_events` row per LLM generation. Full reference: [docs/architecture/model-registry.md](docs/architecture/model-registry.md) (spec: `docs/specs/2026-07-21-dynamic-model-registry-design.md`). Landmines that apply even to small edits:

- **Look models up through `registry.byId` / `resolveRequestedModel()` only.** The live catalog often ships a family with only a dated snapshot id; a lookup that assumed a bare alias once made every Haiku request silently resolve to Opus (5× cost).
- **Resolvers never throw** — an unknown/retired id falls back to the default. The default is the first **Anthropic** entry in `curated`, never `curated[0]` literally.
- **`usage.inputTokens` from the AI SDK is inclusive of cache tokens.** Use `usageTokens()` (`usage.ts`); never bill from the raw field, or cached tokens are double-counted.
- **Usage writes never fail a request:** every call site is `void recordUsage({...}).catch(() => {})`, and `/api/chat` writes exactly one row per request (first-wins guard across `onAbort`/`onFinish`).
- **`resolveTier()` is server-only** (it reads API keys) — never import it into the `'use client'` persona hook; client-side resolution uses the `GET /api/models` list.
- **Contract Abstract stays pinned to the exact `claude-fable-5`** — its locked 22-field extraction schema must not follow a tier.
- **`ChatContextMenu` imports `@/app/actions` dynamically** — a static import pulls `@/db` into jsdom test renders and throws on a missing `DATABASE_URL`.

### Multimodal

Image input (`FileUIPart`), document surfaces, chat-attachment persistence, Nano Banana 2 image output, and Claude-generated artifacts (`generate_artifact`, `ArtifactWorkspace`) are documented in [docs/architecture/multimodal-artifacts.md](docs/architecture/multimodal-artifacts.md). Rules that apply even to small edits:

- **Chat attachments are dual-write / dual-read:** a `message_attachments` row carries `storage_path` (Storage configured) or a base64 `data_url` (fallback) — one or the other; keep both paths working.
- **PDF previews iframe the same-origin proxy** `/api/artifacts/:id/raw`, never the cross-origin Supabase signed URL (browsers block it).
- **HTML artifact previews stay sandboxed** (`<iframe srcDoc>` with `sandbox="allow-scripts"`, no same-origin).

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
11. **Claude provider**: `claude-*` models route via `@ai-sdk/anthropic` (`createAnthropic({ apiKey })`). Web search via `anthropic.tools.webSearch_20250305({ maxUses: 5 })` under `tools: { web_search }`. **Adaptive thinking + capability-driven effort:** pass `providerOptions.anthropic = { thinking: { type: 'adaptive' }, effort }` — `effort` is only attached when the resolved model's registry `effortLevels` reports that level as supported (see Model Registry & Cost Visibility). `budget_tokens` is removed (400 on Opus 4.8). Haiku's `effortLevels` is always empty, so `effort` is never attached there — the API rejects it. Effort flows from the active persona (and the composer effort pill, clamped to the selected model's supported levels) → chat request body → `createProvider`. Embeddings stay on Gemini (Anthropic has no embeddings API).
12. **Model IDs are dynamic, not a hardcoded enum**: the picker (`GET /api/models`) serves the **live model registry** (`src/lib/models/registry.ts`), not a static array — a new Anthropic release appears with zero code change once Anthropic ships it (verified live: Opus 5 appeared with no code change). Request validation (`src/lib/validation.ts`) is a **shape guard only** (`z.string().regex(...)`), not an allow-list — there is no `MODEL_IDS` enum to update for a new id. The registry curates one newest entry per family (`opus`/`fable`/`sonnet`/`haiku`) plus `gemini-3.1-flash-image` (Nano Banana 2) when the Gemini key is set; a retired id like `claude-sonnet-4-6` stays routable via `LEGACY_PINS` (`src/lib/models/seed.ts`) even after it drops out of the picker. Gemini *text* models are still not user-selectable; `gemini-3.5-flash` remains internal-only (title/summarize/classify/memory-suggest) and absent from `GET /api/models`. See **Model Registry & Cost Visibility** above for curation, pricing, alias-vs-dated-id handling, and persona tiers.
13. **AI-generated image persistence**: The turn pipeline (`useChatPersistence`, at turn end) must save `file` parts from assistant messages to `messageAttachments` via `saveMessageAttachments()`, keyed to the assistant row `/api/chat` saved (`assistantMessageDbId` in the turn metadata) — the server persists message TEXT only. Without this, generated images are lost on page refresh. The load flow (`loadMessages`) already reconstructs `file` parts from attachments.
14. **Image data URLs in new tabs**: Browsers block `data:` URLs opened via `<a target="_blank">` for security. Use a lightbox overlay instead of linking to `data:` URLs directly.
15. **Server action body size limit**: `next.config.ts` sets `experimental.serverActions.bodySizeLimit` to `'10mb'`. Without this, `saveMessageAttachments()` fails silently for Gemini-generated images (base64 data URLs are 1-2MB+, exceeding the default 1MB limit).

## Testing

### Vitest (Unit + Integration)

Config: `vitest.config.ts`. Tests in `tests/`. Node environment by default; hook tests use `// @vitest-environment jsdom` per-file.

**Test structure:** `tests/unit/lib/` (utilities), `tests/unit/actions/` (server actions against in-process PGlite Postgres), `tests/unit/api/` (API routes with mocked providers), `tests/hooks/` (React hooks, jsdom).

**In-process Postgres (PGlite)**: Import `createTestDb`/`testDb` from `tests/helpers/test-db.ts`, mock `@/db` with a getter, call `createTestDb()` in `beforeEach`. The `PGlite` instance (with the `vector` and, since RAG Phase 3, `pg_trgm` extensions — `@electric-sql/pglite/vector` + `@electric-sql/pglite/contrib/pg_trgm`) + real Drizzle migrations from `drizzle/` are created **once per test file** (Vitest's forks pool isolates module state per file — ~9 s per DB file, ~65 s for the whole suite); each later `createTestDb()` in that file `TRUNCATE … RESTART IDENTITY CASCADE`s all tables for isolation. Always call it from `beforeEach` (covered by `hookTimeout: 30000`); `testTimeout` is 15 s. Tests exercise the actual schema incl. pgvector + HNSW + `content_tsv`/trigram GIN indexes; no DB secrets needed in CI. (PGlite is pinned to `^0.4.6` — v0.5.x dropped the `./vector` export.)

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
