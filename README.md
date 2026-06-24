# Atelier Studio

A unified workspace for chat, construction-document intelligence, projects, and AI-generated artifacts — built for people who treat their work seriously.

## Vision

Atelier Studio is built for individuals, small teams, and companies who want a single, structured AI workspace they can shape to their own workflow. Chat with Claude, upload construction plans and documents into a RAG-powered knowledge base, extract information from drawings via vision, generate brand-styled artifacts (Excel/Word/PDF/PowerPoint, plus HTML pages with a live preview), and have Claude generate images inline — all from one calm, executive-grade interface.

**The provider split — Claude is the brain, Gemini is the senses:**
- **Anthropic Claude** is the chat brain (Opus 4.8 default, Sonnet 4.6, Haiku 4.5) with web search.
- **Google Gemini** handles image generation (Nano Banana 2) and embeddings (RAG) — Anthropic has no embeddings API. Gemini Flash also runs internal housekeeping (titles, summaries, classification) and vision extraction.

## Features

### AI Chat
- **Claude (Anthropic):** Opus 4.8 (default), Sonnet 4.6, and Haiku 4.5 via the Vercel AI SDK v6
- **Web Search:** Claude can search the web and cite sources inline as link chips
- **Image Generation (Nano Banana 2):** Native AI image generation via Gemini `gemini-3.1-flash-image` with persistent Storage and a fullscreen lightbox preview
- **Persona System:** Built-in presets and custom system prompts for different workflows
- **Streaming:** Real-time response streaming with an animated cursor

### Document Intelligence (RAG)
- **Project Knowledge Bases:** Upload PDF, DOCX, XLSX, text/code, and images (png/jpg/webp) to any project
- **Vision Extraction:** Scanned plans and image-only drawings are read by Gemini Flash vision; thin/empty-text PDFs fall back to per-page vision rendering. A `vision` badge marks vision-extracted documents
- **Direct-to-Storage Uploads:** Large construction plans upload straight to Supabase Storage via signed URLs, bypassing serverless request-body limits
- **Thumbnails & Preview:** First-page WebP thumbnails on document cards; a tabbed preview (original inline + reconstructed extracted text)
- **Advanced Retrieval:** query-rewrite → vector top-N → MMR diversity → LLM rerank → top-k, all tunable and degrading gracefully to plain vector search
- **Context-Aware Chat:** The assistant references your uploaded documents when answering, scoped to the project

### Artifacts
- **Claude-generated files:** Claude can produce downloadable **XLSX, DOCX, and PDF** artifacts via the `generate_artifact` tool during a chat turn
- **Pure-JS rendering:** `exceljs` (Excel), `docx` (Word), `pdf-lib` (PDF) — no headless browser; serverless-safe
- **Persisted & signed:** Artifacts are stored in Supabase Storage and surfaced as download cards below the assistant message

### Project Management
- **Organize:** Group chats and documents into projects
- **Project Defaults:** Set per-project personas, models, and system prompts
- **Chat Management:** Rename, move, archive, and restore conversations

### Semantic Memory
- **Long-Term Recall:** Messages are embedded (Gemini `gemini-embedding-001`, 768-dim) and searchable across conversations via pgvector
- **Smart Summarization:** Auto-compresses long conversations while preserving context (triggers at 30+ messages)
- **Five-Layer Context:** System prompt → document RAG → semantic retrieval → summary → recent messages

### Customization
- **Theming:** Light, dark, and system modes on a calm executive-grade interface (Atelier brand system)
- **Appearance:** Configurable font size and message density
- **Settings:** Runtime-configurable API keys and model defaults — DB-first with `.env.local` fallback, no restarts needed

## Prerequisites

1. **Node.js:** v24 LTS
2. **Anthropic API Key:** Required for Claude chat models
3. **Google Gemini API Key:** Required for image generation + embeddings (RAG)
4. **Supabase project:** Postgres (pgvector) + a private Storage bucket for documents/attachments/artifacts

## Setup

1. Install dependencies:
    ```bash
    npm install
    ```
2. Configure environment (create `.env.local`):
    ```bash
    ANTHROPIC_API_KEY=your_key_here
    GOOGLE_GENERATIVE_AI_API_KEY=your_key_here

    # Supabase Postgres (Drizzle on postgres-js, prepare:false for the pooler)
    DATABASE_URL=postgresql://...@...pooler.supabase.com:6543/postgres   # pooled (runtime)
    DIRECT_URL=postgresql://...@...supabase.com:5432/postgres            # direct (migrations)

    # Supabase Storage (private bucket)
    SUPABASE_URL=https://<project-ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
    NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
    SUPABASE_STORAGE_BUCKET=atelier-files
    ```
   The two AI keys can also be set at runtime via **Settings → API Keys** (stored in the `settings` table; DB values take priority over `.env.local`).
3. Apply database migrations (direct connection):
    ```bash
    DIRECT_URL=... npx drizzle-kit migrate
    ```
4. Run the development server:
    ```bash
    npm run dev
    ```
5. Open [http://localhost:3000](http://localhost:3000).

## Testing

```bash
npm test             # Run unit/integration tests (Vitest)
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Run E2E tests (Playwright + Chromium)
npm run test:all     # Run all tests
```

- **Vitest:** 215 unit/integration tests covering utilities, server actions, API routes, embeddings, chunking, retrieval, settings, the artifact engine, and React hooks. DB tests run on **in-process PGlite** (with the pgvector extension + real Drizzle migrations) — no DB secrets needed.
- **Playwright:** E2E tests covering chat flow, project management, and the command palette. Needs a real Postgres locally (`DATABASE_URL`/`DIRECT_URL`).

## Tech Stack

- **Framework:** Next.js 16 (App Router, Fluid Compute / Node — no Edge)
- **Styling:** Tailwind CSS v4 (Atelier Technologies brand system, light-first)
- **Database:** Supabase Postgres + pgvector (HNSW) via Drizzle ORM on `postgres-js`
- **AI:** Vercel AI SDK v6 — Anthropic Claude (chat) + Google Gemini (image gen, embeddings, housekeeping, vision)
- **Embeddings:** Gemini `gemini-embedding-001` (768-dim)
- **Storage:** Supabase Storage (private bucket; signed upload/download URLs)
- **Artifacts:** `exceljs` (XLSX), `docx` (DOCX), `pdf-lib` (PDF)
- **Testing:** Vitest + Testing Library (unit/integration, PGlite), Playwright (E2E)
- **Deployment:** Vercel (Fluid Compute) + Supabase

## Documentation

- [Version History (Changelog)](./CHANGELOG.md)
- [Session Handoff](./docs/SESSION_HANDOFF.md)
- [Tech Stack Details](./TECH_STACKS.md)
- [Project Guide for Claude Code](./CLAUDE.md)
