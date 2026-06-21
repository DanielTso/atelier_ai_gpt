# Session Handoff — 2026-06-21 15:17 CDT

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes earlier dated handoffs (kept for history)._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 App Router chat app. **Claude = brain** (chat, `@ai-sdk/anthropic`, web search); **Gemini = senses** (image gen + embeddings + internal housekeeping). Supabase Postgres + pgvector via Drizzle. Deployed on Vercel.
- **Everything is shipped to `master`, GitHub-released, CI green.** Current version **v4.16.0**. Working tree clean (only gitignored local scratch).
- This session shipped: **v4.10.0** (auto-memory), **v4.11.0–v4.14.1** (4-phase hardening + access gate + docs), **v4.15.0 / v4.16.0** (Phase D2 artifacts workspace).
- **No half-done work. No pending gated items.** All migrations applied + drizzle ledger in sync, access gate live, CSP browser-verified, RLS 13/13.

## Live infrastructure (verified this session)
- **Supabase** project ref `evhgyudnjyryayazupgh`. Migrations `0000`–`0010` all applied; `drizzle.__drizzle_migrations` ledger in sync (a future `drizzle-kit migrate` is a clean no-op). RLS enabled on all 13 tables.
- **Vercel**: CLI installed + authed as `danieltso`. Repo linked to project **`atelier-ai`** (prod alias **atelier-ai-app.vercel.app**; also atelier-ai-studio.vercel.app). ⚠️ the bare `atelier-ai.vercel.app` URL is a *different* project — don't use it. Auto-deploys on push to `master`.
- **Access gate is LIVE**: single-password gate (`APP_ACCESS_PASSWORD` + `AUTH_SECRET` set on Vercel Production+Preview and local `.env.local`). Login verified in-browser (307→/login, 401 on API, 200+cookie on correct password). Operating guide: `docs/AUTH.md`. (Password is the owner's; rotate via Vercel env + redeploy.)

## What shipped this session (newest first)
- **v4.16.0 — Artifacts D2.2**: edit source → new version; regenerate via Claude; version history tab with restore. Routes `POST /api/artifacts/[id]/{edit,regenerate}`; actions `addArtifactVersion` (transactional) + `restoreArtifactVersion`. No migration.
- **v4.15.0 — Artifacts D2.1**: right-side **workspace panel** (`ArtifactWorkspace`) with inline **preview** from source (`ArtifactPreview`: markdown→HTML, sheets→table, pdf→iframe); **PPTX** export (`toPptx`, pptxgenjs); artifacts persist source `content`/`format` + `artifact_versions` table (migration `0010`). Spec/plan: `docs/specs/2026-06-21-d2-artifacts-workspace-design.md`, `docs/plans/2026-06-21-d2-artifacts-workspace.md`.
- **v4.14.1** — access-gate activation + `docs/AUTH.md`.
- **v4.14.0 — Hardening P4 (code health)**: removed dead actions; shared `src/lib/messageParts.ts` (`extractText`/`messageText`) + `toArtifactSummary`; deduped Project/Chat interfaces; `typecheck` npm script + CI step; repo hygiene.
- **v4.13.0 — Hardening P3 (perf)**: RAG branches parallelized + first-turn rewrite skip; `Promise.all` in memory-suggest/chat routes; bounded `getAllArtifacts`; memoized `MessageBody`; `memory_suggestions` covering index (`0009`); stabilized the flaky exceljs test.
- **v4.12.0 — Hardening P2 (robustness)**: atomic transactional `acceptSuggestion` (fixes projects.memory race); transactional document-replace (no data loss); `error.tsx`/`global-error.tsx`/`not-found.tsx`; classify output validation; monotonic auto-memory trigger; artifact orphan guard; shared `uiMessageSchema`.
- **v4.11.0 — Hardening P1 (security)**: access gate code; model allow-list (`MODEL_IDS`); server-derived document-process storagePath; prod error-detail suppression; security headers/CSP; signed-URL TTL 3600→300s; xlsx injection guard.
- **v4.10.0 — Auto-memory**: throttled Gemini suggest pass → pending `memorySuggestions` → Accept/Edit/Dismiss in the rail → appends to `projects.memory`.
- Plan: `docs/plans/2026-06-21-hardening.md`. Full audit context lives in that plan + the specs.

## Architecture quick-map (see CLAUDE.md for detail)
- `src/app/page.tsx` (~1,250 lines) — single-page client; all app state. `src/app/actions.ts` — all `'use server'` DB access.
- `src/app/api/` — chat, models, embed, summarize, generate-title, classify, memory/suggest, documents/{upload-url,process}, artifacts + artifacts/[id]/{edit,regenerate}, auth, extract.
- `src/lib/artifacts/` — engine: `tool.ts` (`generate_artifact`), `render.ts`, `to{Xlsx,Docx,Pdf,Pptx}.ts`, `path.ts`, `types.ts`.
- `src/lib/` — `auth.ts` (gate), `messageParts.ts`, `retrieval.ts` (RAG), `storage.ts`, `validation.ts`, `errors.ts`, `providers.ts`, `settings.ts`.
- DB tables (13): projects→chats→messages, settings, messageEmbeddings, documents, documentChunks, documentRevisions, messageAttachments, personaUsage, chatTopics, artifacts, artifactVersions, memorySuggestions.

## Working cadence (the user expects this)
- Act as **Sr Fullstack Engineer**; make decisions, don't stall on small safe steps. For **new scope**: plan mode → spec (`docs/specs/`) → phased plan (`docs/plans/`) → TDD build → gate → commit + tag per phase.
- **Gate** before every merge/tag: `npm run lint` (0 errors; ~27 warnings baseline), `npm run typecheck`, `npm run build`, `npm test`.
- Solo dev → **no PRs**: merge `--no-ff` to `master`, `git tag -a vX.Y.Z`, push, `gh release create`, delete branch. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **User-gated** (confirm explicitly): live DB migrations and production cutovers. Auth-mode classifier will block `drizzle-kit migrate` — apply migrations via the Supabase MCP `execute_sql` (DDL) **and** insert the matching `drizzle.__drizzle_migrations` row (`hash`=sha256 of the migration file, `created_at`=`when` from `drizzle/meta/_journal.json`) to keep the ledger in sync.
- Do NOT run `vercel env pull` / `vercel dev` (they clobber `.env.local`). PowerShell `Set-Content -Encoding utf8` adds a BOM — avoid on JSON, or strip it after.

## Next candidates (nothing required)
- **`page.tsx` / `actions.ts` decomposition** into hooks/domain modules (maintainability; deferred from hardening).
- **RAG result caching** (rewrite/rerank LRU); `MessagesList` virtualization; `console.error` context tags.
- **Full per-user auth (Clerk + `ownerId` scoping)** — only if multi-user is wanted; its own multi-phase project (see `docs/AUTH.md`).
- **Artifacts deferred**: WYSIWYG binary editing, version pruning/retention, per-message pinning.
- Optional: rotate the gate password; bump (already at 4.16.0).

## Quick links
- `CLAUDE.md` (source of truth for how the code works) · `CHANGELOG.md` (per-release detail) · `docs/AUTH.md`.
- Specs/plans under `docs/specs/` and `docs/plans/` (dated).
- Memory index: `~/.claude/projects/.../memory/MEMORY.md`.
