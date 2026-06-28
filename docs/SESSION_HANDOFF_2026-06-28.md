# Session Handoff — 2026-06-28

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes earlier dated handoffs (kept for history)._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 App Router chat app, a Claude.ai-style clone for construction work. **Claude = brain** (chat, web search, tools); **Gemini = senses** (image gen + embeddings + internal housekeeping); **Tavily = web ingestion** (new this session). Supabase Postgres + pgvector via Drizzle. Deployed on Vercel. Single-password access gate (live).
- **Everything shipped to `master`, GitHub-released, CI green.** Current version **v4.35.0**. Working tree clean.
- **No half-done code.** No migrations pending (none added since `0011`). 454 unit tests pass.
- Gate every tag: `npm run typecheck` (0) · `npm run lint` (**0 errors, 26 baseline warnings**) · `npm run build` · `npm test`. E2E runs in CI only (gate-off, ephemeral pgvector) — not locally (local `.env.local` has the gate ON + `DATABASE_URL` = production Supabase, so live/manual smoke is the **user's** job on deploy).

## What shipped this session (newest first)
- **v4.35.0 — UI polish: boxier project cards + tighter Recents.** Project cards (`ProjectsView.tsx`) are now a 1/sm:2/lg:3 grid showing a **file count** (new `getProjectFileCounts()` grouped-count action, wired via `page.tsx` `projectFileCounts` state), a **Memory** snippet, and an **Instructions** snippet (2-line clamps); search matches instructions too. Sidebar Recents items tightened (`py-1.5`/`space-y-0.5`).
- **v4.34.1 — Sidebar Recents = quick chats only.** `Sidebar.tsx` recents memo filters `projectId === null`; project chats appear only in their project (Projects view → project → chat list).
- **v4.34.0 — Resizable + collapsible project context rail.** `ProjectContextRail.tsx`: drag the left-edge handle to resize (clamp 280px..min(640,50vw)), double-click to reset (320), chevron collapses to a thin strip. Width + collapsed state persisted (`project-rail-width`/`project-rail-collapsed`). Mirrors the artifact-workspace resize.
- **v4.33.1 — fix: "Add from web" reachable.** It lived only in the Documents modal; the project Files rail (`ProjectContextRail`) has its own upload + only linked to the modal when empty. Added an always-visible **Web** button to the Files header.
- **v4.33.0 — Carryover cleanups (page.tsx decomposition + xlsx/CSP verification).** Extracted **`useDialogs`** (10 dialog flags + 6 targets behind a per-dialog controller) and **`useChatPersistence`** (the `useChat` `onFinish` pipeline, now **unit-tested**; wired via a stable `onFinishRef` to resolve the useChat↔setMessages cycle) from the 1,313-line `page.tsx`. **xlsx edit round-trip verified** (real `toXlsx`→exceljs read-back; no prod change). **CSP nonce pipeline attempted + browser-verified BROKEN under Next 16 Turbopack** (Next doesn't stamp the nonce on its scripts → all JS blocked) → reverted, finding recorded in `next.config.ts`; `'unsafe-inline'` stays.
- **v4.32.0 — Design B: "Add from web" (Tavily web ingestion → project RAG).** Single-URL **Extract** + Map-first **Crawl** (you pick pages) ingest web pages as project documents through the existing chunk→embed→pgvector pipeline. New: `src/lib/tavily.ts` (server-only map/extract), `src/lib/ingest.ts` (shared `ingestText` tail, also used by `documents/process`), routes `POST /api/documents/web-map` + `/api/documents/web-ingest`, `useWebIngest` hook, `AddFromWebDialog`. **No DB migration.** Tavily key is **server-only** (`getTavilyApiKey()` in `settings.ts`, in `SENSITIVE_KEYS`, status-only in Settings → API Keys, never logged/returned). Spec: `docs/specs/2026-06-27-web-ingestion-design.md`; plan: `docs/plans/2026-06-27-web-ingestion.md`.

## Live infrastructure (unchanged structurally)
- **Supabase** project ref `evhgyudnjyryayazupgh`. Migrations `0000`–`0011` applied; drizzle ledger in sync (**no new migrations this session**). RLS on all tables. Bucket `atelier-files` (private, 200MB).
- **Vercel**: repo linked to project **`atelier-ai`** (prod alias **atelier-ai-app.vercel.app**). Auto-deploys on push to `master`. CLI installed + authed (`danieltso`). **`TAVILY_API_KEY` is set in Vercel env** (prod was redeployed to pick it up). Env-var changes don't auto-deploy → redeploy (`vercel redeploy atelier-ai-app.vercel.app`) — **production deploy/redeploy is user-confirmed each time**.
- **Access gate LIVE** (`APP_ACCESS_PASSWORD` + `AUTH_SECRET`). Guide: `docs/AUTH.md`.

## Working cadence (the user expects this)
- Act as **Sr Fullstack Engineer**; make decisions, don't stall on small safe steps. New feature → brainstorm → spec (`docs/specs/`) → plan (`docs/plans/`) → execute (subagent-driven-development: implementer + reviewer per task, fix loops, final whole-branch review) → gate → ship. Small UI tweaks: branch, edit, gate, batch + release.
- Solo dev → branch off `master`, commit per verified change, then on the user's go: merge `--no-ff` → `npm version` bump (package.json + lockfile) → annotated tag `vX.Y.Z` → push `master` + tag → `gh release create` → watch CI → Vercel auto-deploys. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **User-gated & outward-facing**: production pushes/releases/redeploys are **confirmed each time**. Docs-only commits do **not** get a version tag. Do NOT run `vercel env pull` / `vercel dev`. Local live/manual smoke is blocked (gate on + prod DB) → rely on CI e2e + the user's in-app check on deploy.
- SDD scratch/ledger lives at `.superpowers/sdd/progress.md` (git-ignored) — useful recovery map after compaction.

## Open items (nothing in progress)
- **User smoke-test on deploy (pending):** the page.tsx decomposition (v4.33.0) touches the core chat path — verify send/generate-image/generate-artifact + every dialog still work; also try **Add from web** (Files → Web), the **resizable/collapsible rail**, and the **boxier project cards**.
- **Brand overlay-token migration (~M, deferred):** ~121 `white/X`·`black/X` opacity utilities across ~24 files → semantic tokens. Mechanical but visual (verify on deploy). Last Phase-2 cleanup.
- **#3 deferred features (briefing delivered, user decision pending):** **React/JSX artifacts** (~L; needs a bundler — esbuild/swc → IIFE with React, rendered in the existing sandboxed iframe) or **full per-user auth** (~XL; Clerk + `ownerId` on every top-level table + scope ~73 actions/~15 routes + data migration; riskiest = authz-bypass data leak).
- **Minor logged follow-ups (non-blocking):** tighten the `web-ingest` route's returned `document` typing (or drop to `{documentId, status}`); add an `afterEach` env restore in `tests/unit/actions/api-keys-tavily.test.ts`; a v2 `source_url` column for web docs (replace the `mimeType` provenance heuristic + add a "web" badge); CSP hardening would need a non-Turbopack build or hash-based CSP.

## Quick links
- `CLAUDE.md` (source of truth for how the code works) · `CHANGELOG.md` (per-release detail) · `docs/AUTH.md`.
- Specs/plans this session: `docs/specs/2026-06-27-web-ingestion-design.md`, `docs/plans/2026-06-27-web-ingestion.md`, `docs/plans/2026-06-27-page-decomposition.md`.
- GitHub releases: `v4.32.0` … `v4.35.0` at github.com/DanielTso/atelier_ai_gpt/releases.
