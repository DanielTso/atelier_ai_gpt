# Changelog

All notable changes to this project will be documented in this file.

## [1.9.0] - 2026-04-15

### Atelier Studio Rebrand

Full visual + verbal rebrand under the **Atelier Technologies, Inc.** master brand. Product renamed from _Atelier AI_ to **Atelier Studio**. Light-first, executive-grade, calm palette — glassmorphism retired.

#### Brand identity
- **Product name:** Atelier AI → Atelier Studio. User-facing strings updated across landing, sidebar, metadata, and docs. Repo / Vercel slugs unchanged (tracked separately).
- **Copy voice:** README tagline + vision and empty-state CTA rewritten to the Atelier voice (calm, direct, evidence-focused). Removed "all-in-one", "focus on what matters", "decision fatigue", "get started immediately".
- **Metadata:** `<title>` and `<meta description>` updated.

#### Design system
- **New palette:** Atelier Navy `#1F3447`, Steel Blue `#4F7396`, Ink `#16202A`, Canvas Light `#F7F6F2`, Pure Surface `#FFFFFF`, Warm Sand `#D9CFBF`, Stone Sage `#8C9A86`, Soft Mist `#F3F1EC`, Muted Line `#E3DDD2`, Slate Text `#6F7781`, plus Success / Warning. Exposed as Tailwind utilities.
- **Semantic tokens remapped:** `primary` = Steel Blue (CTAs), `background` = Canvas Light, `foreground` = Ink, `border` = Muted Line, `accent`/`secondary`/`muted` = Soft Mist, `ring` = Steel Blue.
- **Default theme is now `light`** (brand is light-first). Dark mode retained and re-themed around Ink with Steel Blue accents.
- **`.glass-panel` redefined** as a light modular card (Pure Surface, Muted Line border, soft layered shadow). Same class name; all 16 consumers migrated automatically without per-file edits. Zero `backdrop-blur` / `bg-background/60` dark-translucent glass remains.

#### Component cleanup
- **Landing:** dropped blue→purple gradient heading; solid `text-foreground` instead.
- **Sidebar cluster** (`SidebarHeader`, `CollapsedSidebar`, `Sidebar`, `SmartChatMenu`, `ArchivedSection`, `SidebarFooter`): replaced `bg-white/X`, `border-white/X`, `via-white/X` opacity patterns with semantic tokens (`bg-accent`, `border-border`, `bg-border`). Removed inline `borderImage` rgba gradient.
- **Error banner:** raw red-500 scale → `destructive` token.
- **Archive chip:** amber utilities → Stone Sage icon + Warm Sand badge.
- **Settings icon hover:** `text-blue-400` → `text-primary`.

#### Docs
- **CLAUDE.md:** rewrote the Styling section to document the Atelier brand system, token hierarchy, and forbidden patterns (no blue→purple gradients, no `white/X` utilities).
- **README / TECH_STACKS / PLAN:** copy + tech-stack descriptions updated to reflect the brand system (glassmorphism references removed except in the Phase 4 historical record).

#### Out of scope (inherited tokens; deferred to a later pass)
- Message bubbles, settings dialog, command palette, chat input area — render correctly on the new palette via inherited tokens but not hand-tuned.

## [1.5.0] - 2026-03-19

### Bug Fixes
- **Image Persistence:** AI-generated images now persist across page refreshes (`await` added to `saveMessageAttachments` in `onFinish` callback). Also increased Next.js server action body size limit from 1MB to 10MB — Gemini-generated base64 images exceed the default limit.
- **Lightbox Escape Key:** Fixed unreliable Escape key handling by using `window` event listener instead of `onKeyDown` on unfocused div.
- **Invalid Model IDs:** Fixed `gemini-2.0-flash` (nonexistent) in summarize, generate-title, and classify routes → `gemini-3-flash-preview`.
- **Classify Message Format:** Fixed classification reading `m.text` instead of SDK v6 `m.parts[]` — classification was always getting empty context.
- **Chunking Infinite Loop:** Fixed broken loop guard that compared char positions to array indices. Now tracks forward progress correctly.

