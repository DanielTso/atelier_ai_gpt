# Atelier Studio

Your all-in-one AI platform for work, school, and life. Atelier Studio brings together chat, document intelligence, project management, and content generation into a single customizable dashboard — so you can focus on what matters instead of juggling tools.

## Vision

Atelier Studio is designed for individuals, small teams, and companies who want a unified AI workspace they can make their own. Bring your own models (local, cloud, or fine-tuned), connect automation agents, upload documents for RAG-powered knowledge bases, and manage projects — all from one place. Pre-templated themes and sensible defaults eliminate decision fatigue so you can get started immediately.

## Features

### AI Chat
- **Multi-Provider:** Switch between Google Gemini and Alibaba Cloud Qwen models
- **Persona System:** 6 built-in presets and custom system prompts for different workflows
- **Google Search Grounding:** Gemini text models can search the web and cite sources inline
- **Image Generation (Nano Banana 2):** Native AI image generation via Gemini `gemini-3.1-flash-image-preview` with persistent storage and fullscreen lightbox preview
- **Adaptive Thinking:** Per-model thinking level toggle (Off / Min / Low / Med / High) — Flash, Flash-Lite, and Pro all support configurable reasoning depth. Deep Think routes Pro to maximum thinking.
- **Streaming:** Real-time response streaming with animated cursor

### Document Intelligence (RAG)
- **Project Knowledge Bases:** Upload PDF, DOCX, text, and code files to any project
- **Automatic Chunking & Embedding:** Documents are processed and indexed for semantic retrieval
- **Context-Aware Chat:** The AI references your uploaded documents when answering questions

### Project Management
- **Organize:** Group chats and documents into projects
- **Project Defaults:** Set per-project personas, models, and system prompts
- **Chat Management:** Rename, move, archive, and restore conversations

### Semantic Memory
- **Long-Term Recall:** Messages are embedded and searchable across conversations
- **Smart Summarization:** Auto-compresses long conversations while preserving context (triggers at 30+ messages)
- **Five-Layer Context:** System prompt, document RAG, semantic retrieval, summary, and recent messages

### Customization
- **Theming:** Dark, light, and system modes with glassmorphism design
- **Appearance:** Configurable font size and message density
- **Settings:** Runtime-configurable API keys, model defaults, and provider URLs — no restarts needed

### Automation (Planned)
- **n8n Integration:** Connect external automation agents to the Atelier Studio platform
- **Extensible:** Plugin architecture for custom workflows and integrations

## Prerequisites

1. **Node.js**: v18 or higher
2. **Google Gemini API Key**: For Gemini models
3. **DashScope API Key**: For Alibaba Qwen models

## Setup

1. Install dependencies:
    ```bash
    npm install
    ```
2. Configure environment (create `.env.local`):
    ```bash
    GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key_here
    DASHSCOPE_API_KEY=your_dashscope_api_key_here
    ```
3. Initialize the database:
    ```bash
    npx drizzle-kit push
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

- **Vitest:** 132 unit/integration tests covering utilities, server actions, API routes, embeddings, chunking, settings, and React hooks. Uses in-memory SQLite for isolated DB tests.
- **Playwright:** 8 E2E tests covering chat flow, project management, and command palette.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS v4
- **Database:** SQLite (local) / Turso (production) + Drizzle ORM
- **AI:** Vercel AI SDK v6 + Google Gemini + Alibaba Qwen
- **Embeddings:** Gemini gemini-embedding-001 (768-dim)
- **Testing:** Vitest + Testing Library (unit/integration), Playwright (E2E)
- **Deployment:** Vercel + Turso

## Documentation

- [Version History (Changelog)](./CHANGELOG.md)
- [Project Plan](./PLAN.md)
- [Tech Stack Details](./TECH_STACKS.md)
- [Claude Code Guide](./CLAUDE.md)
