# Session Handoff — 2026-06-24

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes earlier dated handoffs (kept for history)._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 App Router chat app, a **Claude.ai clone for construction work**. **Claude = brain** (chat, web search, tools); **Gemini = senses** (image gen + embeddings + internal housekeeping). Supabase Postgres + pgvector via Drizzle. Deployed on Vercel. Single-password access gate (live).
- **Everything shipped to `master`, GitHub-released, CI green.** Current version **v4.24.1** (this session also wrote the docs as v4.24.2). Working tree otherwise clean.
- **No half-done work, no pending gated items.** Migrations `0000`–`0011` applied + drizzle ledger in sync.

## What shipped this session (newest first)
- **v4.24.1 — Auto-collapse sidebar** when the artifact panel is dragged wide enough to cramp the chat (restores on narrow/close; only restores what it auto-collapsed). `page.tsx` effect keyed on panel width.
- **v4.24.0 — Resizable artifact panel** — drag the `ArtifactWorkspace` left edge; width clamped 360px..80vw, persisted (`artifact-panel-width`).
- **v4.23.0 — Inline image generation** — `generate_image` tool (`src/lib/image/tool.ts`) lets Claude produce images inline via Nano Banana (`gemini-3.1-flash-image`), uploaded to storage + linked via `saveGeneratedImage` (no base64 in context).
- **v4.22.0 — HTML artifacts with live preview** — `type:"html"` renders in a sandboxed `<iframe srcDoc>` in the workspace.
- **v4.21.2 — Reliable chat auto-titling** — title model budget 50→512 tokens; `maybeGenerateTitle` backfills on chat open; fallback to first user-message words.
- **v4.21.1 — Fix expired artifact downloads** (`InvalidJWT`) — artifact signed-URL TTL 300s→24h (`ARTIFACT_URL_TTL_SECONDS`) at every mint site.
- **v4.21.0 — Clean thinking + sources UI** — collapsible "Thought process" reasoning block (`sendReasoning: true`) + collapsible "N sources".
- **v4.20.5 — Enter sends** (Shift+Enter newline; IME-safe).
- **v4.20.4 — Fix double "AI" bubble** during streaming (typing dots only while awaiting the reply).
- **v4.20.3 — Fix raw Markdown leaking into documents** — xlsx cells via `mdToPlainText`; `inlines()` recurses list-item tokens.
- **v4.20.1/.2 — Artifact polish + chat-first** — PDF table wrapping/header-repeat, PPTX overflow slides; `generate_artifact` gated to explicit file requests (`TOOL_GUIDANCE`).
- **v4.20.0 — Professionally formatted artifacts** — shared `style.ts` (brand) + `markdown.ts` (`marked` AST); all four renderers brand-styled (tables, headings, fonts). Spec/plan: `docs/specs/2026-06-21-artifact-formatting-design.md`, `docs/plans/2026-06-21-artifact-formatting.md`.
- **v4.17.0–v4.19.1 — Projects + chat UX** — projects view (search/sort/New/kebab Rename+Delete), `projects.updated_at` (migration `0011`, "Updated" + sort), chat-header project breadcrumb, artifact-title wrap (de-dup look), project delete with confirmation.

## Live infrastructure
- **Supabase** project ref `evhgyudnjyryayazupgh`. Migrations `0000`–`0011` applied; `drizzle.__drizzle_migrations` ledger in sync (a future `drizzle-kit migrate` is a clean no-op). RLS on all tables. Bucket `atelier-files` (private, 200MB limit).
- **Vercel**: repo linked to project **`atelier-ai`** (prod alias **atelier-ai-app.vercel.app**). Auto-deploys on push to `master`. CLI installed + authed.
- **Access gate LIVE** (`APP_ACCESS_PASSWORD` + `AUTH_SECRET`). Guide: `docs/AUTH.md`.

## Architecture quick-map (see CLAUDE.md for detail)
- `src/app/page.tsx` — single-page client; all app state. `onFinish` persists assistant text, generated images (`saveGeneratedImage`), and backfills titles; auto-collapses the sidebar for a wide artifact panel.
- `src/app/api/chat/route.ts` — five-layer context; merges `generate_artifact` + `generate_image` for Claude when Storage configured; `TOOL_GUIDANCE` (chat-first); `sendSources` + `sendReasoning`.
- `src/lib/artifacts/` — engine: `types.ts` (`xlsx|docx|pdf|pptx|html`), `style.ts`, `markdown.ts` (`marked`), `to{Xlsx,Docx,Pdf,Pptx}.ts`, `render.ts`, `tool.ts`, `path.ts`.
- `src/lib/image/tool.ts` — `generate_image` (Nano Banana, inline).
- `src/components/chat/ArtifactWorkspace.tsx` — resizable Preview/Edit/Versions panel; `ArtifactPreview.tsx` — live previews incl. sandboxed HTML iframe.
- DB tables: projects→chats→messages, settings, messageEmbeddings, documents, documentChunks, documentRevisions, messageAttachments, personaUsage, chatTopics, artifacts, artifactVersions, memorySuggestions.

## Working cadence (the user expects this)
- Act as **Sr Fullstack Engineer**; make decisions, don't stall on small safe steps. New scope → plan mode → spec (`docs/specs/`) → phased plan (`docs/plans/`) → TDD → gate → ship per phase.
- **Gate** before every tag: `npm run typecheck` (0 errors), `npm run lint` (0 errors; ~27 baseline warnings), `npm run build`, `npm test` (currently **335 pass**).
- Solo dev → direct-to-`master` commits + annotated tags `vX.Y.Z`, push `--follow-tags`, `gh release create`, watch CI, confirm Vercel prod Ready. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **User-gated**: live DB migrations + production cutovers. Auth-mode classifier blocks `drizzle-kit migrate` and destructive SQL on prod rows — apply DDL via Supabase MCP `execute_sql` + insert the matching `drizzle.__drizzle_migrations` row (`hash`=sha256 of the migration file, `created_at`=`when` from `drizzle/meta/_journal.json`).
- Do NOT run `vercel env pull` / `vercel dev` (they clobber `.env.local`).

## Next candidates (nothing required)
- Tool-only turns (e.g. an image with no accompanying text) show an `(image)` placeholder on the assistant bubble — cosmetic; could have the model add a sentence or suppress the placeholder.
- React/JSX artifacts (bundler) — deferred; HTML artifacts cover static pages.
- `page.tsx` decomposition into hooks/domain modules (maintainability).
- Full per-user auth (Clerk + `ownerId` scoping) — only if multi-user is wanted; its own project.

## Quick links
- `CLAUDE.md` (source of truth for how the code works) · `CHANGELOG.md` (per-release detail) · `docs/AUTH.md`.
- Specs/plans under `docs/specs/` and `docs/plans/` (dated). Memory index: `~/.claude/projects/.../memory/MEMORY.md`.
