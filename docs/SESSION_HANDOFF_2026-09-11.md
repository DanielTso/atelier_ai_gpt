# Session Handoff — 2026-09-11

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-09-01.md` (kept as the Dynamic Model Registry point-in-time record)._

## TL;DR — where the project is

- **Audit remediation, Phases 1–2, is COMPLETE — Tasks 1–9 done, gate green, nothing pushed.** Built from `docs/audits/2026-09-01-codebase-audit.md` (the seven-lane audit run at session start on `d278fda`) via `docs/plans/2026-09-11-audit-remediation.md`, subagent-driven with a per-task ledger at `.superpowers/sdd/2026-09-11-audit-remediation/progress.md`.
- **Migrations `0018`–`0021` are APPLIED to production Supabase** (user-approved Task 4, executed mid-session). Verified read-only: `drizzle.__drizzle_migrations` = 22 rows; `usage_events` present with indexes `idx_usage_events_{chat_id,created_at,model_created,project_id}` + pkey and CHECKs `usage_events_purpose_chk` / `usage_events_tokens_nonneg_chk`; row-level security enabled on all 16 public tables (`rls off on: []`); `anon`/`authenticated` table grants = 0; default ACL now `postgres` + `service_role` only.
- **The cold gate is green**: typecheck 0 errors, lint 0 errors / 24 warnings, build clean (24 routes, no warnings), **143 test files / 997 tests passing, 0 failed**. See "Gate numbers" below for the exact commands and a note on the small variance from the plan's projected 995.
- **23 commits are local and UNPUSHED, pending explicit approval** — 6 pre-existing from the 2026-09-01 session (`7f6ca74..d278fda`) plus 17 from this one (`6d1449a..f9ec6af`, the audit doc through Task 9's fix round; Task 10's handoff commit is #24). `git rev-list --count origin/master..master` = 23 as of `f9ec6af`. **Pushing auto-deploys to Vercel** — do not push without explicit approval, and the SDD-mandated Fable whole-branch review of the full diff has not yet run.
- **`package.json` is still `4.51.0`**; CHANGELOG carries **four unreleased entries** (`4.52.0` dep slice, `4.53.0` grounded & cited, `4.54.0` dynamic model registry, `4.55.0` this session's audit remediation) and no tags exist past `v4.51.0`.
- **Next action is the release checklist below** — whole-branch review → push approval → live smoke → version/tag catch-up → write Phase 3.

## What shipped this session

Audit: `docs/audits/2026-09-01-codebase-audit.md` (commit `6d1449a`, "docs: add 2026-09-01 codebase audit"). Plan: `docs/plans/2026-09-11-audit-remediation.md`. Ledger (every commit, every review verdict, every ruling): `.superpowers/sdd/2026-09-11-audit-remediation/progress.md`.

Run order was T1 → T2 → T3 → T5 → T6 → T7 → T8, then a single stop for the user-gated Task 4 (production migrate), then T9 → T10 — batching the one irreversible step to one checkpoint instead of two.

| Task | Commit(s) | What | Audit finding(s) |
|---|---|---|---|
| Plan | `c6a1ea5` | Authored `docs/plans/2026-09-11-audit-remediation.md` | — |
| 1 | `3424504`, `d8ddb7e` | Sonnet 5 pricing: expired $2/$10 intro rate → standing $3/$15; reprice test re-armed to discriminate via a pricing override (a plan-mandated fix-round finding) | C2 |
| 2 | `b1cf71a` | Migration `0019`: `usage_events` indexes on `created_at`/`project_id`; `purpose` and non-negative-token CHECKs | D3, D4 |
| 3 | `df259e5`, `138c4b8` | Migrations `0020`/`0021`: `.enableRLS()` declared in `schema.ts` for the 13 tables whose RLS previously lived only in the Supabase dashboard; `anon`/`authenticated` table grants revoked (guarded no-op where the roles don't exist) | S3 |
| — | `1205d4f` | `docs/MODEL_ROUTING.md` — standing routing doc, written out-of-sequence mid-session per user instruction ("use model routing, do not only use Fable for all tasks") | — |
| 4 | `c4c6f1e` | User-approved production migrate: `0018`–`0021` applied to Supabase; CLAUDE.md status lines corrected in the same commit | — |
| 5 | `8a12ef0` | Fixed the red test gate: PGlite init is now a memoized promise published only after `migrate()` resolves; `createTestDb()` moved out of `it()` bodies; `testTimeout: 15000` | Q1 |
| 6 | `d143a79` | Declared four directly-imported packages that were only hoisted transitives: `@shikijs/themes`, `@shikijs/langs`, `unist-util-visit`, `@types/mdast` | K1 |
| 7 | `ba43b71`, `6ffe073` | `next` 16.2.10 → 16.2.11 (proxy/middleware bypass advisory) → **16.3.4** (two NEW critical unauthenticated RCEs published after the audit closed, fixed only in ≥16.3.3 — see Findings below); `eslint-config-next` in lockstep | S1 |
| 8 | `de27738`, `93ccd2d` | Cost-ledger abort handling: `abortSignal: req.signal`, `onAbort` summing completed-step usage via new `sumUsage()`, `consumeStream()` server-side drain, insert wrapped in `after()`; a first-wins guard plus a skip-when-usage-is-undefined check make the row exactly-once even though the SDK fires both `onAbort` and `onFinish` on a mid-tool-loop abort | C1 |
| 9 | `885ddea`, `f9ec6af` | CHANGELOG `4.55.0` entry; CLAUDE.md updated (migration status, RLS/grants, cost-capture guard description); last stale "0018 not yet applied" mentions cleared | K2 (doc-drift discipline) |

Every task got an independent review (Sonnet for mechanical diffs, Opus for the schema/RLS/streaming diffs, per `docs/MODEL_ROUTING.md`); six tasks (1, 3, 6, 7, 8, 9) needed a fix round or a pre-review correction, all closed with the reviewer's re-check. Full verdicts and rulings are in the ledger, not repeated here.

### Gate numbers (this session, cold, in order)

```
npm run typecheck          → exit 0, 0 errors
npm run lint                → exit 0, 0 errors / 24 warnings
rm -rf .next && npm run build → exit 0, 24 routes, no warnings, ~40s
npm test                    → exit 0, 143 files / 997 tests passed, 0 failed, 68.44s (vitest-reported)
```

The plan projected 995 tests (985 baseline + 4 from Task 2 + 2 from Task 3 + 3 from Task 8's `sumUsage` tests + 1 from Task 8's route test). The measured count is **997 — 2 more than projected**, with zero failures and zero skips either way. This is a projection variance in the plan's task-by-task arithmetic (most likely Task 3's or Task 8's fix round added slightly more assertions than the plan's estimate), not a gate problem — every file passed, nothing was red at any point in the session. Not investigated further since it doesn't change the pass/fail outcome.

## Findings that will bite whoever picks this up

1. **The AI SDK fires BOTH `onAbort` and `onFinish` on a mid-tool-loop abort.** Verified with the real `streamText` + `MockLanguageModelV3` (`ai@6.0.230`, dist:7226–7280, 7329–7338): after ≥1 completed step, `abort()` calls `onAbort` then `controller.close()`, and the recording transform's `flush` calls `onFinish` anyway (no abort guard) with `createNullLanguageModelUsage()`. The route's own comment claiming "an aborted run never reaches `onFinish`" was false. Without a first-wins guard this double-recorded every abort — the second row all-zero-cost but `cost_estimated: false`, silently wrong in the ledger. Any future touch of the chat route's stream lifecycle must preserve the guard in `persistUsage`.
2. **`after()` (from `next/server`) throws synchronously outside a request scope.** It cannot be called from a plain script, a test harness, or any code path that isn't inside an active Next.js request — `recordUsage`'s call site falls back to fire-and-forget specifically for this reason. This is easy to miss when refactoring usage capture into a shared helper.
3. **A `drizzle-kit --custom` migration with no breakpoints runs as ONE statement.** Verified for `0021`'s `DO $$ … $$` block: the migrator only splits SQL files on breakpoint markers, so an unbroken file — even one that reads like multiple statements — executes atomically. Relevant to any future guarded/conditional migration (e.g. `REVOKE … IF EXISTS`-style logic wrapped in `DO`).
4. **npm prunes vitest's nested optional-peer `esbuild` once a package it optionally wants is declared at the top level.** Declaring `@shikijs/themes`/`@shikijs/langs`/`unist-util-visit`/`@types/mdast` (Task 6) triggered a 458-line lockfile dedup removing `node_modules/vitest/node_modules/esbuild@0.28.1` (it satisfied a nested `vite@8.1.5`'s *optional* peer `esbuild ^0.27||^0.28`). Verified by replaying from a clean `npm ci` + the same two installs: the pruned lockfile is byte-identical, so this is deterministic npm behavior, not an artifact of dispatch order. Harmless today (vite's rolldown engine doesn't need it) but worth knowing before blaming a lockfile diff on the wrong commit.
5. **CLAUDE.md is LF; most of the repo (including many docs) is CRLF.** An editing pass that assumes CRLF and rewrites the file wholesale will silently flip every line ending, which shows up as a repo-wide-looking diff on a docs-only change. Preserve LF on every CLAUDE.md edit — verified again this session (`b'# CLAUDE.md\n\n...'`, no `\r`).
6. **`tests/audit-tmp/` is picked up by the Vitest include glob (and isn't gitignored).** Two audit lanes' throwaway probe tests collided there mid-run in the 2026-09-01 audit. If ad-hoc probe tests recur, add the path to `.gitignore` and the Vitest/ESLint excludes before writing into it.
7. **A wrapped Postgres driver error hides the real message on `.cause`, not `.message`.** `drizzle-orm@0.45.2`'s `execute()` wraps the underlying Postgres error; a CHECK-constraint-violation test asserting `.rejects.toThrow(/name/)` against the top-level error will not match — assert against `err.cause.message` instead (Task 2's brief assumed the flatter shape and had to be corrected in review).
8. **`GHSA-2xp9-vwfh-vxw4` (the AVIF Image-Optimization RCE) is reachable in THIS app specifically because `/_next/image` is exempt from the proxy matcher** — the access gate in `src/proxy.ts` never sees that route. This is why the plan's "16.2.11 patch, 16.3.4 is a follow-up" call was overridden mid-session to go straight to 16.3.4: the advisory isn't hypothetical here, it's in the app's actual unauthenticated surface.

## Next session — the release checklist

No feature work remains for Phases 1–2. In order:

1. **Fable whole-branch review** of the full remediation diff (`6d1449a..HEAD` — everything after the audit-doc commit) — the SDD skill's mandated final gate before push. **Not yet run**; this session (Task 10) only ran the mechanical gate and wrote this handoff, per its brief.
2. **Show `git log --oneline origin/master..master`** (23 commits as of `f9ec6af`, 24 once Task 10's commit lands) and get **explicit user approval** before `git push origin master`. Pushing auto-deploys to Vercel.
3. **Confirm CI green** after the push.
4. **Live-smoke** (owed since the 2026-09-01 handoff's release checklist, and now doubly relevant — this session's abort-handling change touches the exact code path):
   - Send a chat message → confirm a `usage_events` row with a plausible `cost_usd` (not 0/NaN unless the model is genuinely the unpriced Gemini sentinel).
   - Start a multi-step tool-calling turn and press **Stop mid-stream** → confirm **exactly one** `usage_events` row is written for that turn (not zero, not two — this is precisely what Task 8's first-wins guard exists to guarantee).
   - Open **Settings → Usage** and confirm it renders spend rather than the "Couldn't load usage" error state.
   - Open a chat's context menu and confirm the per-chat cost line appears.
5. **Version/tag catch-up** — `package.json` is `4.51.0` against four unreleased CHANGELOG entries (`4.52.0`–`4.55.0`); batch a version bump + tag with this push rather than letting it ride along unremarked.
6. **Write and execute Phase 3** as a separate plan (same tier-tag convention as this one). Eight items, each contained and independently testable, from the audit's §4 "With the release" row:
   1. **F1** (the one Critical) — chat switch mid-stream persists the reply into the wrong chat, and mis-scopes its embedding/usage/title/memory-suggest.
   2. **F2** — archived chats are unreachable (`Sidebar.tsx` declares `archivedChats`, never renders it).
   3. **F3** — opening a chat whose last message is a user turn re-saves and re-embeds it (duplicate row + vector).
   4. **X1** — hybrid documents stamp text-layer chunks with the last vision page; `pageRangeFor` seeds wrong from the first anchor.
   5. **X5** — PDF artifacts silently delete curly quotes/apostrophes (wrong Latin-1 code points in `toPdf.ts`'s character classes).
   6. **X4** — `deleteProject` sweeps no Storage objects; `deleteChat` orphans artifacts.
   7. **F6** — the error banner only renders inside the active-chat branch, invisible on Home/project-landing.
   8. **C3** — `resolveRequestedModel` returns the requested alias instead of the matched catalog id, so a dated-only family (e.g. Haiku) is handed the wrong id at the provider call.
7. **Delete the SDD workspace** `.superpowers/sdd/2026-09-11-audit-remediation/` once this release lands — git history becomes the record.

## Follow-ups deliberately deferred (from this session's ledger; none block release)

- **Task 2**: the new CHECK constraints only validate against existing rows at apply time — moot, since `usage_events` had zero rows before `0019` (the table itself was created by `0018` in the same migrate run).
- **Task 3**: the `rowsOf()` test helper is now duplicated a fourth time across migration test files — worth a `tests/helpers` export next time one of those files is touched; `0021`'s journal `breakpoints: true` flag is inert (harmless).
- **Task 5**: a failed PGlite init instance is never closed; a late rejection after a `hookTimeout` kill can emit unhandled-promise noise; the `TABLES` truncation list omits `document_revisions` (harmless — it cascades from `documents`/`projects` deletes).
- **Task 6**: `vite@8.1.5`'s optional `esbuild` peer (`^0.27||^0.28`) has no locally-satisfying version now that the nested copy was pruned (top-level `esbuild` is drizzle-kit's `0.25.12`) — harmless today since vitest runs on the rolldown engine; worth a glance on the next vite/vitest bump.
- **Task 7**: the 9 remaining `npm audit` advisories after the `next` bump are in `@xmldom/xmldom`, `baseline-browser-mapping`, `brace-expansion`, `exceljs`, `image-size`, `nanoid`, `pdfjs-dist`, `pptxgenjs`, `uuid` (an earlier draft of the implementer's report misnamed two of these as sharp/postcss); hoisted `postcss`/`nanoid` lost their `dev: true` lockfile flag (benign — `next` already ships a production `postcss`); `@img/sharp-win32-ia32` has an `engines` quirk but is an optional, never-selected package on this platform.
- **Task 8**: add an inline comment explaining why the undefined-usage check must run *before* the first-wins guard (because `onFinish` never follows a zero-step abort) — cosmetic, not a defect.

## Carried items (from the 2026-09-01 handoff, still open)

- **Shared `@/db` test mock** — still the highest-value test-infra follow-up; unblocks a Vitest render of `SettingsDialog` (both `ChatContextMenu` and `UsageSettingsTab` have the same static-vs-dynamic-import `@/app/actions` hazard; only the former was fixed).
- Tailwind 4.3 visual smoke (live since 2026-07-17, still unverified); PDF preview/regeneration post-CSP-fix; Contract Abstract xlsx flow + 22-field review.
- Audit follow-ups not in Phase 3 (audit §4.4 — queued behind it): `pdfjs-dist` major bump (audit S2), streaming/resumable vision extraction (X2/X3), FTS OR-fusion for natural-language keyword queries (D1), transactional `ingestText` chunk-swap (D2), a WCAG contrast pass on raw Tailwind `-400`/`-500` colors (F5), the doc-drift cleanup in audit §3 not already closed by this session (K3–K6), and the `page.tsx` nine-seam decomposition sketched in the frontend lane's report.
- Roadmap after Phase 3: Code Phase C (Vercel Sandbox — needs security/cost decisions), the iteration-loop brainstorm, Batch D majors (AI SDK v7, eslint 10, TS 7, react-hooks 7.1 rule adoption).

## Quick links

- Audit: `docs/audits/2026-09-01-codebase-audit.md` (+ `.html`) · Plan: `docs/plans/2026-09-11-audit-remediation.md` · Ledger: `.superpowers/sdd/2026-09-11-audit-remediation/progress.md`
- Model routing (new this session, standing doc): `docs/MODEL_ROUTING.md`, referenced from `CLAUDE.md`'s second paragraph
- Cost ledger: `src/lib/usage.ts` (`recordUsage`, `sumUsage`, `usageTokens`), `src/app/api/chat/route.ts` (abort/`after()` wiring), `src/lib/models/pricing.ts`
- Migrations: `drizzle/0018_dapper_morg.sql` (usage_events), `drizzle/0019_usage_events_indexes_checks.sql`, `drizzle/0020_enable_rls_all_tables.sql`, `drizzle/0021_revoke_anon_grants.sql`
- Schema RLS: `src/db/schema.ts` (`.enableRLS()` on every table)
- Test infra fix: `tests/helpers/test-db.ts` (memoized init), `vitest.config.ts` (`testTimeout: 15000`)
- CHANGELOG: `4.55.0` entry (this session) · `4.52.0`–`4.54.0` (still unreleased, carried)
