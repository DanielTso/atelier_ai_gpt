# Atelier Studio — Codebase Audit (2026-09-01)

**Scope:** full repository at `master` @ `d278fda` (6 commits ahead of `origin/master`, working tree clean before and after).
**Method:** seven parallel read-only audit lanes (security · database · AI pipeline · documents/storage/artifacts · frontend · QA gate/tests/CI · dead code/deps/docs), each run by an Opus subagent, followed by an independent critical-path review that re-read the source, re-ran targeted checks, and cross-examined every top finding. Every finding is tagged **CONFIRMED** (reproduced by a test, script, live read-only query, or a quoted code path) or **PLAUSIBLE** (strong reading, not executed). Nothing was modified in the repo; no LLM request was sent; no write touched the production database or bucket. Full per-lane reports (≈5,000 lines) are in the session scratchpad under `audit/`.

**Verification-gate result on this machine (cold):** typecheck **0 errors** · lint **0 errors / 24 warnings** · build **clean, zero warnings** · **`npm test` is RED — 4 reproducible failures** (see H-Q1). The handoff's "985 tests green" matches on counts, not on outcome.

---

## 0. Severity ledger

| Severity | Count | Definition used |
|---|---|---|
| **Critical** | 1 | Silent user-data corruption, auth bypass, or production-down |
| **High** | 26 | Wrong results, data loss/orphaning, exploitable weakness, or a red gate — needs a fix before/with the pending release |
| **Medium** | 33 | Real defect with bounded blast radius, or a latent failure one change away |
| **Low** | 45 | Correctness edge cases, hygiene, a11y details, doc drift |
| **Info** | 24 | Observations, design notes, unclaimed capabilities |

Counts are after de-duplication across lanes (e.g. RLS drift, Sonnet 5 pricing, `suggest-followups` capture, `deleteProject` orphans and the `/api/files/raw` doc gap were each found by two lanes).

**Where the critical-path reviewer overruled a lane:** (1) the Supabase RLS finding was raised as a Critical hypothesis and **disproved for the live DB** by a `pg_catalog` read — it stands as High drift, not a breach; (2) the `x-real-ip` throttle bypass is real for self-hosted deploys but Vercel's docs state it overwrites that header, so it is Low on the current platform; (3) the red `npm test` is a harness race, rated High not Critical; (4) a lane's claim that the extraction route "runs on the default `maxDuration`" is wrong — `process/route.ts:20` exports `maxDuration = 800` and Vercel honors it.

---

## 1. Read this first — the ten fixes that matter most

Ranked by (impact × certainty × cheapness). File references are clickable in the IDE.

| # | Sev | Finding | Where | Fix size |
|---|---|---|---|---|
| 1 | **Critical** | Switching chats mid-stream persists the reply into the **wrong chat** (and mis-scopes its embedding, usage, title and memory-suggest). Reproduced by test. | `src/app/page.tsx:583-593`, `src/hooks/useChatPersistence.ts:57,78` | Small — carry `chatId` from send time; call `stop()` on switch |
| 2 | High | `next@16.2.10` ships nine advisories fixed in 16.2.11, including a **Middleware/Proxy bypass for App Router + Turbopack** — `src/proxy.ts` is the app's only auth. | `package.json` | One-line, in-range |
| 3 | High | `pdfjs-dist@5.7.284` (arbitrary JS execution on a malicious PDF) is explicitly loaded on every upload via `definePDFJSModule`, in a function holding the service-role key. | `src/lib/thumbnails.ts:13` | Major bump to ≥6.2.108, or drop the override |
| 4 | High | Cost ledger loses every aborted/errored turn: no `consumeStream()`, no `abortSignal`, no `onAbort`, no `after()`; upstream generation also continues after the user leaves. | `src/app/api/chat/route.ts:198-250` | Small |
| 5 | High | Sonnet 5 is still priced at the expired $2/$10 intro rate; `pricing.ts` has **no date logic** despite its "reverting automatically" comment. Frozen `cost_usd` rows are 33% low, flagged exact. | `src/lib/models/pricing.ts:14-20` | One-line (do it before applying `0018`) |
| 6 | High | RLS on 12 of 15 tables exists **only as out-of-band live state** — `schema.ts`/migrations declare it off, so a fresh environment is anon-readable (incl. `settings`) and `drizzle-kit push` would emit `DISABLE ROW LEVEL SECURITY`. | `src/db/schema.ts` (3 × `.enableRLS()`), `drizzle/0013`, `0018` | One migration |
| 7 | High | `npm test` is red: `keywordSearch.test.ts` calls `createTestDb()` from `it()` bodies (5 s default timeout, not the 30 s `hookTimeout`), and `test-db.ts` publishes `client` before `migrate()` resolves, poisoning the file. Green with `--testTimeout=30000`. | `tests/unit/lib/keywordSearch.test.ts:11,26`, `tests/helpers/test-db.ts:25-27`, `vitest.config.ts:17` | Small |
| 8 | High | `deleteProject` sweeps **no** Storage objects; `deleteChat` sweeps attachments but not artifacts. Every child row cascades, so the paths are unrecoverable. | `src/app/actions.ts:73-75,196-199` | Medium |
| 9 | High | Hybrid documents stamp text-layer chunks with the **last vision page**; `pageRangeFor` seeds from the first anchor. Citation chips and `#page=N` deep-links point at the wrong sheet on exactly the plan sets hybrid exists for. | `src/app/api/documents/process/route.ts:145`, `src/lib/pageMap.ts:15-16` | Small |
| 10 | High | Archived chats are **unreachable** — `Sidebar` declares `archivedChats` and never renders it; `ChatItem variant="archived"` has zero callers. "Archive" reads as delete. | `src/components/chat/sidebar/Sidebar.tsx:18` | Small |

---

## 2. Findings by theme

Each entry: severity · title · location · evidence · verification · impact · fix. Lower severities are condensed to one line in §3.