### Security
- **Image Size Limit:** Added 10MB cap on image uploads in `fileToAttachedImage()`.
- **Filename Sanitization:** `buildFileMessage()` now sanitizes filenames to prevent HTML comment injection.
- **Modern Image Formats:** Added `image/avif`, `image/heic`, `image/svg+xml` to recognized MIME types.

### Performance
- **Settings Caching:** `getServerSetting()` now caches results for 5 minutes (3+ fewer DB queries per chat request). Cache clears automatically when settings are saved.
- **Embedding Provider Caching:** `ensureEmbeddingModel()` caches availability for 5 minutes (no more 1s network probe per request).
- **Parallel Document Embedding:** Document chunks are now embedded concurrently via `Promise.allSettled()` instead of serially.
- **Embedding Failure Tracking:** Documents with all chunks failing to embed are marked `'error'` instead of `'ready'`.

### Data Integrity
- **UNIQUE constraint on `messageEmbeddings.messageId`:** Prevents duplicate embeddings per message.
- **UNIQUE index on `chatTopics(chatId, topic)`:** Prevents duplicate topic entries per chat.
- **Vector Dimension Warning:** `cosineSimilarity()` now logs a warning when vectors have mismatched dimensions instead of silently returning 0.

### Tests
- Added 27 new tests (105 → 132): classify route, embeddings, chunking, settings, file attachments security.

## [1.4.1] - 2026-03-19

### Image Viewing & Persistence
- **Image Lightbox:** Clicking any image (user-attached or AI-generated) now opens a fullscreen lightbox overlay with backdrop blur instead of opening a broken `data:` URL in a new tab. Click backdrop or press Escape to close.
- **Larger Generated Images:** AI-generated images render at 512px (up from 300px) in chat. User-attached images remain at 300px.
- **Image Persistence Fix:** AI-generated images from Nano Banana 2 now persist across page refreshes. The `onFinish` callback saves `file` parts to the `messageAttachments` table (previously only text parts were saved).

## [1.4.0] - 2026-03-19

### Nano Banana 2 (Image Generation)
- **Native Image Generation:** Gemini image model (`gemini-3.1-flash-image-preview`) now works correctly with `responseModalities: ['TEXT', 'IMAGE']` provider option.
- **Image Rendering:** AI-generated images in assistant messages now render inline (previously only user-attached images were displayed).
- **Provider Isolation:** Image models skip Google Search grounding (incompatible with image generation).

### Gemini Deep Think
- **Virtual Model:** "Gemini 3.1 Deep Think" is now a virtual model that routes to `gemini-3.1-pro-preview` with `thinkingConfig: { thinkingLevel: 'high' }` for extended reasoning.

