# Implemented Tech Stack

This document outlines the final technology choices used in the "Atelier Studio" application.

## Core Framework
*   **Next.js 16 (App Router):** Chosen for its robust server-side rendering, API route capabilities, and seamless integration with Vercel AI SDK.
*   **TypeScript:** Used throughout for type safety and developer productivity.

## User Interface (UI)
*   **Tailwind CSS v4:** For utility-first styling and easy implementation of the "Glassmorphism" aesthetic.
*   **Lucide React:** For lightweight, consistent iconography.
*   **Next-Themes:** For reliable Dark/Light mode switching (also used in Settings Appearance tab).
*   **React Markdown:** To render AI responses with proper formatting (code blocks, bold text, etc.).
*   **Radix UI:** Headless UI primitives for accessible components.
    *   `@radix-ui/react-dropdown-menu` - Context menus with nested submenus
    *   `@radix-ui/react-dialog` - Modal dialogs (delete confirm, rename, system prompt, settings)
    *   `@radix-ui/react-select` - Accessible select dropdowns (model selector in settings)
    *   `@radix-ui/react-tooltip` - Tooltips for message timestamps and collapsed sidebar icons
*   **Framer Motion:** For smooth message animations, transitions, and image lightbox overlay.

## AI & Streaming
*   **Vercel AI SDK v6 (`ai@^6.0`, `@ai-sdk/react@^3.0`):** A powerful library for handling streaming responses from LLMs. Upgraded to v6 for latest features.
    *   Uses `DefaultChatTransport` for API communication
    *   Uses `UIMessage` format with `parts` array (not `content` string)
    *   Server uses `convertToModelMessages()` and `toUIMessageStreamResponse()`
*   **Google Generative AI SDK (`@ai-sdk/google`):** For integrating Gemini cloud models (Gemini 3 Flash, 3.1 Pro, 3.1 Flash-Lite, 3.1 Flash Image / Nano Banana 2). Supports `providerOptions` for image generation (`responseModalities: ['TEXT', 'IMAGE']`) and adaptive thinking (`thinkingConfig: { thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' }`). Virtual model IDs suffixed with `-think-{level}` resolve to the base model with the corresponding thinking config; Pro's `high` uses the `-deep-think` suffix.
*   **Alibaba Cloud DashScope (`@ai-sdk/openai`):** For Qwen cloud models via OpenAI-compatible endpoint (`dashscope-intl.aliyuncs.com`).

## Data Persistence
*   **SQLite (`@libsql/client`):** Supports both local SQLite files (`file:sqlite.db`) and remote Turso databases. Bundles natively in serverless — no `serverExternalPackages` needed.
*   **Drizzle ORM (`drizzle-orm/libsql`):** A lightweight, type-safe ORM. Drizzle config uses `dialect: "turso"`.

## Settings & Configuration
*   **Hybrid storage strategy:**
    *   **Server-accessible settings** (API keys, provider URLs, default model/prompt) → SQLite `settings` key-value table with DB-first / environment variable fallback.
    *   **Client-only preferences** (theme, font size, message density, sidebar collapse state) → `localStorage` via `useLocalStorage` hook.
*   **Per-request provider creation:** API routes dynamically create Google/Qwen providers per request using DB-stored settings. Enables runtime configuration changes without server restart.
*   **Collapsible sidebar:** Icon-only strip with Radix tooltips when collapsed, full navigation when expanded. State persisted in localStorage.

## Deployment / Runtime
*   **Node.js:** The runtime environment.
*   **Vercel:** Production deployment at [atelier-ai.vercel.app](https://atelier-ai.vercel.app). CLI deployments via `npx vercel --prod`.
*   **Turso:** Remote libSQL database for production. Local development uses `file:sqlite.db`.
*   **GitHub Actions:** CI pipeline (lint → build → vitest → playwright) on push to `master` and PRs.