### 2.1 Security

**[HIGH] S1 — `next@16.2.10` carries a Proxy/Middleware-bypass advisory and `src/proxy.ts` is the sole gate.**
`npm audit --omit=dev` (re-run independently): GHSA-6gpp-xcg3-4w24 *Middleware/Proxy bypass in App Router using Turbopack* plus GHSA-955p-x3mx-jcvp *unauthenticated disclosure of internal Server Function endpoints*, GHSA-m99w-x7hq-7vfj *DoS via Server Actions*, two cache-confusion and two SSRF advisories — all `>=16.0.0 <16.2.11`. The app is App Router + Turbopack (`next.config.ts:73`). **CONFIRMED.** Fix: `npm i next@^16.2.11` (or the in-range 16.3.4) and redeploy. Highest-priority *actionable* item.

**[HIGH] S2 — `pdfjs-dist@5.7.284` arbitrary-JS advisory on the upload path.**
GHSA-hq66-cqwq-w95j, `>=5.6.83 <6.2.108`. `src/lib/thumbnails.ts:13` opts out of `unpdf`'s bundled build with `definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))`, reached from `documents/process/route.ts:170-177` on every PDF; the override is process-global so subsequent text extraction uses it too. The function holds `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and every provider key. **CONFIRMED.** Fix: `pdfjs-dist@^6.2.108` (verify `renderPageAsImage` against the v6 legacy build) or remove the override.

**[HIGH] S3 — RLS is live-only state; the repo declares it off.**
Live `pg_catalog` (read-only): `relrowsecurity = true` on all 15 tables, `pg_policies` = 0 rows, `anon`/`authenticated` hold full DML grants but **not** `BYPASSRLS` → PostgREST default-denies today. But `src/db/schema.ts` has `.enableRLS()` on only `artifact_versions`, `generated_images`, `usage_events`; `drizzle/meta/0018_snapshot.json` says `isRLSEnabled:false` for the other 13; older handoffs (2026-06-18, 06-21) record a dashboard pass that turned RLS on out-of-band. **CONFIRMED (live + static).** Impact: a new Supabase project provisioned from `drizzle/` exposes `settings` (API keys), `messages`, `documents` to the browser-shipped anon key; `drizzle-kit push` would disable RLS on 12 tables. Fix: `.enableRLS()` on every table + a migration of 13 `ALTER TABLE … ENABLE ROW LEVEL SECURITY`; belt-and-braces `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` + matching `ALTER DEFAULT PRIVILEGES`; consider disabling the Data API for `public` (the app never uses PostgREST). Add "never `drizzle-kit push`" to CLAUDE.md with the reason.

**[MEDIUM] S4 — CSP `connect-src 'self' https:` gives model-generated artifact HTML an unrestricted exfil channel.** `next.config.ts:44`; sandboxed `srcDoc` iframes inherit the embedder CSP. Pairs with S9. Fix: `connect-src 'self' <supabaseOrigin>`.

**[MEDIUM] S5 — Client-declared MIME is never verified, and PDF previews iframe the cross-origin signed URL with no `sandbox`.** `useDocumentUpload.ts:14` → `upload-url/route.ts:17-26` validates only declared values; `DocumentPreviewDialog.tsx:159-163` iframes any `application/pdf` row. Upload HTML bytes named `report.pdf` → script runs on the `*.supabase.co` origin inside the app UI (no app cookies, but UI redress). **CONFIRMED by trace.** Fix: sniff magic bytes in `/process`; add `sandbox` or proxy previews same-origin like `/api/artifacts/[id]/raw`.

**[MEDIUM] S6 — 78 server actions with no argument validation; `setSetting` accepts any key including the provider API keys.** `actions.ts:312-330`. Read-side `SENSITIVE_KEYS` is airtight (verified — 3 readers, all filtered); write side has no allow-list. Fix: allow-list writable keys; dedicated action for API keys; Zod on id/free-text actions.

**[MEDIUM] S7 — The gate is opt-in and fails open.** `auth.ts:14-16`, `proxy.ts:10`; `verifyFilePathSig` also returns `true` when the gate is off (**CONFIRMED by test**). One deleted env var publishes everything, with no startup assertion. Fix: throw (or 503) in production when `APP_ACCESS_PASSWORD` is unset unless `ALLOW_UNAUTHENTICATED=1`; refuse to enable the gate without `AUTH_SECRET`.

**[LOW→MEDIUM self-hosted] S8 — Login throttle keys on client-supplied `x-real-ip`.** `api/auth/route.ts:22-31`. Reproduced: 25 failures with a rotating header never trip the 429 (fixed header does at 11). Vercel's docs state it overwrites this header, so **Low on Vercel, Medium anywhere else**. Fix: prefer `x-vercel-forwarded-for` / rightmost XFF; add the WAF rule `rateLimit.ts` already recommends.

**[INFO] S9 — Prompt-injection surfaces have no delimiting.** `projectPreamble.ts:4-5`, `chat/route.ts:176-179` (filename interpolated into the system prompt), `retrieval.ts:107` (chunk body can forge a `[Source:` header), `documents/tool.ts:55`. Concrete chain: poisoned PDF → `generate_artifact` HTML with a beacon → S4 lets it out. Fix: per-request random delimiters, strip `[Source:`/`[cite:` from chunk bodies, quote filenames.

Also (Low/Info, verified): 30-day cookies survive password rotation (documented tradeoff); `AUTH_SECRET` optional; `allow-popups-to-escape-sandbox` on the artifact preview; `/api/files/raw` is a permanent bearer capability (tight allow-list, HMAC-bound — acceptable as designed, but **undocumented in AUTH.md/CLAUDE.md**); `/login` exempt for POST too (server-action forwarding mitigation traced but not executed — gate `/login` to GET); `memory/suggest:89` logs extracted project facts verbatim; no `Permissions-Policy`, `poweredByHeader` not disabled; `z.string().url()` accepts `file:`/link-local for Tavily. **Verified clean:** no secrets in 618 revisions; no server-only module imported by any `'use client'` file; markdown rendering has no `rehype-raw`; HTML artifacts never render inline on the app origin; storage paths are server-derived and sanitized.

