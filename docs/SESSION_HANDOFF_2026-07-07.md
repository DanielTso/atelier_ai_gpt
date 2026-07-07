# Session Handoff — 2026-07-07

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-06-29.md` (kept for history)._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 App Router chat app, a Claude.ai-style clone for construction work. **Claude = brain** (chat, web search, tools); **Gemini = senses** (image gen + embeddings + vision extraction + internal housekeeping); **Tavily = web ingestion**. Supabase Postgres + pgvector via Drizzle. Deployed on Vercel. Single-password access gate (live).
- **Everything shipped to `master`, GitHub-released, CI green. Working tree clean.** Current version **v4.44.0**. `master` at commit `2506a75`.
- **Migrations `0000`–`0014` applied to prod Supabase** (`0013` = RLS + FK indexes, `0014` = document fidelity columns — both applied + verified this session). ~525 unit tests pass.
- Gate every tag: `npm run typecheck` (0) · `npm run lint` (**0 errors, 25 baseline warnings**) · `npm run build` · `npm test`. **Local test flake:** the full suite flakes on PGlite-per-worker contention under parallel load (`toXlsx.test.ts` + warm-up timeouts) — run **`npx vitest run --no-file-parallelism`** for a definitive green (it was 525/525 single-threaded this session). E2E is CI-only.

## What shipped this session (newest first — all CI-green, released)
- **v4.44.0 — RAG Phase 1: ingestion reliability & fidelity.** Kills three silent-loss bugs: (1) 100K char truncation → `DOCUMENT_MAX_CHARS` (2M, env-configurable) + chunk the full doc; (2) unbounded embedding → new `src/lib/embedChunks.ts` (`embedChunks` persisting / `embedContents` non-persisting for the replace path — bounded pool concurrency 5 + retry/backoff, a persist failure is counted not a crash); (3) 30-page vision cap → 60. Extractors now return `ExtractionResult{text,pageCount,pagesExtracted,partial}`; full extracted text stored as `documents/<proj>/<id>[/rev<N>]/extracted.txt`; migration `0014` (`page_count`/`pages_extracted`/`extraction_partial`); amber **"Partial"** badge in `DocumentCard` + preview notice. **No document is silently truncated anymore** — truncation/page-cap/embed-failure all surface as `partial`. Spec `docs/specs/2026-07-07-rag-phase1-ingestion-fidelity-design.md`, plan `docs/plans/2026-07-07-rag-phase1-ingestion-fidelity.md`.
- **v4.43.0 — 4 Fable 5 flagship personas.** ⚖️ Claims & Delay Analyst + 📜 Contract & Spec Analyst (both `max` effort), 🧩 Constructability Reviewer + 🧠 Deep Reasoner (both `high`) — all on `claude-fable-5`, in `src/hooks/usePersonas.ts` (roster 9→13).
- **v4.42.0 — Claude 5 models in the picker.** Added `claude-fable-5` (flagship) + `claude-sonnet-5`; **retired `claude-sonnet-4-6` from the picker** (kept in `MODEL_IDS` for existing chats; its personas + the artifact-regenerate model moved to Sonnet 5). Opus 4.8 stays default.
- **v4.41.0 — Batch A stability & security hardening.** Migration `0013` (RLS on `artifact_versions`+`generated_images`, 3 FK indexes); **incremental summarization** (`getMessagesForSummarization` lower bound; delta-gated client trigger `SUMMARIZE_EVERY=10` — kept ≤ `RECENT_MESSAGES_LIMIT − MESSAGES_TO_KEEP` so the chat-context window stays gapless; success toast removed); **document-processing robustness** (`maxDuration=800` on process+web-ingest; `updateDocumentStatus` bumps `updated_at`; lazy `reapStaleProcessing` reaper flips stuck-`processing` rows to `error`). Spec/plan in `docs/specs/` + `docs/plans/` dated 2026-07-06.
- **v4.40.1 — CLAUDE.md accuracy pass** (docs; `/init` audit).

## Live infrastructure
- **Supabase** project ref `evhgyudnjyryayazupgh`. Migrations `0000`–`0014` applied; drizzle ledger in sync. RLS on all tables. Bucket `atelier-files` (private, 200MB). Advisors clean of ERROR-level findings (0013 cleared the RLS errors; vision-extension-in-public WARN + auth-connections INFO are pre-existing/cosmetic). **pgvector 0.8.0**; `pg_trgm`, native FTS, `pgmq`, `pg_cron` are available-not-installed (for later RAG phases).
- **Vercel**: repo linked to project **`atelier-ai`** (prod alias **atelier-ai-app.vercel.app**). Auto-deploys on push to `master`. CLI installed + authed (`danieltso`). AI keys + `TAVILY_API_KEY` set in Vercel env. **Production deploy/release/migration = user-confirmed each time.**
- **Access gate LIVE** (`APP_ACCESS_PASSWORD` + `AUTH_SECRET`). Guide: `docs/AUTH.md`.

## ⏳ IN PROGRESS — RAG Phase 2: extraction upgrade (brainstorm done, NOT yet spec'd)
This is the active thread. A brainstorm (superpowers) completed with all decisions locked; **the next action is to write the spec** (then plan → subagent-driven build → ship), same cadence as Phase 1.

**Goal:** the user runs construction **plans and contracts** through RAG. Real plan files are **up to 120 pages / 78 MB**. They want the **vision + embedding** pipeline on **one provider without size limits**. **Claude STAYS the chat brain** — this is RAG-ingestion scope only.

**Decisions LOCKED (recorded in `.superpowers/sdd/progress.md` → "RAG Phase 2" section):**
- **Provider = Google Gemini** (keep — already does embeddings + vision). A 110-agent cited deep-research run (output at `.superpowers/…/tasks/w2dpl7zn7.output` — copy the key findings before it's cleaned up) confirmed Gemini is the **only** single provider covering chat+vision+embedding, and its **Files API (2 GB/file) ingests a 78 MB/120-page PDF directly — no render+batch**. Claude (32 MB/100pp cap, no embeddings) and OpenAI (50 MB/file) both force splitting.
- **Extraction approach = Gemini Files API** (route PDFs via Files API, NOT inline — inline PDF cap is 50 MB). This **drops the `pdfjs` + `@napi-rs/canvas` per-page render** for the large-doc path. Gemini native OCR handles text/tables/diagrams up to 1000 pages.
- **Extraction model = upgrade `gemini-3.5-flash` → a current Gemini 3 model** best for dense doc/table OCR. **Exact model TBD — verify against current Gemini docs at spec time** (research refuted "all Gemini-3 models have 1M context", so confirm the specific model's limits).
- **Embeddings = keep `gemini-embedding-001` @ 768-dim** (unchanged; MRL supports 1536/3072 if more quality ever wanted).
- **Keep the Phase 1 `ExtractionResult{text,pageCount,pagesExtracted,partial}` contract + partial semantics.**
- **Orchestration = keep current single-function `maxDuration=800` + stale reaper.** User explicitly chose **NOT** to adopt Vercel Workflow DevKit / pgmq now (revisit only if plans exceed the ~13-min budget). (Workflow DevKit is not installed.)

**⚠️ OPEN CAVEAT to verify BEFORE building:** does Gemini's **50 MB-per-PDF** limit apply to Files-API **processing** (not just inline upload)? The research found conflicting sources (one "PDF up to 50 MB" claim was refuted 1-2; finding note: "may require splitting even a 78 MB file in the worst case — verify against current docs"). **The spec MUST design a fallback:** Files-API native primary → if a >50 MB PDF is rejected at processing, split via `pdf-lib` (already a dep) into <50 MB / <~900pp parts → existing per-page render as last resort. Confirm this against current Gemini docs (context7 / web) at spec time.

## The audit backlog (from the 2026-07-06 deep-dive; Batch A shipped as v4.41.0)
Still open, each its own spec when wanted:
- **Batch B (P1 perf quick-wins):** `src/db/index.ts` pool config (`max`/`idle_timeout`/`connect_timeout` + a DATABASE_URL guard); slim list payloads (chats without `summary`/`systemPrompt`; artifact lists without `content`) + gate the per-turn artifact re-fetch on `hasArtifactOutput`; `useCallback` the 4 plain handlers in `page.tsx` (defeat sidebar re-render on stream); embed-concurrency already largely addressed by Phase 1's `embedChunks`; **2 one-line security fixes** — SVG upload allow-list (`upload-url/route.ts:21` drop the `contentType.startsWith('image/')` clause) + login `next` open-redirect (`login/page.tsx:26` add the `/\` guard the middleware has).
- **Batch C (P2):** dead-code sweep — the **orphaned sidebar cluster** (`ProjectsSection`/`QuickChatsSection`/`ArchivedSection`/`ProjectItem`/`useCollapseState`/`LoadingSkeletons` — still receiving brand edits), 2 dead server actions (`deleteDocumentChunks`, `getDocumentChunksForProject`), 2 unused devDeps, dead CSS vars; plus docs fixes (`TECH_STACKS.md` describes retired Turso/Qwen stack) and a `useLocalStorage` in-tab-sync fix (root cause of a latent persona-usage bug).
- **Batch D (P3):** dependency currency — within-v6 AI SDK patches are safe; **AI SDK v7** is a deliberate migration (own spec); other majors available (marked, pdfjs-dist, @napi-rs/canvas, TS 6, ESLint 10, lucide 1.x). npm audit: 8 moderate, all transitive/breaking-only — monitor, don't force. CI pins Node 22; local is 24 — consider an `engines` field.
- **P3 product follow-ups (user-approved directions):** **resurrect archived chats** (archive action exists but no UI shows/restores them); **warm-re-skin the artifact renderers** (`src/lib/artifacts/style.ts` still ships the retired cool-navy palette under a false "mirrors globals.css" comment).
- **RAG Phase 1 deferred item:** consider aborting the document-replace swap when `embedded===0` to preserve the last-good chunk index instead of replacing it with an error revision (rare edge — total Gemini outage mid-re-upload).

## Working cadence & preferences (the user expects this)
- Act as **Sr Fullstack Engineer**; decide, don't stall on small safe steps. Non-trivial scope → **brainstorm → spec (`docs/specs/`) → plan (`docs/plans/`) → subagent-driven execution → gate → ship**. Small tweaks: branch, edit, gate, release.
- **Model tiering by criticality** (user directive): **Fable** for critical/architecture/DB/core-logic tasks + the reviews; **Opus** for planning + integration; **Sonnet** for mechanical tasks. Tag each plan task with its tier. Subagent-driven-development dispatches each task's implementer at its tier; Fable (main loop) reviews each diff before the next; a final independent whole-branch review (Opus) before merge. This flow caught real defects this session (a `'use server'` const-export build break, a silent context-gap in a plan, a web-ingest silent-loss path).
- Solo dev → branch off `master` → on user go: merge `--no-ff` → `npm version minor` → annotated tag `vX.Y.Z` → push `master --follow-tags` → `gh release create` → watch CI → Vercel auto-deploys → apply any migration to Supabase (`DIRECT_URL=… npx drizzle-kit migrate`, user-gated). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. **Docs-only commits do NOT get a version tag.**
- **User-gated & outward-facing:** production pushes/releases/redeploys + live DB migrations are confirmed each time. Do NOT run `vercel env pull` / `vercel dev`.
- SDD recovery ledger: `.superpowers/sdd/progress.md` (git-ignored) — the durable map of what's done + the Phase 2 decisions above.

## Useful gotchas (this session)
- **No Prettier config** — never `prettier --write` (hand-written single-quote/no-semicolon; `schema.ts` + `summarize/route.ts` use semicolons). Match the file.
- **`actions.ts` is `'use server'`** — every export MUST be an async function. A `const` export compiles + passes vitest but **fails the Next build** (caught by the gate). Keep constants un-exported or in a non-`'use server'` module.
- **Migrations:** edit `schema.ts` → `npx drizzle-kit generate` (no DB needed) → eyeball the SQL → PGlite tests auto-apply it. Apply to prod with `DIRECT_URL=… npx drizzle-kit migrate` (extract `DIRECT_URL` from `.env.local` **without** shell-sourcing — the file has a UTF-8 BOM; redact `postgres://…` from any output).
- **Vercel PREVIEW deploys sit behind Vercel Auth** → header-verify on **prod** only.
- **Reading `.superpowers/sdd/task-*-report.md`:** these filenames collide across plan cycles; subagents overwrite stale ones (harmless).

## Quick links
- `CLAUDE.md` (how the code works) · `CHANGELOG.md` (per-release detail) · `docs/AUTH.md`.
- Specs: `docs/specs/2026-07-06-batch-a-*`, `docs/specs/2026-07-07-rag-phase1-*`. Plans: `docs/plans/` same dates.
- SDD ledger + Phase 2 decisions + research: `.superpowers/sdd/progress.md`; research output `.superpowers/…/tasks/w2dpl7zn7.output`.
- GitHub releases: `v4.41.0` … `v4.44.0` at github.com/DanielTso/atelier_ai_gpt/releases.
