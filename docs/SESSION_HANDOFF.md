# Session Handoff — Atelier Studio (read me first)

_Last updated: 2026-06-07. This is the bootstrap doc for a new session. The project CLAUDE.md is the source of truth for how the code works; this doc tracks **where we are in the multi-phase build**._

## The program

Turning Atelier Studio into a Claude-powered **construction-document workhorse**. Four phases:

| Phase | What | Status |
|---|---|---|
| **A** | Claude as the chat provider (Opus 4.8 default, Sonnet, Haiku; web search). Gemini kept for image gen + embeddings. | ✅ **Merged to `master`** (local) |
| **B** | Migrate DB libSQL/SQLite → **Supabase Postgres + pgvector** (HNSW). PGlite tests. | ✅ **Merged to `master`** (local) |
| **B2** | Advanced RAG: query-rewrite → vector top-N → MMR → LLM rerank → top-k, tunable via `ragConfig` (env). Test suite ~40s→~15s. | ✅ **Merged to `master`** (local) |
| **C** | Extract info from construction **plans/drawings/images** (vision). | 🚧 **C2 done + tagged `phase-c2`** (local); render smoke passed on a real plan. Vercel runtime check pending deploy |
| **D** | Excel/Word **artifacts** (report generation). | ⛔ Not started |

`master` is **28 commits ahead of `origin` (nothing pushed yet)** — deploy is pending (below).

## Phase C — current state (branch `phase-c-extraction`)

Decomposed: **C2 (vision extraction) → C-storage (Supabase Storage) → C3 (UI)**. C2 first; it renders pages in-memory and reuses the existing chunk/embed/pgvector pipeline, so it needs no storage.

- **Design spec:** `docs/specs/2026-06-07-phase-c-construction-extraction-design.md`
- **C2 plan (ready to execute):** `docs/plans/2026-06-07-phase-c2-vision-extraction.md`
- **Spike: DONE — result GO.** Validated on a real Kimley-Horn IFC plan (`GradingPlanIFC.pdf`, gitignored/confidential, sitting untracked in repo root). `gemini-3.5-flash` read a dense cover sheet (full 223-row sheet index + PE stamp) and an overall site-plan drawing (zones, parking counts, dimensions) **accurately**. Throwaway script: `scripts/spike-vision-extract.mjs` (delete after C2 ships).
- **Validated recipe (baked into the C2 plan):** model `gemini-3.5-flash` (NOT the reasoning-heavy `gemini-3.1-pro-preview`); `maxOutputTokens ≥ 8000`; render `scale 3`; `pdfjs-dist@^5` **legacy** build (`pdfjs-dist/legacy/build/pdf.mjs`) + `@napi-rs/canvas@^0.1.x` (already installed as devDeps; C2 Task 1 promotes them to dependencies). Image content part: `{ type: 'image', image: Uint8Array }` via `generateText`.
- **The one real deploy risk for C2:** does `@napi-rs/canvas` (native) build/run on Vercel Fluid Compute? C2 plan Task 6 verifies via a preview deploy; documented fallback = **client-side pdf.js** rendering.

### ✅ C2 status (implemented 2026-06-14)
All 6 plan tasks done on `phase-c-extraction`. New `src/lib/visionExtraction.ts` (PDF page render via unpdf + pdfjs-dist@5 legacy + @napi-rs/canvas → Gemini Flash per page; `extractViaVisionImage` for single images). `/api/documents` now: image uploads → vision; thin/empty-text PDFs (< `EXTRACTION_MIN_TEXT_CHARS`, default 100) → per-page vision fallback. `EXTRACTION_*` env knobs. Downstream chunk/embed/pgvector unchanged.
- **Local gate GREEN:** lint 0 errors, build clean, full suite **167 tests pass** (incl. 5 visionExtraction + 4 documents-route). Typecheck clean. **Tagged `phase-c2`** (local, unpushed).
- **Render smoke PASSED (2026-06-14):** `node scripts/smoke-c2-render.mjs GradingPlanIFC.pdf 2` rendered pages 1–2 at scale 3 (native `@napi-rs/canvas` on Windows) and Gemini Flash transcribed them accurately (title block, PE seal, general notes). This proves the only genuinely-new runtime path; DB-side (chunk/embed/store) is unchanged from B/B2 and test-covered. `.env.local` has the Gemini key but **no Supabase DB**, so the full UI upload couldn't be exercised.
- **Native-canvas BUILD risk RESOLVED:** Turbopack couldn't bundle the native `.node` binding; fixed via `serverExternalPackages: ['@napi-rs/canvas','pdfjs-dist','unpdf']` in `next.config.ts`.
- **Bug found + fixed by the smoke (not caught by mocked unit tests):** pdfjs *detaches* the ArrayBuffer it parses, so reusing one `Uint8Array` across `getDocumentProxy` + each `renderPageAsImage` broke every page after the first (`DataCloneError`). Fixed by copying bytes per call from a pristine source; added a unit guard. The spike dodged it by rendering a single page.
- **⚠️ Caveat to decide:** `GradingPlanIFC.pdf` is **17 MB**, over the **10 MB** `MAX_FILE_SIZE` (and `serverActions.bodySizeLimit`) — a real UI upload of it would be rejected. Construction plans are routinely large; raising both limits is a likely follow-up (its own small decision/spec).
- **Design deviation from plan:** images are NOT added to the shared `SUPPORTED_EXTENSIONS`/`isSupported` (that broke `/api/extract`, which has no vision). Image acceptance is opt-in in `/api/documents`'s guard only.
- Commits: `0a16f80`(deps) `4583a52`(module) `dd71b97`+`dc14cd4`(image support+localize) `fb6895e`(route) `af4380c`(docs) `a15c205`(externalize) `be2986b`(review fixes).

