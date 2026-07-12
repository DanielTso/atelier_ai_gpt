# Session Handoff — 2026-07-11

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-08.md`._

## TL;DR — where the project is

- **Atelier Studio**: Next.js 16 chat app. Claude = brain (multi-step agentic tools now), Gemini = senses (vision extraction, embeddings, images, housekeeping), Tavily = web ingestion. Supabase Postgres + pgvector, Vercel, access gate live (now `src/proxy.ts`).
- **Everything shipped to `master`, pushed, GitHub-released `v4.47.0`, CI green, Vercel deployed, gate verified live.** ~600 unit tests (`$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism` for a definitive local run — see gotchas). No new migrations (still `0000`–`0014`).

## What shipped this session (2026-07-11, one huge release: v4.47.0 "Living Studio")

Full detail in CHANGELOG.md §4.47.0. Three arcs, ~20 commits:

1. **RAG/ingestion hardening** (all from live Drover failures): ingest idempotency (dup chunk sets), stale-`uploading` reaper (60 min → "Upload never completed"), vision extraction pinned `temperature: 0` (was nondeterministic run-to-run), prod env `RAG_DOC_TOP_K=10` + `RAG_TOP_N=40` (the top-3 truncation fix — a 24-note General Notes section now answers completely).
2. **Motion/loading modernization**: `src/lib/motion.ts` tokens, reduced-motion support, shimmer skeletons, view crossfade, chat-switch polish, staged response states (`src/lib/chatStage.ts` + `ThinkingStatus` + `ToolProgressCard`), send↔stop morph, animated dialogs. An 8-angle adversarial review caught 5 real regressions pre-release — that pattern works, keep it.
3. **Experience Mode** (the Manus benchmark chase, 4 live debugging rounds — each fixed a real architectural gap):
   - Round 1: `stopWhen: stepCountIs(12)` — streamText was single-step; the model literally could not continue after a tool call.
   - Round 2: `maxOutputTokens: 32000` — the provider ~4k default truncated every HTML build mid-tool-call (silent, no error logged).
   - Round 3: HMAC capability URLs (`/api/files/raw` + `signFilePath`/`verifyFilePathSig` in lib/auth) — the sandboxed preview iframe can't send cookies, so the app's own gate 401'd artifact images. Same-origin HTML downloads (`/api/artifacts/:id/raw?download=1`) — Supabase mangles text/html downloads to `.txt`.
   - Round 4: auto-open the workspace mid-stream when a build lands; video **thumbnail cards** instead of YouTube embeds (error 153: sandboxed srcdoc sends no Referer — embeds can NEVER work there); preview sandbox gained `allow-popups` so links work.
   - Plus: follow-up chips (`/api/suggest-followups`, Gemini Flash housekeeping), chat links open in new tabs. Spec: `docs/specs/2026-07-11-experience-mode.md`.
4. **Infra**: access gate migrated `src/middleware.ts` → `src/proxy.ts` (Next 16 convention, deprecation cleared, verified live: `/` 307→login, API 401, unsigned files/raw 401, bad path 400).

End state user-confirmed: the America benchmark prompt now researches (17+ sources), generates images, builds a designed HTML page, **auto-opens it in the workspace**, images/video-cards/downloads all work. User reaction: "SICK!! great job".

## ⏳ Next session start — the decided roadmap (user-approved, in memory too)

1. **RAG Phase 3** — whole-document mode + hybrid keyword retrieval (Postgres FTS + `pg_trgm`, both available-not-installed). Structural fix for set-wide questions ("list every storm sheet"). **Start with `superpowers:brainstorming`.** Fold in: record WHICH pages failed vision (actionable Partial badge), text+vision hybrid chunk descriptions, optional `data-stage` stream part for a real "Reading documents…" stage.
2. **Code Phase A/B** — shiki syntax highlighting in `CodeBlock` (currently monochrome); code-file artifacts (`.py`/`.sh`/`.ts` with highlighted preview + versions); small "Contract Abstract" persona/template with a locked field schema. User context: heavy Linux/bash/Python user learning AI engineering — Atelier serves scripting workflows too now.
3. **Code Phase C** — execution sandbox via Vercel Sandbox microVMs ("Claude Code inside Atelier"). Own spec; security/cost gated.
4. Audit Batches B/C/D still queued behind (unchanged from 2026-07-06 audit; Batch B has the 2 one-line security fixes).

**Parked candidate (user may provide input):** the "live streaming canvas" — stream artifact HTML into the preview from tool-call input deltas, Claude.ai-style. User was invited to record how Claude.ai/Manus generate content (no ffmpeg on machine — `winget install ffmpeg` then frame-extract, or screenshots). If a video/screenshots appear, that's the design seed.

**Also open:** model-tiering directive (`feedback_model_tiering_by_criticality`) expired 7/7 — asked twice, no answer yet; don't nag, but it caught real defects when active. Old artifacts generated before round 3/4 embed unsigned image URLs / dead embeds — regenerating them fixes; no backfill planned.

## Gotchas (new this session + carried)

- **This machine's clock/timezone flips** (VPN + Windows auto-timezone — was on NZ time mid-session). Consequences: (a) 5 unit tests are TZ-fragile — run the full suite with `$env:TZ='America/Phoenix'`; (b) a flaky VPN killed a 184MB upload (now surfaced by the uploading reaper).
- **PowerShell here-string commit messages get mangled** when the body contains quotes — write the message to a scratchpad file and `git commit -F <file>`. (LF→CRLF warnings on commit are noise.)
- **Sandboxed artifact preview iframe** (opaque origin): sends NO cookies (hence capability-signed image URLs) and NO Referer (hence no YouTube embeds, ever — thumbnail cards only). Never add `allow-same-origin` (model JS would reach the app session).
- **Supabase storage refuses to serve text/html as HTML** — any HTML download must go through `/api/artifacts/:id/raw`.
- **Permission classifier**: prod-affecting actions (git push, `vercel env add`, prod SQL UPDATEs) need the user to name the action explicitly; "proceed"/"continue" gets blocked — offer the exact sentence to say. "ship"/"push" have been accepted for pushes.
- **Carried**: no Prettier ever; Vercel preview behind auth (verify on prod); `.env.local` BOM; network drops >1MB POSTs to generativelanguage.googleapis.com locally (Gemini-specific; prod fine); PGlite suite wants `--no-file-parallelism`; page.tsx and some older files use double quotes — match the file you're in.

## Quick links

- Release: github.com/DanielTso/atelier_ai_gpt/releases/tag/v4.47.0 (CHANGELOG.md has the full entry).
- Specs this session: `docs/specs/2026-07-11-experience-mode.md`; motion-pass plan lives in the plan file system (not docs/plans — it was a same-day build).
- Memory: `project_phased_build_status` (roadmap) + `user_technical_profile` (dual construction/coding profile) updated 2026-07-11.
