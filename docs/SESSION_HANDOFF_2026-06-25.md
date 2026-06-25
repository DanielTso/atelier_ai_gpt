# Session Handoff — 2026-06-25

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes earlier dated handoffs (kept for history)._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 App Router chat app, a **Claude.ai-style clone for construction work**. **Claude = brain** (chat, web search, tools); **Gemini = senses** (image gen + embeddings + internal housekeeping). Supabase Postgres + pgvector via Drizzle. Deployed on Vercel. Single-password access gate (live).
- **Everything shipped to `master`, GitHub-released, CI green.** Current version **v4.30.0**. Working tree clean.
- **No half-done work, no pending gated items.** Migrations `0000`–`0011` applied + drizzle ledger in sync (no new migrations this session).
- **366 tests pass** (was 335 at the last handoff). Gate every tag: `npm run typecheck` (0) · `npm run lint` (0 errors, 27 baseline warnings) · `npm run build` · `npm test`.

## What shipped this session (newest first)
- **v4.30.0 — Warm palette + serif typography re-theme.** New "Manus/Claude" warm-minimal look, light + dark: paper canvas `#FAF9F6`, **terracotta `#C96442`** accent, warm-charcoal dark mode (`#1A1815`/`#26231D`, lifted coral `#D98A6A`) — replacing the cool steel-blue/navy/sand palette. **Fraunces** serif (`--font-serif`, `next/font`) on display headings only (home greeting, Artifacts/Projects/project-name titles); Geist body/Mono unchanged. Token-driven (`globals.css`); token names preserved (cool names repurposed warm). Scope was **palette + typography only** — radius/shadows/layout untouched; the ~250 hardcoded `white/X`·`black/X` overlay utilities left as a **deferred brand-cleanup follow-up**. Spec/plan: `docs/specs|plans/2026-06-25-warm-palette-typography*`.
- **v4.29.2 — Sidebar auto-collapse in the artifacts gallery.** Extracted `useAutoCollapseSidebar` hook used by both the chat workspace and `ArtifactsView` (the gallery's own panel never triggered the old page-local effect). +6 hook tests.
- **v4.29.1 — Drag-and-drop into the project Files panel** (`ProjectContextRail`); whole Files section is a drop zone; multiple files at once.
- **v4.29.0 — Claude-style Artifacts gallery.** `ArtifactsView` rebuilt: responsive card grid with **lazy rendered preview thumbnails** (sandboxed HTML mini-render / PDF first-page / sheet snippet / type tile), **search** + **type filter**, per-card **edited-time + source chip**, click → existing `ArtifactWorkspace` overlay, and **New artifact** (5 types → standalone host chat + blank template → workspace editor, with rollback). `getAllArtifacts` gained `editedAt`/`chatTitle`/`projectName` (joins, **no migration**). New: `ArtifactGalleryCard`, `ArtifactThumbnail`, `artifactFilter`, `artifacts/templates.ts`, `createBlankArtifact`. Spec/plan dated 2026-06-25.
- **v4.25.0–v4.28.0 — Security/perf/quality audit (4 batches).**
  - **v4.25.0 (deps):** `next` 16.1.6→**16.2.9** (clears high-CVSS request-smuggling / SSRF / **middleware-bypass** / DoS), `drizzle-orm` 0.45.2, `@xmldom/xmldom` 0.8.13, `vitest` 4.1.9. (8 residual moderate advisories are breaking-downgrade-only; intentionally left.)
  - **v4.26.0 (correctness/perf):** **pgvector HNSW index fix** (was `1-distance DESC` → seq scan; now `ORDER BY cosineDistance ASC` + threshold post-filter), media-only turns no longer leak the `(image)` placeholder + artifact-only turns persist, `getProjectChatPreviews` `DISTINCT ON`, **HTML artifacts download instead of executing** (`.html` signed URLs get `download:true`), dead-code removal, `signedArtifactUrl` helper.
  - **v4.27.0 (auth):** **expiring + nonce'd access cookie** (was a static forever-valid HMAC), **per-IP login rate-limit** (`src/lib/rateLimit.ts`), length-leak-free password compare, **middleware matcher bypass closed**. `docs/AUTH.md` updated.
  - **v4.28.0 (refactor):** began `page.tsx` decomposition — extracted `useChatTitle` / `useSummarization` / `generatedImages` + deduped create-chat.

## Live infrastructure (unchanged this session)
- **Supabase** project ref `evhgyudnjyryayazupgh`. Migrations `0000`–`0011` applied; ledger in sync (a future `drizzle-kit migrate` is a clean no-op). RLS on all tables. Bucket `atelier-files` (private, 200MB).
- **Vercel**: repo linked to project **`atelier-ai`** (prod alias **atelier-ai-app.vercel.app**). Auto-deploys on push to `master`. CLI installed + authed.
- **Access gate LIVE** (`APP_ACCESS_PASSWORD` + `AUTH_SECRET`). Guide: `docs/AUTH.md`. (Cookie format changed in v4.27.0 — a one-time re-login happened on that deploy.)

## Working cadence (the user expects this)
- Act as **Sr Fullstack Engineer**; make decisions, don't stall on small safe steps. New scope → brainstorm → spec (`docs/specs/`) → phased plan (`docs/plans/`) → execute (subagent-driven for testable work) → gate → ship per phase.
- Solo dev → direct-to-`master` commits + annotated tags `vX.Y.Z`, push `--follow-tags`, `gh release create`, watch CI, confirm Vercel prod Ready. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **User-gated**: live DB migrations + production cutovers (push is offered, not assumed). Do NOT run `vercel env pull` / `vercel dev`.

## Next candidates (nothing required)
- **#1 (queued): finish `page.tsx` decomposition** — `useDialogs` reducer for the 13 dialog flags + `useChatPersistence` for the `onFinish` pipeline. Logic-only, low-risk; the last piece of the maintainability work begun in v4.28.0.
- **Brand cleanup (follow-up to v4.30.0):** migrate the ~250 hardcoded `white/X`·`black/X` opacity overlays to semantic tokens so the warm theme is fully cohesive.
- **CSP hardening:** add a Next nonce pipeline to drop `script-src 'unsafe-inline'` (the one real "low" the audit left).
- **Verify xlsx artifact editing** round-trips through the workspace edit route (sheets JSON vs array — flagged in the gallery audit).
- **React/JSX artifacts** (bundler) — net-new; deferred. **Full per-user auth** (Clerk + `ownerId`) — its own project.

## Quick links
- `CLAUDE.md` (source of truth for how the code works) · `CHANGELOG.md` (per-release detail) · `docs/AUTH.md`.
- Specs/plans under `docs/specs/` and `docs/plans/` (dated). Memory index: `~/.claude/projects/.../memory/MEMORY.md`.
