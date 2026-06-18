# Project Plan: Atelier Studio

## Tech Stack
- **Framework:** Next.js 16 (App Router, Fluid Compute / Node)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS v4 (Atelier Technologies brand system, light-first)
- **Icons:** Lucide React
- **AI Integration:** Vercel AI SDK v6 — Anthropic Claude (chat brain) + Google Gemini (image gen, embeddings, housekeeping, vision)
- **Database:** Supabase Postgres + pgvector (HNSW) via `drizzle-orm/postgres-js` (pooled runtime / direct migrations)
- **Storage:** Supabase Storage (private bucket; signed upload/download URLs)
- **Theme:** `next-themes` for Dark/Light mode
- **Deployment:** Vercel (Fluid Compute) + Supabase
- **CI:** GitHub Actions (lint → build → vitest → drizzle migrate → playwright)

> **Note:** the phase checklist below is the original v1 UI/feature build (historical). The current multi-phase program (A: Claude provider · B/B2: Supabase + RAG · C: vision extraction + Storage · D: artifacts) is tracked in [CHANGELOG.md](./CHANGELOG.md) and [docs/SESSION_HANDOFF.md](./docs/SESSION_HANDOFF.md).

## Phases

### Phase 1: Initialization & UI Scaffold
**Goal:** A running Next.js app with the basic visual structure (Sidebar + Chat Area) and Theme switching.
- [x] Initialize Next.js project.
- [x] Install dependencies (`lucide-react`, `next-themes`, `clsx`, `tailwind-merge`).
- [x] Configure Tailwind with the Atelier brand palette (Canvas Light, Steel Blue, Ink, Muted Line, Soft Mist).
- [x] Create Layout: Sidebar (Projects/History) + Main (Chat).
- [x] Implement Dark/Light mode toggle.
- [x] **Test:** App starts, Theme toggle works, responsive layout.

### Phase 2: AI Provider Integration
**Goal:** Chat with cloud LLMs.
- [x] Install `ai` SDK and provider packages.
- [x] Create `api/chat` route for streaming responses.
- [x] Create `api/models` route with curated model list (gated by API key presence).
- [x] Implement `ChatInterface` component with Input and Message list.
- [x] Implement Model Selector (Dropdown).
- [x] **Test:** Can select a model, send a message, and receive a streaming response.

### Phase 3: Data Persistence (SQLite)
**Goal:** Save Projects and Chat History.
- [x] Set up `drizzle-orm` and `better-sqlite3`.
- [x] Define Schema: `Project` (id, name, icon), `Chat` (id, projectId, title), `Message` (id, chatId, role, content).
- [x] Create Server Actions or API routes for CRUD operations.
- [x] Connect UI: Create Project -> New Chat -> Save Messages.
- [x] **Test:** Data persists across restarts. "Folders" (Projects) organize chats correctly.

### Phase 4: Polish & Refinement
**Goal:** Beautiful Glassmorphism and specialized features.
- [x] Enhance UI: Add nice background gradients/blobs to emphasize glass effect.
- [x] Markdown support for AI responses (Code blocks with syntax highlighting).
- [x] Error handling (Ollama not running, model not found).
- [x] **Test:** Full end-to-end usage flow. Verified DB persistence via script.

### Phase 5: Chat Management & Organization
**Goal:** Advanced chat organization with context menus and archive system.
- [x] Add chat context menus (Move, Rename, Archive, Delete).
- [x] Implement per-project collapse with localStorage persistence.
- [x] Add archive system with soft-delete and restore.
- [x] Add confirmation dialogs for destructive actions.
- [x] **Test:** Move chats between projects, archive/restore, collapse persistence.

### Phase 6: Context Management & System Instructions
**Goal:** Handle long conversations without losing context.
- [x] Implement hybrid context (LLM summaries + sliding window).
- [x] Add system prompt support (never trimmed from context).
- [x] Auto-summarize when message count exceeds threshold.
- [x] Add System Prompt Dialog for custom instructions.
- [x] **Test:** Long conversations maintain context, system prompts persist.

### Phase 7: Persona System & UX Polish
**Goal:** Quick persona switching and streaming improvements.
- [x] Add persona selector with 6 built-in presets.
- [x] Implement streaming cursor animation.
- [x] Add project rename with inline editing.
- [x] Implement alphabetical sorting for projects.
- [x] **Test:** Persona switching, streaming cursor, project management.

### Phase 8: Settings & Collapsible Sidebar
**Goal:** Full settings management with DB-backed configuration and collapsible sidebar.
- [x] Add SQLite `settings` key-value table (key PK, value, updatedAt).
- [x] Add settings CRUD server actions (`getSetting`, `getSettings`, `setSetting`, `setSettings`).
- [x] Create server-side settings helper with DB-first / env-fallback pattern.
- [x] Migrate API routes to per-request provider creation (no more module-level singletons).
- [x] Build Settings dialog with three tabs:
  - **API & Providers:** Gemini API key, DashScope API key (password fields).
  - **Appearance:** Theme cards (Light/Dark/System), font size, message density.
  - **Model Defaults:** Default model selector, default system prompt, persona management.
- [x] Implement collapsible sidebar (icon-only strip with tooltips when collapsed, localStorage-persisted).
- [x] Wire settings dialog and sidebar collapse into main page.
- [x] Fix message timestamps (include `createdAt` from DB in UIMessage mapping).
- [x] Fix `useLocalStorage` hydration mismatch (defer localStorage read to `useEffect`).
- [x] Update test mocks for per-request provider pattern.
- [x] **Test:** Settings persist in DB, env fallback works, sidebar collapses/expands, timestamps display correctly, all 76 tests pass.

### Phase 9: Auto-Title Generation
**Goal:** Automatically generate descriptive chat titles after the first AI response.
- [x] Create `POST /api/generate-title` endpoint with same provider routing pattern.
- [x] Add auto-title trigger in `onFinish` callback (fires when messageCount === 2 and title === "New Chat").
- [x] Add `chatsRef` and `standaloneChatsRef` refs to avoid stale closures.
- [x] Update sidebar and header state after title generation.
- [x] Add 6 unit tests for the endpoint.
- [x] **Test:** New chat → send message → AI responds → sidebar title updates from "New Chat" to a descriptive label.

### Phase 10: Document RAG & Multimodal
**Goal:** Project-scoped document upload with retrieval-augmented generation and image input.
- [x] Document upload pipeline (PDF, DOCX, TXT, MD, CSV, code files).
- [x] Sentence-aware chunking (2000 chars, 400 overlap) with embedding.
- [x] Five-layer context: system prompt → document chunks → semantic retrieval → summary → recent messages.
- [x] Multimodal image input via clipboard paste, drag-and-drop, or file picker.
- [x] Image persistence in `message_attachments` table.
- [x] **Test:** Upload documents, verify RAG retrieval, send images in chat.

### Phase 11: Cloud Deployment & CI
**Goal:** Production deployment with continuous integration.
- [x] Deploy to Vercel with Turso remote database.
- [x] Migrate from `better-sqlite3` to `@libsql/client` for serverless compatibility.
- [x] Add Alibaba Cloud Qwen (DashScope) as second AI provider.
- [x] GitHub Actions CI pipeline (lint, build, vitest, playwright).
- [x] Vercel CLI setup for direct deployments.
- [x] **Test:** All 105 Vitest + 8 Playwright tests pass in CI.

## Status
All planned phases complete. Production deployed at [atelier-ai.vercel.app](https://atelier-ai.vercel.app).