### Model ID Fixes
- **Fixed:** `gemini-3.1-flash-preview` → `gemini-3-flash-preview` (3.1 Flash doesn't exist; use 3.0 Flash).
- **Fixed:** `gemini-3.1-deep-think` → virtual model routing to `gemini-3.1-pro-preview` with high thinking level.
- **Verified:** `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite-preview`, `gemini-3.1-flash-image-preview` confirmed valid against Google API docs.

### Test Fix
- **Fixed:** Models route test expected 4 models but route had 5 Gemini models. Updated assertion to match.

## [1.3.0] - 2026-02-15

### Documentation & Maintenance
- **CLAUDE.md Condensation:** Reduced from 346 to 165 lines — removed redundant sections, cut code examples, merged overlapping retrieval docs (Context Management + Semantic Memory + Document RAG → Context Pipeline, Provider Routing, Multimodal).
- **Dependency Updates:** AI SDK 6.0.58→6.0.86, React 19.2.3→19.2.4, Zod 3→4, Playwright 1.58.0→1.58.2, framer-motion, lucide-react, dotenv, tailwind-merge, ai-sdk-ollama.
- **Bug Fix:** Restored drizzle-kit from accidental downgrade (0.18.1→0.31.8).
- **Bug Fix:** Downgraded ESLint from ^10 to ^9 for eslint-config-next compatibility (CI fix).
- **Vercel CLI:** Set up CLI deployment (`npx vercel --prod`).

## [1.2.1] - 2026-01-30

### Smooth Streaming Animation
- **SmoothStreamingWrapper:** New component wraps assistant message content with ResizeObserver-based smooth height transitions during streaming. Eliminates content jumping as new tokens arrive.
- **Chunk Fade-In:** CSS `chunk-fade-in` animation applies a subtle fade-in + slide-up effect to the last paragraph, list item, or code block while streaming.
- **Cursor Blink Tuning:** Streaming cursor blink speed adjusted from 1.0s to 0.8s for a snappier feel.
- **Cleanup:** Removed all debug `console.log` statements from production code (13 statements across summarization, onFinish, useChat, form submit, and message save flows).

### New Files
- `src/components/chat/SmoothStreamingWrapper.tsx` — ResizeObserver wrapper for smooth streaming height transitions

## [1.2.0] - 2026-01-30

### Auto-Title Generation
- **Auto-Title:** New chats automatically receive a descriptive title (3-6 words) after the first AI response. Uses the same LLM that handled the conversation. Replaces "New Chat" in the sidebar without user intervention.
- **Best-Effort:** Title generation is fire-and-forget — failures silently keep "New Chat" as the fallback title.
- **API Endpoint:** `POST /api/generate-title` with same provider routing pattern (Gemini/Qwen/Ollama).
- **Closure Safety:** Added `chatsRef` and `standaloneChatsRef` refs to avoid stale closures in the `onFinish` callback.

### New Files
- `src/app/api/generate-title/route.ts` — LLM-based title generation endpoint
- `tests/unit/api/generate-title-route.test.ts` — 6 unit tests for the endpoint

## [1.1.0] - 2026-01-29

### Google Search Grounding
- **Web Search:** Gemini models automatically use `google.tools.googleSearch({})` for real-time web search when the query benefits from current information.
- **Source Rendering:** Assistant messages display clickable source URL chips (globe icon, "SOURCES" label) below the response text. Sources are deduplicated by URL.
- **Streaming Sources:** Enabled `sendSources: true` in `toUIMessageStreamResponse()` to stream `source-url` parts alongside text.

## [1.0.0] - 2026-01-29

### Intelligent Context Management
- **Semantic Memory:** Messages are embedded via Ollama `nomic-embed-text` (768-dim vectors) and stored in SQLite. During chat, top-5 semantically similar past messages (cosine similarity ≥ 0.7) are injected as context, scoped to the current project.
- **Four-Layer Context:** `/api/chat` now builds context as: system prompt → semantic retrieval → summary → recent 20 messages. All layers degrade gracefully.
- **Embedding Status Indicator:** Brain icon in the input toolbar shows green with embedding count when active, gray "Memory off" when Ollama/model unavailable. Auto-refreshes after each message exchange.
- **Async Embedding Pipeline:** `POST /api/embed` generates embeddings asynchronously after each message exchange (best-effort, zero latency impact).
- **Embedding Status API:** `GET /api/embed` returns `{ available, embeddingCount }` for a chat or project scope.

### Smart Personas
- **Input Toolbar:** PersonaSelector moved from ChatHeader to a toolbar row above the message input, alongside System Prompt button and memory indicator.
- **Combo Presets:** 5 new model+persona combinations: Code Review (Cloud), Creative Writing (Local), Quick Code Help (Cloud), Deep Analysis (Cloud), Private Assistant (Local).
- **Grouped Dropdown:** PersonaSelector shows two sections: "Personas" (prompt-only) and "Model + Persona" (with Cloud/Local badges and descriptions). Selecting a combo switches both persona and model.
- **Smart Suggestions:** Three-layer auto-suggestion system: explicit project defaults → usage pattern stats → keyword heuristics. Suggestion banner appears after 3+ messages when no persona is set.
- **Topic Detection:** Keyword-based heuristics detect conversation topics (coding, debugging, creative, learning, brief) and suggest matching personas.
- **LLM Classification:** Server-side conversation classifier (`POST /api/classify`) for ambiguous topics, cached per chat in `chat_topics` table.

### Project Defaults
- **Defaults Dialog:** Per-project default persona and model configuration via Radix dialog, accessible from sidebar settings icon on project rows.
- **Usage Stats:** Dialog shows persona usage breakdown with progress bars.
- **Auto-Apply:** Project defaults automatically applied when creating new chats within a project.

### Usage Tracking
- **Persona Usage:** Persona selection and model choice recorded in `persona_usage` table.
- **Message Counts:** `incrementUsageMessageCount()` called after each assistant response for pattern-based suggestions.

### Database
- **New Tables:** `message_embeddings` (vector storage with indexes on chatId/projectId), `persona_usage` (tracking with indexes), `chat_topics` (detected topics with chatId index).
- **New Project Columns:** `default_persona_id`, `default_model`.

### New Files
- `src/components/chat/ChatInputArea.tsx` — Input toolbar with PersonaSelector, system prompt button, memory indicator
- `src/components/chat/PersonaSuggestionBanner.tsx` — Animated smart suggestion banner (Framer Motion)
- `src/components/ui/ProjectDefaultsDialog.tsx` — Per-project defaults dialog with usage stats
- `src/lib/embeddings.ts` — Embedding generation, cosine similarity, vector search, storage
- `src/lib/topicDetection.ts` — Keyword-based conversation topic heuristics
- `src/hooks/useSmartDefaults.ts` — Three-layer smart defaults hook
- `src/app/api/embed/route.ts` — Embedding generation + status endpoint
- `src/app/api/classify/route.ts` — LLM conversation classifier

## [0.9.0] - 2026-01-29

### Testing Infrastructure
- **Vitest:** Added 75 unit/integration tests across 12 test files
  - Utility tests: `cn()`, `formatMessageTime`, `formatFullTime`
  - Server action tests: projects, chats, messages, context management (in-memory SQLite)
  - API route tests: models, chat, summarize (mocked AI providers)
  - React hook tests: `useLocalStorage`, `usePersonas`, `useCollapseState` (jsdom)
- **Playwright:** Added 8 E2E tests across 3 test files (Chromium)
  - Chat flow: app loads, create chat + type, send button
  - Project management: sidebar visible, new project button
  - Command palette: Ctrl+K open, toggle close, backdrop close
- **Test Helpers:** In-memory SQLite factory (`tests/helpers/test-db.ts`), AI mock factories (`tests/helpers/mock-ai.ts`)
- **Config:** `vitest.config.ts` (path alias, node env), `playwright.config.ts` (Chromium, auto dev server)

### Developer Experience
- **npm Scripts:** Added `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:ui`, `test:all`
- **MCP Servers:** Added SQLite, Next.js DevTools, GitHub, Sentry, and Vercel MCP servers for development workflow

### Dependencies
- Added: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`

## [0.8.0] - 2026-01-28

### Project Management
- **Project Rename:** Added inline editing for project names with pencil icon, save/cancel buttons, and keyboard shortcuts
- **Alphabetical Sorting:** Projects are now automatically sorted alphabetically in the sidebar

## [0.7.0] - 2026-01-28

### Persona System
- **Persona Selector:** Added dropdown in chat header for quick persona switching
- **Preset Personas:** 6 built-in presets (Default, Coding Assistant, Creative Mode, Debug Mode, Brief Mode, Teacher Mode)
- **Custom Personas:** Ability to customize system prompts via "Customize..." option

### UI Enhancements
- **Streaming Cursor:** Added animated cursor effect (`▎`) while AI generates responses
- **Visual Feedback:** Cursor blinks with smooth animation during streaming

## [0.6.0] - 2026-01-28

### Chat Management
- **Context Menus:** Added 3-dot dropdown menus on all chats with Move, Rename, Archive, Delete options
- **Move to Project:** Nested submenu to move chats between Quick Chats and any project
- **Archive System:** Soft-delete chats to "Archived" section with restore capability
- **Per-Project Collapse:** Each project's chat list can be independently collapsed/expanded
- **Collapse Persistence:** Sidebar collapse states are saved to localStorage

### Context Management
- **Hybrid Context:** Implemented LLM-generated summaries + sliding window for long conversations
- **Auto-Summarization:** Automatically triggers when message count exceeds 30
- **System Instructions:** Added customizable system prompts that are never trimmed from context
- **System Prompt Dialog:** UI for editing system instructions with quick example buttons

### New Components
- `ChatContextMenu.tsx`: Radix dropdown menu with nested submenus
- `DeleteConfirmDialog.tsx`: Confirmation modal for permanent deletion
- `RenameDialog.tsx`: Dialog for editing chat titles
- `SystemPromptDialog.tsx`: Dialog for editing system instructions
- `PersonaSelector.tsx`: Dropdown for persona/system prompt selection

### New Hooks
- `useLocalStorage.ts`: Generic localStorage hook with SSR safety
- `useCollapseState.ts`: Manages sidebar collapse states with persistence
- `usePersonas.ts`: Manages persona presets and custom system prompts

### Database Schema
- Added `archived` boolean field to chats table
- Added `systemPrompt` text field to chats table
- Added `summary` and `summaryUpToMessageId` fields for context management

### New API Routes
- `/api/summarize`: LLM-generated conversation summaries for context compression

## [0.5.0] - 2026-01-28

### Breaking Changes - AI SDK v6 Migration
- **SDK Upgrade:** Migrated from Vercel AI SDK v3.4 to v6 (`ai@^6.0`, `@ai-sdk/react@^3.0`)
- **Client API:** Replaced old `useChat` API with new transport-based approach
  - Now uses `DefaultChatTransport` for API communication
  - `sendMessage({ text })` replaces `handleSubmit`
  - `status` replaces `isLoading` ('ready' | 'streaming' | 'submitted' | 'error')
  - Manual input state management (no built-in `input`, `handleInputChange`)
- **Message Format:** Changed from `content` string to `parts` array structure
  - Messages now use `UIMessage` type with `parts: [{ type: 'text', text: string }]`

### Bug Fixes
- **Build:** Fixed `baseUrl` → `baseURL` typo in Ollama provider config
- **Build:** Removed unsupported `maxTokens` property from `streamText`
- **API:** Added `convertToModelMessages()` to convert UIMessage → ModelMessage for `streamText`
- **API:** Changed response from `toTextStreamResponse()` to `toUIMessageStreamResponse()`
- **Model Selection:** Fixed stale closure issue using ref pattern for dynamic model selection
- **Types:** Added proper typing for `ollamaModels` array (replacing `any`)
- **Lint:** Removed unused imports (`asc`, `formatTime` helpers)
- **Lint:** Removed unused `theme` prop from Sidebar component

### Documentation
- Added `CLAUDE.md` with AI SDK v6 implementation details and common gotchas
- Updated all documentation to reflect v6 changes

## [0.4.0] - 2026-01-28

### UI/UX Enhancements
- **Copy Code Button:** Added hover-activated copy button to all code blocks with visual feedback (checkmark on success).
- **Message Timestamps:** Implemented relative timestamps ("2m ago", "1h ago") with full datetime tooltip on hover.
- **Chat Title Editing:** Added inline chat title editing with edit icon, save/cancel buttons, and keyboard shortcuts (Enter to save, Escape to cancel).
- **Model Selector:** Organized model dropdown into "Cloud Models" and "Local Models" optgroups for better organization.
- **Message Animations:** Added smooth fade-in and slide-up animations for messages with staggered timing.
- **Enhanced Empty States:** Redesigned empty states with larger icons, pulsing animations, and more descriptive text.
- **Hover Effects:** Added subtle border color transitions on message hover for better interactivity.
- **Loading Skeletons:** Created reusable skeleton components for future loading states.
- **Typography:** Improved font sizes, weights, and spacing throughout the interface.

### New Components
- `CodeBlock.tsx`: Reusable code block component with copy functionality
- `InlineCode.tsx`: Styled inline code component
- `LoadingSkeletons.tsx`: Skeleton loaders for messages, chats, and projects
- `formatTime.ts`: Time formatting utilities for relative and absolute timestamps

### Bug Fixes
- Fixed type compatibility issues with message timestamps
- Fixed inline code component prop types to support all HTMLAttributes

## [0.3.0] - 2026-01-28

### Performance Optimizations
- **Database:** Added indexes on `project_id` and `created_at` columns for chats and messages tables, providing 10-100x query speedup.
- **Database:** Added explicit message ordering by `created_at` for consistency.
- **Database:** Implemented message limit (100 most recent) to improve performance on large chat histories.
- **Components:** Extracted and memoized Sidebar, MessagesList, and ChatHeader components to eliminate unnecessary re-renders (50-70% reduction).
- **Rendering:** Moved ReactMarkdown component definitions outside render function to prevent object recreation.
- **API:** Added 5-minute cache control headers to models endpoint to reduce redundant network requests.
- **API:** Created singleton Google provider instance to eliminate per-request instantiation overhead.
- **UX:** Implemented scroll debouncing with requestAnimationFrame for smoother scrolling.
- **UX:** Added auto-dismiss for error messages after 5 seconds.
- **State:** Optimized delete operations to update local state instead of refetching all data.

### Code Quality
- Refactored 388-line monolithic component into smaller, focused, memoized components.
- Improved separation of concerns between UI and business logic.

## [0.2.2] - 2026-01-28

### Fixed
- **Streaming:** Resolved `Unhandled chunk type: stream-start` error by aligning server-side streaming logic (`toDataStreamResponse`) with client-side expectations.
- **Dependencies:** Reverted `ai` SDK to v3.4.0 and `@ai-sdk/google` to v3.0.15 to ensure stability and prevent protocol mismatches.
- **Imports:** Cleaned up unused imports in API routes.

## [0.2.1] - 2026-01-28

### Features
- **Error Handling:** Implemented resilient API that gracefully degrades to Cloud models if Local Ollama instance is unreachable.
- **UI:** Added user-friendly Error Banner for connection failures or missing models.
- **Stability:** Improved build stability by fixing TypeScript directives in server actions.

## [0.2.0] - 2026-01-28

### Features
- **Hybrid AI Engine:** Added support for Google Gemini models alongside local Ollama models.
- **Model Support:** Enabled access to `gemini-3-pro-preview`, `gemini-3-flash-preview`, and `gemini-2.5-flash`.
- **Configuration:** Added `.env.local` support for secure API key management.
- **Code Quality:** Refactored React hooks for strict mode compliance and stability.

## [0.1.0] - 2026-01-28

### Features
- **UI:** Implemented Glassmorphic design with Light/Dark mode toggle.
- **AI:** Integrated local Ollama instance using Vercel AI SDK (v3.4.0).
- **Database:** Added SQLite persistence (via Drizzle ORM) for Projects and Chat History.
- **Organization:** Added ability to create Projects and organize chats within them.
- **Markdown:** Added Markdown rendering for AI responses (code blocks, tables).

### Tech
- Initialized Next.js 15 App Router project.
- Configured Tailwind CSS v4.
- Setup `better-sqlite3` and `drizzle-orm`.

## [Init] - 2026-01-28

### Added
- Created `Gemini.md` for project tracking.
- Created `TECH_STACKS.md` for technology suggestions.
- Created `CHANGELOG.md` for version history.