### 2.2 Cost ledger & model registry

**[HIGH] C1 — Usage rows are lost on every abort/error, and the upstream call is never cancelled.**
`chat/route.ts:198-250`: `streamText` has no `abortSignal: req.signal`, no `onAbort`, and `result.consumeStream()` is never called; `onFinish` fires from a transform `flush` that does not run on a cancelled/errored stream (`ai@6.0.230` dist ≈7228-7233). `recordUsage` is also `void`-fired after the response with no `after()`/`waitUntil`, so it races the function freeze. **CONFIRMED** (grep + installed SDK source; `after` is exported by `next/server` 16.2.10). Impact: every Stop, tab close, 429/529 = zero `usage_events` for billed tokens — precisely the long agentic turns the app targets. Fix: pass `abortSignal`, add `onAbort` summing `steps[].usage`, call `consumeStream()`, wrap the insert in `after()`.

**[HIGH] C2 — Sonnet 5 intro price never expired.** `pricing.ts:14-20` — `{2, 10}` static; `grep Date` → 0 hits. Sonnet 5 backs the default persona and `REGEN_MODEL`. Rows are frozen and `cost_estimated:false`. **CONFIRMED** (also by a `vi.setSystemTime` probe). Fix now: `{3, 15}` (or the `model-pricing-overrides` settings row); structurally: dated entries with `until`.

**[HIGH] C3 — `resolveRequestedModel` returns the requested alias, not the catalog id it matched.** `registry.ts:283-285` returns `requested` after a `byId` hit; for dated-only families (`claude-haiku-4-5-20251001`) the provider is handed `claude-haiku-4-5`. Pricing/capabilities go through `byId` (safe); the provider call does not. **CONFIRMED by test.** Fix: `return { modelId: registry.byId.get(requested)!.id, … }`.

**[HIGH] C4 — The "last 20 messages" cap is conditional.** `chat/route.ts:147-160` slices only when `chat.summary` is non-null *and* a context prefix exists; no Gemini key ⇒ no summary ⇒ the full loaded history (≤100 msgs × ≤200k chars, plus images and prior tool outputs) ships every turn. No layer consults `contextWindow`/`maxOutput` (both fetched, never read). **CONFIRMED.** Fix: slice unconditionally; cap `semanticContext`; add a token budget.

**[MEDIUM] C5 — 6 of 11 LLM generation sites record usage.** Unrecorded: `suggest-followups` (1/turn), `queryRewrite` (1/turn), `rerank` (2/turn), `image/generate` (real per-image spend), `visionExtraction` (many per ingest). **CONFIRMED by grep.** Fix: add `recordUsage` with new purposes (extend the `UsagePurpose` union + CHECK).

**[MEDIUM] C6 — Legacy `claude-3-x` ids parse to family `'other'`.** `curate.ts:12-15` regex `^claude-([a-z]+)`; `curateCatalog` emits the newest `'other'` into the picker; pricing lands on the conservative Opus tier (~5× a legacy Haiku). **CONFIRMED by test.** Fix: `/^claude-(?:\d+(?:-\d+)*-)?([a-z]+)/`.

**[MEDIUM] C7 — Adaptive thinking is sent unconditionally.** `providers.ts:41`; `supportsThinking` is derived and never read. Only effort is capability-gated. Fix: gate symmetrically.

**[MEDIUM] C8 — `REGEN_MODEL = 'claude-sonnet-5'` bypasses the registry.** `artifacts/[id]/regenerate/route.ts:15,50`. Fix: `resolveTier('sonnet')`.

**[MEDIUM] C9 — Non-400 provider errors collapse to a 5-second "An error occurred." toast.** `chat/route.ts:244-249`, `page.tsx:368-379`. 401/429/529/timeouts are indistinguishable and auto-dismiss. Fix: map status classes; don't auto-dismiss a turn failure.

Also: registry has no in-flight dedup (cold-start herd, up to 5 s on TTFT); `usage_events` insert failures (incl. the missing table today) are one `console.warn`; `getModelCapabilities` unused fields; prompt caching entirely unused (`cache_control` nowhere) — the largest untaken cost lever; web-search per-call fees not modeled; `webSearch_20260209` available but `_20250305` used. **Verified correct:** the cache-token split (`noCacheTokens`, never raw `inputTokens`) — the naive formula would over-bill 2.1× on a cached turn; `totalUsage` across the tool loop; `clearModelRegistryCache` after commit; per-entry override validation; `getMonthlyUsageByModel`'s UTC bucketing and `::float8` casts.

### 2.3 Database

