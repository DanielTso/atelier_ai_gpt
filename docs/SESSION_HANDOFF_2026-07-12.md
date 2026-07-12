# Session Handoff — 2026-07-12

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-11.md`._

## TL;DR — where the project is

- **Two releases shipped and live today**: **v4.48.0** (RAG Phase 3 — `read_document` whole-doc tool + hybrid FTS/trigram retrieval) and **v4.49.0** (browser back/forward + URL deep links + chat actions on project landing rows). Both deployed, CI green, **v4.49.0 user-verified live** (back/forward walk, refresh-restore, row menu all confirmed working).
- **Supabase migrations `0015`/`0016` are APPLIED to prod** (pg_trgm, `content_tsv` backfilled, GIN indexes, `failed_pages`) — applied BEFORE the code deploy, in the mandatory order.
- 650 unit tests green (`$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`).
- **RAG Phase 3 acceptance PASSED (2026-07-12)**: Drover 90% DD (259 pages, 175MB) ingested in ~10 min — hybrid extraction, 920 chunks, failed-page tracking caught pages 139-140; "list every storm sheet" and the SW-101 note question both answered CORRECTLY (user-confirmed); keyword path clean in prod logs (also proves the postgres-js rowsOf branch). Quick chats do NOT see project docs — by design (tenant-isolation seed). Not yet done: git tags/GitHub releases for 4.48.0+4.49.0.

## What shipped this session (2026-07-12)

### v4.48.0 — RAG Phase 3 (subagent-driven: 11 tasks, per-task reviews, Fable final review)

Full detail in CHANGELOG §4.48.0 + spec `docs/specs/2026-07-11-rag-phase3-whole-doc-hybrid-design.md`.
- `read_document` tool: windowed reads (100k chars) over stored `extracted.txt`, `# Page n` anchors, `[Project documents]` manifest + chunks-first guidance in `/api/chat`.
- Hybrid retrieval always-on: `keywordSearch.ts` (FTS + trigram ILIKE for `SW-101`-style ids) RRF-fused (`rrf.ts`) with vector before MMR→rerank; keyword-only hits survive even with rerank off (review caught+fixed that bug). Knobs: `RAG_HYBRID_ENABLED`/`RAG_RRF_K`/`RAG_KEYWORD_TOP_N`.
- Failed-page tracking (`documents.failed_pages` → actionable Partial tooltip), `[pages a–b · vision]` provenance headers, "Reading documents…" stage.
- Notable review catches: keyword-survival in no-rerank path; web-ingest docs were unreadable by the tool (now upload `extracted.txt` too); lossy `fromPage+1` continuation hint (now offset-only). The optional pre-stream `data-stage` part was DROPPED (createUIMessageStream's execute is fire-and-forget → 500s became masked 200s; empirically confirmed).
- SDD ledger: `.superpowers/sdd/progress.md` (git-ignored) has the full task/commit trail.

### v4.49.0 — Browser navigation + project chat actions (inline, plan-mode approved)

Spec `docs/specs/2026-07-12-url-nav-and-chat-menu-design.md`, plan `docs/plans/2026-07-12-url-nav-and-chat-menu.md`.
- `src/lib/navState.ts` (pure URL scheme: `?view=`/`?project=`/`?chat=`) + `src/hooks/useUrlNavSync.ts` (native History API; NO useSearchParams — it would force a Suspense boundary). Deep links survive the login gate (`next=` param, verified live). Dialogs/artifact panel deliberately NOT in history.
- Key subtlety: the chat URL's project comes from `currentChat.projectId`, not `activeProjectId` (which goes stale via ArtifactsView.onOpenChat / selectView). Stale deep links ride the id-validation effect + `suppressNextPush()` → replaceState.
- `ProjectLandingPage` rows: sidebar's `ChatContextMenu` reused with explicit props (`SidebarActionsProvider` stays sidebar-only); new shared `ChatRowActions`/`ChatPreview` types in `src/types.ts`; rows are div+role=button (nested-button fix) with keyboard support; `handleArchiveChat` gained the missing `refreshChatPreviews()`.

### Also this session

- **Iteration-loop design seed captured** (`docs/specs/2026-07-11-living-canvas-design-seed.md`): analyzed the user's Manus 1.6 recording (`C:\tmp\VID_20260711_203400308.mp4` — keep until brainstorm). Key insight: Manus does NOT stream into the canvas; the value is the loop (narrate→build→verify→checkpoint→next steps). IP guardrails + Atelier-native vocabulary (Drafts/Worklog/Proofing as UI labels only — **no separate feature brand**, it stays "Atelier Studio", internal shorthand "the iteration loop"). User decision recorded in the doc.
- **User direction: trial run with other users planned, eventual SaaS** — recorded in the 07-12 spec; favor extensible boundaries (query params → route segments is mechanical when multi-user/Clerk lands).
- ffmpeg 8.1.2 installed via winget (frame extraction for the recording).

### v4.50.0 — Code Phase A/B (built later this session under delegated authority; LOCAL, not pushed)

Spec `docs/specs/2026-07-12-code-phase-ab-design.md`, plan `docs/plans/2026-07-12-code-phase-ab.md`. **User must review the spec + the Contract Abstract field list on return.**
- Shiki v4 chat highlighting (`src/lib/highlighter.ts` lazy singleton, JS regex engine, vitesse dual themes, 150ms debounce in `CodeBlock`, plain-pre fallback).
- `'code'` ArtifactType end to end: `src/lib/artifacts/code.ts` registry (9 languages); language persists in the `format` column (`artifactLanguage()` helper is the single read-side source); tool Zod refine (language + string content required); highlighted `ArtifactPreview`; FileCode icons everywhere; gallery Code filter + New→Code; edit/regenerate/blank-template support. No migration.
- Contract Abstract persona (`contract-abstract`, Fable/max): extraction-only, locked 22-field schema (`CONTRACT_ABSTRACT_FIELDS` in `usePersonas.ts` — edit there only), xlsx `Field | Value | Source Ref` output.
- 8-angle code review caught 8 findings (3 missed UI surfaces, misleading Edit label, empty-file schema hole, stale-highlight flash, 4-site duplication → helper, stale schema comment) — all fixed. Gate: typecheck 0, lint 26-warning baseline, build ok, 672 tests.

### Audit Batch B — security slice (also this session, LOCAL)

- `isImageUpload` raster allow-list (png/jpg/jpeg/webp only) replaces `contentType.startsWith('image/')` in upload-url + process routes — svg (scriptable) or exotic image MIMEs can no longer bypass the extension allow-list via a client-declared MIME.
- Login `next` guard now rejects `/\` (backslash → slash normalization made `/\evil.com` protocol-relative), matching proxy.ts.
- Batch B's perf items (db pool config, slim list payloads, useCallback pass) remain queued — do them with the full 2026-07-06 audit doc in hand.

## ⏳ Next session — open items and roadmap

1. **RAG Phase 3 live acceptance** (user-side): re-upload the Drover plan set (re-ingesting also activates failed-page tracking + provenance), then "list every storm sheet" (whole-doc sweep + Reading documents… stage) and "what does note 7 on SW-101 say" (keyword path; also proves the postgres-js rowsOf branch PGlite can't test). Check Vercel logs for `[retrieval] keyword search failed` after the first query.
2. **Release housekeeping**: tag + GitHub-release v4.48.0 and v4.49.0; bump `package.json` (still 4.47.0). Tag pushes need user approval.
3. **Roadmap** (user-approved order, from 07-11): **Code Phase A/B** (shiki highlighting in CodeBlock; code-file artifacts .py/.sh/.ts; Contract Abstract template) → **Code Phase C** (Vercel Sandbox execution — also unlocks iteration-loop self-verification) → audit Batches B/C/D. **The iteration loop** (design seed above) is queued as its own item — user may reorder; start it with `superpowers:brainstorming`.
4. Model-tiering directive (`feedback_model_tiering_by_criticality`) still expired/unanswered — don't nag. (This session used tiering anyway for subagents: haiku transcription / sonnet integration / fable final review — it caught 3 real defects.)

## Gotchas (new this session + carried)

- **PGlite now loads `pg_trgm`** alongside `vector` in `tests/helpers/test-db.ts`; content_tsv is raw-SQL-only (migration 0016), NOT in schema.ts — drizzle-kit generate won't touch it.
- **Migrate-before-deploy is mandatory** for schema-adding releases: deployed Drizzle code emits explicit column lists, so an unmigrated DB breaks whole tables' queries app-wide (documented in CHANGELOG 4.48.0).
- **createUIMessageStream in the chat route is a trap**: execute is fire-and-forget; wrapping the route turns 500s into masked in-stream 200s. Don't retry without solving error propagation.
- **useSearchParams in page.tsx is a trap**: forces a Suspense boundary; useUrlNavSync reads window.location directly by design.
- **Carried**: TZ-fragile tests (`$env:TZ='America/Phoenix'`, `--no-file-parallelism`); commit messages with quotes via `git commit -F`; no Prettier ever; Vercel preview behind auth (verify on prod); sandboxed artifact iframe sends no cookies/Referer, never add allow-same-origin; Supabase won't serve text/html (use `/api/artifacts/:id/raw`); prod-affecting actions need the user to name them ("push"/"ship" accepted); page.tsx + older files use double quotes — match the file.

## Quick links

- CHANGELOG §4.48.0 + §4.49.0; specs/plans dated 2026-07-11 and 2026-07-12 in docs/.
- SDD ledger: `.superpowers/sdd/progress.md`. Iteration-loop seed: `docs/specs/2026-07-11-living-canvas-design-seed.md`.
- Memory updated 2026-07-12: `project_phased_build_status` (roadmap state), `user_technical_profile` unchanged.
