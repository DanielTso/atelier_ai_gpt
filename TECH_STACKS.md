# Implemented Tech Stack

This document outlines the final technology choices used in the "Atelier Studio" application.

## Core Framework
*   **Next.js 16 (App Router):** Chosen for its robust server-side rendering, API route capabilities, and seamless integration with Vercel AI SDK.
*   **TypeScript:** Used throughout for type safety and developer productivity.

## User Interface (UI)
*   **Tailwind CSS v4:** For utility-first styling aligned to the warm-minimal Atelier brand system (light-first, warm paper/terracotta palette, modular cards).
*   **Lucide React:** For lightweight, consistent iconography.
*   **Next-Themes:** For reliable Dark/Light mode switching (also used in Settings Appearance tab).
*   **React Markdown:** To render AI responses with proper formatting (code blocks, bold text, etc.).
*   **Shiki v4:** Lazy client-side syntax highlighting for chat code blocks and code artifacts (`src/lib/highlighter.ts`).
*   **Radix UI:** Headless UI primitives for accessible components.
    *   `@radix-ui/react-dropdown-menu` - Context menus with nested submenus
    *   `@radix-ui/react-dialog` - Modal dialogs (delete confirm, rename, system prompt, settings)
    *   `@radix-ui/react-select` - Accessible select dropdowns (model selector in settings)
    *   `@radix-ui/react-tooltip` - Tooltips for message timestamps and collapsed sidebar icons
*   **Framer Motion:** For smooth message animations, transitions, and image lightbox overlay.
*   **Fraunces + Geist (via `next/font/google`):** Serif display headings; Geist Sans body / Geist Mono code.

## AI & Streaming
*   **Vercel AI SDK v6 (`ai@^6.0`, `@ai-sdk/react@^3.0`):** Handles streaming responses, tools, and multimodal messages.
    *   Uses `DefaultChatTransport` for API communication
    *   Uses `UIMessage` format with `parts` array (not `content` string)
    *   Server uses `convertToModelMessages()` and `toUIMessageStreamResponse()`
*   **Anthropic Claude (`@ai-sdk/anthropic`):** The chat brain. User-selectable models: Opus 4.8 (default), Fable 5, Sonnet 5, Haiku 4.5. Web search via `anthropic.tools.webSearch_20250305`; adaptive thinking + `effort` via `providerOptions.anthropic` (effort omitted for Haiku). Tools: `generate_artifact`, `generate_image`, `read_document`.
*   **Google Gemini (`@ai-sdk/google`):** The senses — image generation (Nano Banana 2, `gemini-3.1-flash-image` with `responseModalities: ['TEXT', 'IMAGE']`), embeddings (`gemini-embedding-001`, 768-dim), document vision extraction, and internal housekeeping models (`gemini-3.5-flash` for title/summarize/classify — not user-selectable).
*   **Tavily:** Web ingestion ("Add from web") — site mapping + page extraction into the RAG store (server-only key).

## Data Persistence
*   **Supabase Postgres + pgvector (`postgres` / postgres-js):** Production database. Pooled URL (`:6543`, transaction pooler, `prepare: false`) at runtime; direct URL (`:5432`) for migrations. HNSW vector indexes + FTS/trigram hybrid retrieval (`content_tsv`, `pg_trgm`).
*   **Drizzle ORM (`drizzle-orm/postgres-js`):** Type-safe ORM. `drizzle.config.ts` uses `dialect: "postgresql"`; versioned migrations in `drizzle/` via `drizzle-kit generate` / `migrate`.
*   **Supabase Storage:** Private bucket for document originals, extracted text, thumbnails, chat attachments, artifacts, and generated images (signed URLs; service-role key server-only).

## Settings & Configuration
*   **Hybrid storage strategy:**
    *   **Server-accessible settings** (API keys, default model/prompt) → Postgres `settings` key-value table with DB-first / environment variable fallback.
    *   **Client-only preferences** (theme, font size, message density, sidebar collapse state) → `localStorage` via `useLocalStorage` hook.
*   **Per-request provider creation:** API routes dynamically create Anthropic/Google providers per request using DB-stored settings (`src/lib/providers.ts`). Enables runtime configuration changes without server restart.
*   **Collapsible sidebar:** Icon-only strip with Radix tooltips when collapsed, full navigation when expanded. State persisted in localStorage.

## Testing
*   **Vitest + PGlite:** Unit/integration tests against an in-process Postgres with real migrations (incl. pgvector + pg_trgm).
*   **Playwright:** E2E (CI-only; local env points at prod with the access gate on).

## Deployment / Runtime
*   **Node.js:** The runtime environment.
*   **Vercel:** Production deployment at [atelier-ai-app.vercel.app](https://atelier-ai-app.vercel.app) (also `atelier-ai-studio.vercel.app`). Auto-deploys on push to `master`; `npx vercel --prod` also works. (The bare `atelier-ai.vercel.app` is an unrelated project — do not use it.)
*   **Supabase:** Postgres + pgvector for production (pooled URL at runtime, direct URL for migrations) and Supabase Storage (private bucket) for document/attachment/artifact files.
*   **GitHub Actions:** CI pipeline (lint → typecheck → build → vitest → drizzle migrate → playwright) on push to `master` and PRs.