### ⏳ C2 — remaining (USER, needs your env/creds)
Tag `phase-c2` already created locally (unpushed). The render path is smoke-proven; what's left all rides on the **Supabase deploy cutover** (DB not configured locally):
1. **Vercel native-canvas RUNTIME check** — build-bundling fixed + native render works on Windows, but whether `@napi-rs/canvas` *loads* on Vercel Fluid Compute (Linux) is unverified. `npm i -g vercel`, deploy a preview, run the upload (or `scripts/smoke-c2-render.mjs` in that env). Fallback if it fails = client-side pdf.js render (in the C spec).
2. **Playwright E2E** (`npm run test:e2e`) — needs `DATABASE_URL`/`DIRECT_URL` + a pgvector Postgres locally.
3. **Manual UI smoke** — with DB configured, upload a **≤10 MB** scanned/drawing PDF (or raise the cap first — see caveat above), confirm "ready" + chunks + the chat cites it.

### ▶️ After C2
C-storage (Supabase Storage for originals/thumbnails), then C3 (UI) — each its own brainstorm→spec→plan→build.

## ⏳ Pending USER actions (not blocking C development; tests use PGlite)

1. **Supabase deploy cutover** (Phase B went live-ready but isn't deployed): in `.env.local` set `DATABASE_URL` (Supabase pooled, :6543) + `DIRECT_URL` (direct, :5432), remove `TURSO_*`; run `DIRECT_URL=… npx drizzle-kit migrate`; set the same env in the Vercel dashboard; `git push` + `vercel --prod`. **Until then the deployed site runs the old Turso/Gemini stack.**
2. **Smoke-test A & B** locally with real keys.
3. Tag phases if desired (`phase-a`, `phase-b`, `phase-b2` after their smoke tests).

## Key architecture facts (also in CLAUDE.md)

- **Claude = brain** (chat, `@ai-sdk/anthropic`, web search). **Gemini = senses** (image gen + embeddings `gemini-embedding-001` 768-dim; Anthropic has no embeddings API). Housekeeping (title/summarize/classify) + vision extraction run on internal `gemini-3.5-flash`.
- **DB:** Supabase Postgres via Drizzle `postgres-js` (`prepare:false`, pooled runtime / direct migrations). pgvector `vector(768)` + HNSW. Versioned migrations in `drizzle/`. Tests on PGlite (`tests/helpers/test-db.ts`, shared instance + TRUNCATE).
- **RAG retrieval:** `src/lib/retrieval.ts` orchestrates the B2 pipeline; knobs in `src/lib/ragConfig.ts` (`RAG_*` env). Every stage degrades to plain vector search.
- **Workflow:** brainstorm → spec (`docs/specs/`) → writing-plans (`docs/plans/`) → subagent-driven execution with spec + code-quality review gates → finishing-a-development-branch. Role-based agents per `docs/plans/Coding_Sessions_Agent_Stack_Reference.docx.pdf`.
- **Keys are the user's** (in `.env.local`: `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`; + Supabase URLs for deploy). E2E needs a Postgres (CI provisions a `pgvector/pgvector` service).
