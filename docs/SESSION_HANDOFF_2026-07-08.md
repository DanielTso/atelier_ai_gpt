# Session Handoff — 2026-07-08

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-07.md`._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 chat app for construction work. Claude = brain, Gemini = senses (vision extraction + embeddings + housekeeping), Tavily = web ingestion. Supabase Postgres + pgvector, Vercel, access gate live.
- **Everything shipped to `master`, pushed, GitHub-released, CI green, Vercel deployed. Working tree clean.** Current version **v4.46.0** (`master` @ `c0b4e00`). Migrations `0000`–`0014` (no new migrations this session). ~551 unit tests. Definitive local run: `npx vitest run --no-file-parallelism`.

## What shipped this session (2026-07-07 evening, two releases)
- **v4.45.0 — RAG Phase 2: segmented native-PDF vision extraction.** The ⚠️ Files-API caveat was VERIFIED against official Gemini docs and REFUTED the brainstorm premise: the 50 MB PDF cap applies to Files API too → the locked "Files API" decision was revised (user-approved) to **pdf-lib splitting + inline AI SDK file parts**. `src/lib/pdfSegments.ts` (splitter, 45 MB byte-cap halving), reworked `src/lib/visionExtraction.ts` (one Gemini call per ~20-page segment, `mapWithConcurrency` from new `src/lib/concurrency.ts`, retry, `finishReason` truncation → partial), per-page raster loop DELETED (pdfjs/canvas remain for thumbnails only), **per-page density vision gate** (`EXTRACTION_MIN_CHARS_PER_PAGE` 200) so sparse-text CAD sets reach vision. Extraction model stays `gemini-3.5-flash` (verified top stable; 3.1-pro is preview). Final review caught + fixed a real bug pre-merge: uncaught pdf-lib parse failure in the vision fallback would have errored docs with usable text (`d95c0ed`). Spec/plan: `docs/{specs,plans}/2026-07-07-rag-phase2-extraction-upgrade*`.
- **v4.46.0 — RAG Phase 2b: per-page hybrid extraction.** Motivated by a LIVE failure during the v4.45.0 smoke: the **Drover 90% DD set (259 pp / 184 MB, doc id 23, project "Drover")** ingested via text path but its **Civil General Notes sheets (pages 2–3; 4–5 too) are AutoCAD SHX** — stroke-geometry text, title-block-only text layer (~300–450 chars vs 2,517 median; measured empirically). Fix: `pageTexts` from the PDF extractor → sparse pages (< `EXTRACTION_HYBRID_PAGE_MIN_CHARS` 500, cap `EXTRACTION_HYBRID_MAX_PAGES` 80) → `splitPdfPageRuns` + `extractPagesViaVision` (targeted runs through the segment machinery) → page-ordered splice in the process route → `extraction_method: 'hybrid'` + DocumentCard chip. Non-fatal everywhere; failed/truncated/byte-cap-skipped runs all flag partial (final review caught the `skippedPages` silent-loss hole; fixed `546733a` with unit+route tests + splice content-lock). Applies to upload AND Replace. Spec/plan: `docs/{specs,plans}/2026-07-07-hybrid-page-extraction*`.
- Both releases ran the full cadence: spec → plan → tiered subagent build (Fable core / Opus integration / Sonnet mechanical) → per-task reviews → Opus final whole-branch review → fix → re-review → user-gated release → CI green. The reviews caught one real Important defect per release.

## ⏳ FIRST THING TOMORROW — pending validation + one parked change
1. **USER SMOKE (not yet run): Replace the Drover doc.** Drover project → Files → plan set → Replace (same PDF). Expect: `ready` + **hybrid** chip, no Partial badge, then "what do the Civil General Notes say about erosion control?" answers with real notes bodies. If Partial or a miss: query `documents` row id 23 + `document_chunks` (Supabase MCP, project `evhgyudnjyryayazupgh`) — that diagnosis flow worked well this session.
2. **PARKED: retrieval-depth env bump** — `RAG_DOC_TOP_K=10`, `RAG_TOP_N=40` on Vercel production + redeploy. Diagnosed cause of "model only saw sheets 9–93": top-3 doc chunks of 831 per turn. The permission classifier requires the user to name the action explicitly (e.g. "set RAG_DOC_TOP_K=10 and RAG_TOP_N=40 on Vercel production and redeploy") — a bare "continue"/"go" gets blocked; same for `git push` to master.

## Next build: RAG Phase 3 (recommended, not yet brainstormed)
**Whole-document mode + hybrid keyword retrieval** — the structural guarantee for set-wide plan questions (sheet counts, "list every storm sheet") where top-k similarity is a lottery. Inputs ready: full `extracted.txt` per document already in Storage (Phase 1); Postgres FTS + `pg_trgm` available-not-installed on the Supabase instance. Also user-flagged candidate: text+vision hybrid descriptions for drawing-heavy sheets (chunks currently carry the text layer only for text-path sheets). Start with `superpowers:brainstorming`.

## The audit backlog (unchanged from 2026-07-06 audit)
- **Batch B (P1 perf)**: db pool config; slim list payloads; `useCallback` handlers; **2 one-line security fixes** (SVG upload allow-list `upload-url/route.ts`; login `next` open-redirect guard).
- **Batch C (P2)**: dead-code sweep (orphaned sidebar cluster, 2 dead actions, unused devDeps), TECH_STACKS.md fix, `useLocalStorage` in-tab sync.
- **Batch D (P3)**: dependency currency (AI SDK v7 = own spec), Node engines field.
- **P3 product**: resurrect archived chats UI; warm re-skin `src/lib/artifacts/style.ts`.
- **RAG deferreds**: Phase 1 replace-abort when `embedded===0`; P2b minors (splice test breadth, no-overlap comment — in `.superpowers/sdd/progress.md`).

## Working cadence (proven again this session)
- Sr Fullstack Engineer; brainstorm → spec (`docs/specs/`) → plan (`docs/plans/`) → subagent-driven build → Opus final review → user-gated release. **Model tiering** (Fable critical / Opus planning+integration / Sonnet mechanical): the memory `feedback_model_tiering_by_criticality` was stated "till 7/7/2026" — **now expired; user hasn't said whether to renew** (it caught 1 Important defect per release — recommend making it standing; ask).
- Release: merge `--no-ff` → `npm version minor -m "chore(release): v%s — …"` → push `--follow-tags` (user-gated, needs explicit wording) → `gh release create` → `gh run watch` → Vercel auto-deploys. Docs-only commits: no tag. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Gotchas (this session's new ones + carried)
- **Permission classifier**: prod-affecting commands (git push to master, `vercel env add`) need the user to name the action; generic "continue" is rejected. Offer the exact sentence to say.
- **This machine's network drops >1 MB POST uploads to `generativelanguage.googleapis.com`** (Node undici AND curl, sandbox on/off — likely VPN/security software). Local spikes that upload PDFs to Gemini will fail; prod (Vercel egress) is fine. Don't burn time re-diagnosing.
- **SHX diagnosis pattern**: doc-average density can hide per-page holes; per-page counts via unpdf are cheap to measure (script pattern in session; ~60 lines).
- **Carried**: no Prettier ever; `'use server'` const-export breaks build; `.env.local` has UTF-8 BOM (strip before parsing; never print values); Vercel preview behind auth (verify on prod); `.superpowers/sdd/task-N-report.md` filenames collide across plan cycles (harmless overwrite); PGlite suite needs `--no-file-parallelism` for a definitive green.

## Quick links
- Ledger (full per-task record incl. review findings): `.superpowers/sdd/progress.md` (git-ignored).
- Specs/plans this session: `docs/{specs,plans}/2026-07-07-rag-phase2-extraction-upgrade*`, `docs/{specs,plans}/2026-07-07-hybrid-page-extraction*`.
- Releases: v4.45.0, v4.46.0 at github.com/DanielTso/atelier_ai_gpt/releases. CHANGELOG.md has per-release detail.