**Live state (read-only, verified):** PostgreSQL 17.6, pgvector 0.8.0, pg_trgm 1.6; `drizzle.__drizzle_migrations` = 18 rows (`0000`–`0017`); `to_regclass('public.usage_events')` = NULL → **`0018` authored, not applied — CLAUDE.md and the handoff are accurate.** 15 tables, 44 indexes byte-identical to the migrations (HNSW ×2, GIN ×2 present), 1,073 chunks / 146 messages / 5 ready docs (all `hybrid`), zero orphans, zero stuck rows, **zero CHECK constraints, zero triggers, zero RLS policies.** `drizzle-kit check` passes; `drizzle-kit generate` reports no drift (0016's generated column is invisible to both sides). `settings` holds no API keys today.

**[HIGH] D1 — Hybrid search's FTS leg is dead for natural-language questions.** `keywordSearch.ts:49-61` feeds the whole ≤2000-char turn to `websearch_to_tsquery`, which ANDs every term. Live: `'can you list every storm drain sheet in the plan set'` → **0 hits** over 1,073 chunks; `'storm drain'` → 17. Silent (`[]` is indistinguishable from no matches). **CONFIRMED live.** Fix: OR-fuse content lemmas or fall back to an OR query when the AND form returns 0; log `(terms, hits)`.

**[HIGH] D2 — `ingestText`'s chunk swap is non-transactional.** `ingest.ts:19-24`: delete → insert → embed → status as four autocommits; the replace path (`commitDocumentReplacement`, `actions.ts:713`) was hardened, this shared tail wasn't. A kill between delete and the final status (timeout, OOM, Gemini stall) leaves a `ready` doc with `chunk_count` intact and **zero chunks** — invisible to the reaper. No unique index on `(document_id, chunk_index)`, so two concurrent `/process` calls can double the index. **CONFIRMED by reading.** Fix: embed first, then one transaction (the replace path already has the shape); add the unique index.

**[MEDIUM] D3 — `usage_events` lacks `created_at` and `project_id` indexes.** `0018:20-21`. `getMonthlyUsageByModel` filters `created_at >=` (unservable by `(model, created_at)`); `project_id ON DELETE SET NULL` unindexed ⇒ every project delete seq-scans the fastest-growing table. Cheapest window is **before 0018 is applied.**

**[MEDIUM] D4 — Zero CHECK constraints.** `status`/`role`/`purpose`/`extraction_method` are free text; only `saveMessage` validates. A stray `'Ready'` silently drops rows from the chat route's doc filter and the reaper. Fix: CHECKs (SQL provided in the lane report); add `usage_events_purpose_chk` + non-negative token CHECKs to 0018 before applying.

**[MEDIUM] D5 — Embeddings persisted one `UPDATE … RETURNING` per chunk** (`embedChunks.ts:39-53`, `actions.ts:748-753`) — up to ~1,250 round trips per document, each shipping the 768-dim vector both ways. Fix: drop `.returning()`; batch via `UPDATE … FROM (VALUES …)`, or insert chunks with embeddings in one transaction.

**[MEDIUM] D6 — Every `saveMessage` awaits an UPDATE on the single hot `projects` row** (`actions.ts:88-96,205-212`); live `projects` has 1 live / 25 dead tuples. Fix: fire-and-forget, debounce, or derive recency at read time; note `chats` has no `updated_at` so "recent chats" orders by `created_at`.

**[MEDIUM] D7 — HNSW indexes are sidelined by the `project_id` filter.** Live EXPLAIN: both vector queries use the btree + sort (planner-correct at 1k rows; `idx_embeddings_vector` has **0 scans ever**). At scale, `WHERE project_id` becomes a post-filter with `hnsw.iterative_scan = off` and `ef_search = 40` (< 2× `RAG_TOP_N`), so a project can get fewer than `topK` or zero results silently. Fix: `SET LOCAL hnsw.iterative_scan = relaxed_order`, raise `ef_search`; longer term partial indexes per project.

**[MEDIUM] D8 — Trigram GIN is 2.7× the heap and cannot serve 2-char identifiers** (`A1`, `E2` — `IDENTIFIER_RE` minimum match is 2 chars; pg_trgm needs 3). Fix: floor tokens at 3 chars; reconsider the index once D1 is fixed.

**[MEDIUM] D9 — Two dead indexes, one missing.** `idx_chats_project_id` (prefix of `idx_chats_archived_project`, 0 scans), `idx_messages_created_at` (0 scans); `getChatMessages`/`getProjectChatPreviews` want `(chat_id, created_at)`.

**[MEDIUM] D10 — `updateProjectDefaults` and `acceptSuggestion` mutate `projects` without bumping `updated_at`** (no trigger exists).

Also (Low): `drizzle-kit push` is destructive here (0016 objects + 12 RLS flags) — document as forbidden; `db/index.ts` has no dev-HMR singleton guard; `saveMessage` silently truncates at 200k chars — **it has fired twice in production**; message ordering keys on `created_at` not `id`; six unbounded reads (`getDocumentChunks` up to ~2.4 MB via a server action; the per-turn manifest is `select *` filtered in JS); `document_chunks.project_id` is denormalized with nothing enforcing agreement. **Verified correct:** every raw-SQL site parameterizes (`sql.raw` never appears in `src`); all six `db.transaction` sites (incl. `acceptSuggestion`'s in-SQL append, which closes the lost-update race); the pgvector query shape (`<=>` + post-filter threshold); `usage_events` `SET NULL` semantics; the reaper.

### 2.4 Documents, extraction, storage, artifacts

**[HIGH] X1 — Hybrid page stamping is wrong; `pageRangeFor` seeds from the first anchor.** `process/route.ts:145` pushes text pages with no `# Page n` anchor; `pageMap.ts:15-16` initialises `pageStart = pageEnd = map[0].page` so pre-anchor and between-anchor chunks inherit the nearest vision page. A 40-page doc with one vision run on p4 stamped its **last** chunk `{4,4}`. All 5 production docs are `hybrid`. **CONFIRMED by test** (two lanes independently). Fix: emit `# Page n` for every page on the hybrid *and* text paths (gives text-path docs page provenance for free); return `null` for chunks before the first anchor.

**[HIGH] X2 — Vision extraction materialises the whole segment set in RAM.** `pdfSegments.ts:51-69` retains every segment; measured with real `pdf-lib`: a 164.8 MB PDF → RSS 643.8 MB after split, +~44 MB base64 per in-flight segment ×2; `downloadToBuffer` doubles the source transiently. At the 200 MB cap: ~0.8–1.4 GB against a 2 GB default. **CONFIRMED by measurement.** Fix: stream segments (async generator), drop the `Buffer.from` copy, or lower the vision-path cap.

**[HIGH] X3 — A 500-page plan set cannot finish inside `maxDuration = 800`, and nothing is checkpointed.** 25 segments ÷ concurrency 2 = 13 waves ⇒ 61 s/wave for a 60k-output-token transcription of 20 sheets; a platform kill discards everything; the reaper flips the row to `error` 20 min later. **CONFIRMED by arithmetic** (per-segment latency unmeasured). Fix: persist per-segment output and make `/process` resumable; or lower `EXTRACTION_MAX_PAGES` to what fits and raise concurrency.

**[HIGH] X4 — `deleteProject` sweeps nothing; `deleteChat` orphans artifacts.** `actions.ts:73-75,196-199`. Full orphan matrix in the lane report. Fix: collect paths before the cascade and `removeObjects`; reuse the artifacts DELETE sweep in `deleteChat`.

**[HIGH] X5 — PDF artifacts silently delete curly quotes/apostrophes.** `toPdf.ts:18-19`: the quote character classes contain U+201A/U+2032 and U+201E/U+2033 but **not** U+2018/2019/201C/201D (the `'`/`"` in them are ASCII), so curly quotes fall through to `[^ -ÿ]` and vanish: `winAnsi("don’t") === "dont"`. The existing test asserts only "does not throw". **CONFIRMED by test + code-point dump.** Fix: put the real code points in the classes.

**[MEDIUM]** X6 `extracted.txt` of the *current* revision is never deleted (`documents/route.ts:44-53` lists rev 1 + phantom `rev1/`); X7 an abandoned replace bricks a healthy doc (`upload-url` sets `uploading` before any byte moves; reaper errors it at 60 min; manifest hides it while RAG still serves it); X8 a throw after `status='processing'` leaves the spinner for 20 min (no catch around the ingest tail); X9 `failedPages` omits oversize-skipped and page-capped pages (CLAUDE.md claims otherwise — **CONFIRMED by test**); X10 `addArtifactVersion` read-then-write with no unique `(artifact_id, version)`; X11 `sliceWindow` can split a `# Page n` anchor across windows, mislabelling both (**CONFIRMED**); X12 the replace-abort path orphans three `rev<N>` objects, not one; X13 `artifacts/style.ts` still ships the retired steel-blue palette while claiming to mirror `globals.css` — every generated XLSX/DOCX/PDF/PPTX is off-brand (**CONFIRMED by diff**).

Also (Low): code blocks lose indentation and clip long lines in PDF; a C1 control char still crashes `toPdf`; whole-batch signed-URL failures are swallowed silently; `getChatArtifacts`/`getArtifactVersions` still sign per row (the hottest listing); `read_document` and keyword search ignore `documents.status`; `/api/extract` is live (chat attachments) but sits behind Vercel's ~4.5 MB body limit with a 200 MB app cap and its output is truncated at 200k on save; `mapWithConcurrency` rejects the pool on first throw. **Verified correct:** the replace flow's embed-before-destroy property; the stale-row reaper; server-derived storage paths; artifact create/edit/regenerate roll back their object on DB failure; `toXlsx` formula-injection guard (probed with `=`, `@`, `+`, `-`, `=cmd|…`); ragged Markdown tables normalised by `marked`; UUID artifact paths cannot collide.

### 2.5 Frontend

**[CRITICAL] F1 — Chat switch mid-stream writes the reply into the wrong chat.** `page.tsx:583-593` clears state on switch but never calls `stop()` (only wired to the composer button, `:283,1381`); `useChatPersistence.ts:57` resolves `activeChatIdRef.current` at *completion* time and `saveMessage(currentChatId, …)` at `:78`. Reproduced: `saveMessage(2, 'assistant', "answer for chat 1")`. Also mis-scopes `/api/embed`, `incrementUsageMessageCount`, memory-suggest, title, and `saveGeneratedImage`; the shared `useChat` store means the stream can re-materialise inside chat B's transcript. **CONFIRMED by test + independent read.** Fix: capture `chatId` at send (`streamingChatIdRef`), drop the write when it no longer matches, and `stop()` at the top of the switch effect.

**[HIGH] F2 — Archived chats are unreachable.** `Sidebar.tsx:18` declares `archivedChats`, never destructures it; `variant='archived'` has zero callers; `loadArchivedChats`/`restoreChat` still wired. Fallout of the v4.51.0 `ArchivedSection` removal. **CONFIRMED by grep.**

**[HIGH] F3 — Opening any chat whose last message is a user turn re-saves and re-embeds it.** `page.tsx:957-996` guards only on "id I last saved"; DB-loaded ids never match. Every open after a Stop/error/tab-close appends a duplicate row + vector. **CONFIRMED by trace.** Fix: mark loaded messages.

**[HIGH] F4 — `useLocalStorage` writes `initialValue` over the stored value on every mount.** Hydrate effect sets `rawRef` and `hasHydrated` synchronously; the write effect in the same commit sees `storedValue` still at `initialValue` → two spurious writes + a broadcast; a later-mounting sibling transiently resets the mounted one (`[[a,b],[],[a,b]]`). Visible flicker for `custom-personas`, `artifact-panel-width`, `pinned-project-ids`, `project-doc-scope-*`; a tab closed in the window persists the initial. **CONFIRMED by test + read.**

**[HIGH] F5 — 41 raw Tailwind `-400`/`-500` colours fail WCAG AA on the light-first theme; only 9 `dark:` classes exist app-wide.** Independently recomputed: green-400 **1.74**, amber-400 **1.67**, red-400 **2.77**, blue-400 **2.54** on white (all pass on dark). Also the primary CTA (white on terracotta) is **3.90**, `--brand-slate-text` on paper **4.28**, `text-muted-foreground/60` timestamps **2.19**. Tokens that pass exist (`--destructive` 4.99, `--brand-success` 4.73). Sites: `Toaster.tsx:14-16`, `DocumentCard.tsx:49-71`, `MessageActions.tsx:85`, `DeleteConfirmDialog.tsx:35`, +16 files.

**[HIGH] F6 — The error banner lives only inside the active-chat branch.** `page.tsx:1321` vs `setError` at `:402,412,808,913` (models failed, projects failed, **chat creation failed**) — invisible on Home and the project landing page. **CONFIRMED by trace.**

**[HIGH] F7 — Hover-revealed controls have no focus reveal** (7 sites; `focus-visible` appears once app-wide) — keyboard users land on invisible Delete buttons.

**[MEDIUM]** F8 `useUrlNavSync` leaves `isApplyingPopRef` stuck after a no-op popstate, swallowing the next real push (**CONFIRMED**); F9 deep-linking `?chat=N` pushes a phantom entry when the project resolves (**CONFIRMED**); F10 Command palette: Escape does nothing despite the footer (`cmdk` handles no Escape — **CONFIRMED**), no dialog role/trap/restore; F11 sidebar chat rows and document cards are click-only `div`s; F12 6 of 9 Radix dialogs lack `Description`; F13 panel resize writes localStorage on every `pointermove`; F14 `reconstructChunks` is O(chunks×500) on the main thread; F15 mobile: the sidebar overlays at 390 px and paints over its own hamburger; F16 `HomeGreeting` computes time-of-day in render → hydration mismatch (Phoenix vs UTC); F17 Images filter row disappears when a project has no images; F18 concurrent drops clobber attachments; F19 `ArtifactThumbnail` iframes the cross-origin PDF URL the codebase documents as blocked; F20 four fetch effects with no cancellation.

Also (Low): `SheetsPreview` throws on malformed sheets; gallery dropdowns close only on mouse-leave; `ArtifactWorkspace` tab/edit reset on refetch, stale versions after restore, `pointercancel` leak; stale `default-model` survives Save and family detection uses name prefixes; `ProjectDocumentsDialog` uploads only the first dropped file; no loading state for projects/chats; `PROJECT_CAPACITY_BYTES` read from client code (always `undefined`); `global-error.tsx` hardcodes cool-palette hex; dead props (`Sidebar.activeProjectId`, `MessagesList.onDeleteMessage`, `MessageActions.onRegenerate`, `SmartChatMenu` expanded branch); composer textarea disabled while streaming (contradicts the documented e2e expectation); `Lightbox` has no scroll lock/focus management. `page.tsx`: 1,623 lines, 27 `useState` / 21 refs / 13 effects / 44 `useCallback` — a nine-seam decomposition is in the lane report (F1/F3 live in the first seam). **Verified correct:** refs-for-closures on the transport body; `loadMessages` double staleness check; `MessageBody` memoisation really holds during streaming; `sidebarActions` memo; `useDialogs`; reduced-motion; `citations.ts`/`remarkCitations.ts` regex hygiene; 39 hook/component test files all green.

### 2.6 Tests, gate, CI

**[HIGH] Q1 — `npm test` is red, reproducibly.** 3/3 full runs: 141 files / 985 tests, **4 failed** in `keywordSearch.test.ts` (`Test timed out in 5000ms` then `relation "artifact_versions" does not exist` ×3). Root cause verified: the only DB file calling `createTestDb()` from `it()` bodies (`seed()`, `:11,26`) gets the default `testTimeout: 5000`, not `hookTimeout: 30000`; `test-db.ts:25-27` assigns `client`/`testDb` **before** `await migrate()`, so an aborted first call poisons the file. Green with `--testTimeout=30000` (141/141, 985/985), `--no-file-parallelism`, or alone. Two other lanes hit the same load sensitivity (`artifacts/tool.test.ts` 5 s timeouts). Fix: move `createTestDb()` to `beforeEach`; memoize the init promise and publish only after migrate; set `testTimeout: 15000`.

**[HIGH] Q2 — Nothing stops a unit test from connecting to production.** `src/db/index.ts:1` loads `.env.local`; `vitest.config.ts` has no `setupFiles`/`env`; 30 of 141 files mock `@/db`; `tests/global-setup.ts` is dead (never referenced). No test reached prod during the audit — the backstop simply doesn't exist. Fix: `setupFiles` that sets an unroutable `DATABASE_URL` and a default `vi.mock('@/db')`.

**[HIGH] Q3 — CI gaps.** No `timeout-minutes` (6 h default), no `concurrency` group (every PR runs twice), lint has no `--max-warnings`, Playwright browsers uncached, `webServer` has no `timeout` (60 s default for a cold `next dev` on 2 vCPU), `retries: 2` masks flakes, no `permissions:` block, no Dependabot. Build-before-migrate is safe only because `/` prerenders static. **CI does get right:** `npm ci`, npm cache, pgvector service with health check, migrate before e2e.

**[MEDIUM] Q4 — The PGlite "once per worker" claim is false** — Vitest's forks pool isolates modules per file, so all 34 DB files boot their own instance + 19 migrations (~9 s each; suite is 65 s, not ~15 s). **[MEDIUM] Q5 — No coverage provider installed** (`test:coverage` cannot run); static map: **46 of 173 src modules (27%) untested**, highest-risk `api/artifacts/[id]/raw` (the same-origin proxy the CSP was relaxed for), `lib/errors.ts` (the sanitizer every route uses), `useDialogs`. **E2E:** 9 tests, none exercises a chat turn, an upload, an artifact, or retrieval; `project-management.spec.ts` asserts the home screen while claiming the sidebar; `chat-flow` "send button visible" would pass with the button deleted.

**Edge-case probes (129 written, 112 passed):** confirmed `formatPageList` drops non-positive pages (sentinel collision); `formatUsd` renders `$NaN`/`$∞`; `sliceWindow` `fromPage` respects document not page order and `maxChars: 0` spins; `rrfFuse` double-scores an id repeated within one list (unreachable today); `parseCitation` accepts `p9-3`; `hideIncompleteTrailingCite` misses a partial after a completed marker; `parseNavUrl` accepts `1e3`/`0x10`; anchors are whitespace-strict; `usageTokens` passes negative counts through. **Strongest modules:** `auth.ts` 16/16 adversarial probes, `usage.ts` 10/10 (no double-counting), `chunking.ts` (1 MB no-space line terminates), `mmr.ts` (never NaN), `citations.ts`.

### 2.7 Dead code, dependencies, documentation

**[HIGH] K1 — Four directly-imported packages are undeclared:** `@shikijs/themes`, `@shikijs/langs` (14 dynamic imports, `highlighter.ts:38-68`), `unist-util-visit`, `@types/mdast` (`remarkCitations.ts:11-12`) — zero matches in `package.json`, present only as hoisted transitives. A `shiki`/`react-markdown` bump or a stricter installer breaks the build; the dynamic ones surface at runtime. **CONFIRMED.**

**[HIGH] K2 — README's front door points at a ~19-release-stale handoff.** `README.md:118` → `docs/SESSION_HANDOFF.md` (undated, "through v4.35.0", "28 commits ahead", "276 tests", "D2 next"). CLAUDE.md says read the latest dated one. Two contradictory entry points — the exact failure mode the current handoff's finding 13 warns about.

**[MEDIUM]** K3 CLAUDE.md still says SQLite at `:181` ("Server state: SQLite via server actions") and `:265` ("in-memory SQLite"); a real 32 KB `sqlite.db` from the Ollama era is **tracked in git** (`.gitignore:53` inert); K4 no `.env.example`; `DOCUMENT_MAX_CHARS`, `EMBED_CONCURRENCY`, `EMBED_MAX_RETRIES`, `PROJECT_CAPACITY_BYTES` documented nowhere; K5 ~46 modules absent from CLAUDE.md incl. two whole routes (`/api/files/raw` — also the gate's undocumented third exemption — and `/api/suggest-followups`, a 7th LLM site with no usage capture); K6 README wrong on tests (215 vs 985), models, brand, Node version, and silent on five shipped features (gate, grounded/citations, web ingest, code artifacts, Usage tab).

**Dependencies:** 34 outdated, 13 majors behind (`marked` 14→18, `ai` 6→7 — re-verify `inputTokenDetails` before any v7 bump, `pdfjs-dist`, `typescript` 5→7, `eslint` 9→10); 19 close with plain `npm update`. **No genuinely unused dependency** (all four depcheck hits were Tailwind v4 `@plugin` false positives). `npm audit`: 17 advisories (11 high) — CHANGELOG 4.52.0's "8 moderate, monitor don't force" is now wrong. No `packageManager`, no `.nvmrc`; `engines >=22`, CI 22, local/prod 24.

**Dead code (confirmed by grep):** `tests/global-setup.ts`, `tests/helpers/mock-ai.ts`, `scripts/spike-vision-extract.mjs`; `ChatListSkeleton`, `ProjectListSkeleton`, `isImageExtension`; ~21 needlessly-exported symbols; duplicate `IMAGE_MIME_TYPES` with different members (`fileExtraction.ts:40` vs `fileAttachments.ts:14`). **Verified clean:** 0 TODO/FIXME/HACK, 0 `eslint-disable`, 0 `@ts-ignore`, 0 `debugger`, 1 justified `as any`; every legacy marker (`PRAGMA`, `budget_tokens`, `bg-gradient-to`, `createDocument(`, `maxTokens`, the v4.51.0 sidebar removals) returns zero hits in live code; `.git` is 8.7 MB with no large blob ever committed; `.prettierrc` correctly absent.

---

## 3. Doc-vs-code mismatches (consolidated)

| Doc / line | Claim | Reality |
|---|---|---|
| CLAUDE.md:181, :265 | SQLite server state / in-memory SQLite tests | Supabase Postgres / PGlite (contradicted within the same file) |
| CLAUDE.md:158 | `db/index.ts` "connection with FK enforcement" | SQLite-era phrasing; the file sets pool options only |
| CLAUDE.md (Context Pipeline) | "Last 20 messages in full detail" | Sliced only when a summary exists |
| CLAUDE.md (Registry) | "one newest entry per family" | `'other'` family leaks a fifth Claude row |
| CLAUDE.md (Pricing) | Sonnet 5 "reverting to $3/$15 after 2026-08-31" | No date logic; still $2/$10 |
| CLAUDE.md (Usage) | "one row per LLM generation … six capture sites" | Six is accurate; 11 generation sites exist |
| CLAUDE.md (Effort) | `selectedEffort` "clamped on model switch" | Display-only clamp; server strips it (correct outcome, wrong mechanism) |
| CLAUDE.md (Thinking) | capability-driven | Thinking is unconditional; only effort is gated |
| CLAUDE.md (Gemini text) | Google Search grounding on internal Gemini | Branch never executes — no caller passes the tool |
| CLAUDE.md (`failed_pages`) | "or a page is skipped as oversize" | Oversize skips and page-capping are not recorded |
| CLAUDE.md (Testing) | PGlite "created once per worker … ~15 s" | Once per file; suite is ~65 s |
| CLAUDE.md (Security) | "All POST API routes validate with Zod" | `/api/extract` uses `formData` + custom validation; GETs hand-coerce ids |
| CLAUDE.md (CSP) | — | Omits `connect-src 'self' https:`, `object-src 'self'`, YouTube allowances |
| CLAUDE.md (Styling) | "no backdrop-blur anywhere" / "16 glass-panel consumers" / "`text-ink` in use" | 11 `backdrop-blur-sm` sites / 21 files, 28 occurrences / `text-ink` has zero uses |
| CLAUDE.md (Sidebar) | `ArchivedSection` was "dead and removed" | It was the only archived-chats UI |
| CLAUDE.md (E2E) | "Textarea is always enabled" | `disabled={isLoading}` during every response |
| CLAUDE.md (Artifacts) | PDFs via same-origin proxy | True for `ArtifactPreview`; `ArtifactThumbnail` uses the cross-origin URL |
| CLAUDE.md:217 | "~6 files by hand" | Names four |
| CLAUDE.md (Migrations) | `0000`–`0017` applied, `0018` pending | ✅ **Accurate — verified live** |
| CLAUDE.md (Vercel CLI) | installed & authenticated | ✅ `vercel@54.14.5` installed; `.vercel/` has `repo.json` only, no `project.json` |
| AUTH.md:15 | Exemptions: `/login`, `/api/auth` | `/api/files/raw` is a third (HMAC-signed, undocumented) |
| README.md:118, :100, :10, :53, :106 | Stale handoff link; 215 tests; Opus 4.8/Sonnet 4.6; Node 24; Atelier Technologies brand | See K2/K6 |
| SESSION_HANDOFF_2026-09-01.md:7, :50 | "5 commits ahead" | 6 (`7f6ca74..d278fda`) |
| CHANGELOG 4.52.0 | "8 moderate advisories, monitor" / "26 warnings" | 17 (11 high) / 24 |
| PERSONAS.md | roster + tiers | ✅ Accurate (no edit-date stamp) |

---

## 4. Impact on the pending release checklist

The handoff's next action is: apply `0018` → push → live-smoke → version/tag. This audit changes the order:

1. **Before applying `0018`:** fix Sonnet 5 pricing (C2), add `created_at`/`project_id` indexes and the `purpose`/non-negative CHECKs (D3, D4), and fold the 13 `ENABLE ROW LEVEL SECURITY` statements into a migration (S3). All are small and only get cheaper before the table exists.
2. **Before pushing:** `next@^16.2.11` (S1); fix the red gate (Q1) so the release rule "gate passes clean" is true; declare the four phantom deps (K1); wire `abortSignal`/`consumeStream`/`after()` (C1) so the ledger is trustworthy from row one.
3. **With the release:** F1 (wrong-chat write), F2 (archived chats), F3 (duplicate re-save), X1 (hybrid pages), X5 (PDF quotes), X4 (storage sweeps). Each is contained and independently testable.
4. **Follow-ups:** `pdfjs-dist` major (S2), streaming/resumable extraction (X2/X3), FTS OR-fusion (D1), transactional ingest (D2), contrast pass (F5), docs refresh (K2–K6), `page.tsx` decomposition.

---

## 5. What is genuinely solid

- **Auth primitives:** signed `exp` + nonce, signature-before-parse, constant-time compare, HMAC-of-both-sides password check; 16/16 adversarial probes passed; matcher hardening with a regression test; open-redirect guards on both ends.
- **Cost accounting:** the cache-token split is correct against the installed SDK source (naive formula would over-bill 2.1×); `totalUsage` across the tool loop; UTC-bucketed rollups with `::float8`; validated pricing overrides; the unpriced sentinel never renders as "$0.00".
- **Retrieval degradation** is genuinely layered — each leg has its own try/catch; the query embedding is computed once; `excludedDocumentIds` reaches all four surfaces; the HNSW-preserving query shape is right.
- **Storage discipline:** server-derived paths, sanitization, embed-before-destroy on replace, rollback of uploaded objects on DB failure, `.html` forced to attachment on both routes, formula-injection guard in XLSX.
- **Migration hygiene:** `check` passes, `generate` reports no drift, live `__drizzle_migrations` matches the journal exactly, and the test DB runs all 19 migrations so `0018` is covered before it ships.
- **Test hygiene:** 0 skipped/todo/only, 0 assertion-free, 0 snapshots, 0 `doMock` leaks, all fake timers restored, 25 explicit 400-path assertions.
- **Code hygiene:** 0 TODO/FIXME/HACK, 0 `eslint-disable`, 0 `@ts-ignore`, 1 justified `as any`; every legacy marker greps clean; `next.config.ts` documents what was tried and why each tradeoff stands.
- **Frontend craft:** refs-for-closures on the transport body, streaming memoisation that actually holds, event-driven stage machine, reduced-motion support, hook-level tests for the tricky hooks.

---

## 6. Methodology & limits

- **Executed:** cold `npm run typecheck` / `lint` / `build` / `test` (×3); ~540 targeted vitest runs per lane; 129 edge-case probes + ~60 lane-specific throwaway tests (all deleted); `npm audit`, `npm outdated`, `npm ls`, `knip`, `depcheck`; `drizzle-kit check` and a cleanup-guarded `generate`; ~60 read-only `SELECT`/`EXPLAIN`/catalog queries against production (no `ANALYZE`, no writes); a real-`pdf-lib` memory measurement; WCAG ratio computation (independently recomputed by the reviewer); installed-SDK source reads (`ai@6.0.230`, `@ai-sdk/anthropic@3.0.98`, `next@16.2.10`, `cmdk`, `@ai-sdk/react`).
- **Not executed (by rule):** any LLM/provider request; the dev server; Playwright e2e; any write to Supabase; a PostgREST probe with the anon key (blocked by the permission classifier — replaced by the `pg_catalog` read, which is authoritative).
- **Unverified and worth one production test each:** real per-segment Gemini latency (X3); whether a 200 MB PDF OOMs at the configured memory (X2); whether Anthropic still serves bare aliases at `/v1/messages` (C3); whether the `/login` server-action forwarding re-enters the proxy on Vercel (S-Low); Storage-bucket orphan count (X4 — a one-off reconciliation script would quantify it).
- **Process note:** two lanes' cleanup collided on the shared `tests/audit-tmp/` path mid-run (one lane's throwaways were deleted and recreated). `tests/audit-tmp/` is un-ignored and matched by the Vitest include glob — add it to `.gitignore` and the Vitest/ESLint excludes if ad-hoc probe tests recur.
