# Session Handoff — 2026-09-11

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-09-01.md` (kept as the Dynamic Model Registry point-in-time record)._

## TL;DR — where the project is

- **Audit remediation, Phases 1–2, is COMPLETE and RELEASED — Tasks 1–9 done, gate green, pushed and released as `v4.55.0` on 2026-09-13.** Built from `docs/audits/2026-09-01-codebase-audit.md` (the seven-lane audit run at session start on `d278fda`) via `docs/plans/2026-09-11-audit-remediation.md`, subagent-driven with a per-task ledger at `.superpowers/sdd/2026-09-11-audit-remediation/progress.md` (local-only, gitignored).
- **Migrations `0018`–`0021` are APPLIED to production Supabase** (user-approved Task 4, executed mid-session). Verified read-only: `drizzle.__drizzle_migrations` = 22 rows; `usage_events` present with indexes `idx_usage_events_{chat_id,created_at,model_created,project_id}` + pkey and CHECKs `usage_events_purpose_chk` / `usage_events_tokens_nonneg_chk`; row-level security enabled on all 16 public tables (`rls off on: []`); `anon`/`authenticated` table grants = 0; default ACL now `postgres` + `service_role` only.
- **The cold gate is green**: typecheck 0 errors, lint 0 errors / 24 warnings, build clean (24 routes, no warnings), **143 test files / 999 tests passing, 0 failed**. See "Gate numbers" below for the exact commands and the reconciliation against the plan's projected 995.
- **Everything is PUSHED as of 2026-09-13** — `af5b4f8..ccc047f`, **26 commits** (the 24 this doc originally projected, plus `e5e5df3`'s step-usage fix and `ccc047f`'s rulings/RLS-count docs), followed by this release's **2**: `6504189` (the lockfile npm 10 fix) and the version/CHANGELOG stamp. **Vercel production deployed `ccc047f` successfully (READY).** The CI run for `ccc047f` failed at `npm ci`; fixed by `6504189` — CI green after the lockfile fix.
- **Released as `v4.55.0`, tagged 2026-09-13.** `package.json` is `4.55.0`; the four formerly-unreleased CHANGELOG entries (`4.52.0` dep slice, `4.53.0` grounded & cited, `4.54.0` dynamic model registry, `4.55.0` this session's audit remediation) are all stamped `2026-09-13`.
- **Next action is the live smoke (release-checklist item 4, still owed), then Phase 3** — push approval, CI, and the version/tag catch-up are done.

## What shipped this session

Audit: `docs/audits/2026-09-01-codebase-audit.md` (commit `6d1449a`, "docs: add 2026-09-01 codebase audit"). Plan: `docs/plans/2026-09-11-audit-remediation.md`. Ledger (every commit, every review verdict, every ruling): `.superpowers/sdd/2026-09-11-audit-remediation/progress.md` (local-only, gitignored).

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
npm test                    → exit 0, 143 files / 999 tests passed, 0 failed, 78.80s (vitest-reported; 997 at the cold gate, 999 after the final fix wave)
```

The plan projected 995 tests (985 baseline + 4 from Task 2 + 2 from Task 3 + 3 from Task 8's `sumUsage` tests + 1 from Task 8's route test). The cold gate measured **997**; the 2 extra are **Task 8's fix-round tests** — one asserting `sumUsage` returns a fresh object for a single-step run (rather than aliasing `steps[0].usage`), and one asserting `onAbort` with no completed steps records nothing. Neither was in the plan's arithmetic because both came out of Task 8's review, not its brief. The final fix wave then added **2 more** (Item A: `onFinish` falling back to the summed step usage on a null-usage total, and the same event with no completed steps recording nothing), so `npm test` now reports **999 tests, 0 failed, 0 skipped**. Every count is accounted for; nothing was red at any point in the session.

## Findings that will bite whoever picks this up

1. **The AI SDK fires BOTH `onAbort` and `onFinish` on a mid-tool-loop abort.** Verified with the real `streamText` + `MockLanguageModelV3` (`ai@6.0.230`, dist:7226–7280, 7329–7338): after ≥1 completed step, `abort()` calls `onAbort` then `controller.close()`, and the recording transform's `flush` calls `onFinish` anyway (no abort guard) with `createNullLanguageModelUsage()`. The route's own comment claiming "an aborted run never reaches `onFinish`" was false. Without a first-wins guard this double-recorded every abort — the second row all-zero-cost but `cost_estimated: false`, silently wrong in the ledger. Any future touch of the chat route's stream lifecycle must preserve the guard in `persistUsage`.
2. **`after()` (from `next/server`) throws synchronously outside a request scope.** It cannot be called from a plain script, a test harness, or any code path that isn't inside an active Next.js request — `recordUsage`'s call site falls back to fire-and-forget specifically for this reason. This is easy to miss when refactoring usage capture into a shared helper.
3. **A `drizzle-kit --custom` migration with no breakpoints runs as ONE statement.** Verified for `0021`'s `DO $$ … $$` block: the migrator only splits SQL files on breakpoint markers, so an unbroken file — even one that reads like multiple statements — executes atomically. Relevant to any future guarded/conditional migration (e.g. `REVOKE … IF EXISTS`-style logic wrapped in `DO`).
4. **npm prunes vitest's nested optional-peer `esbuild` once a package it optionally wants is declared at the top level.** Declaring `@shikijs/themes`/`@shikijs/langs`/`unist-util-visit`/`@types/mdast` (Task 6) triggered a 458-line lockfile dedup removing `node_modules/vitest/node_modules/esbuild@0.28.1` (it satisfied a nested `vite@8.1.5`'s *optional* peer `esbuild ^0.27||^0.28`). Verified by replaying from a clean `npm ci` + the same two installs: the pruned lockfile is byte-identical, so this is deterministic npm behavior, not an artifact of dispatch order. Assumed harmless at the time (vite's rolldown engine doesn't need it); it was NOT — it broke CI's `npm ci` under npm 10, see finding 9. Also worth knowing before blaming a lockfile diff on the wrong commit.
5. **CLAUDE.md is LF; most of the repo (including many docs) is CRLF.** An editing pass that assumes CRLF and rewrites the file wholesale will silently flip every line ending, which shows up as a repo-wide-looking diff on a docs-only change. Preserve LF on every CLAUDE.md edit — verified again this session (`b'# CLAUDE.md\n\n...'`, no `\r`).
6. **`tests/audit-tmp/` is picked up by the Vitest include glob (and isn't gitignored).** Two audit lanes' throwaway probe tests collided there mid-run in the 2026-09-01 audit. If ad-hoc probe tests recur, add the path to `.gitignore` and the Vitest/ESLint excludes before writing into it.
7. **A wrapped Postgres driver error hides the real message on `.cause`, not `.message`.** `drizzle-orm@0.45.2`'s `execute()` wraps the underlying Postgres error; a CHECK-constraint-violation test asserting `.rejects.toThrow(/name/)` against the top-level error will not match — assert against `err.cause.message` instead (Task 2's brief assumed the flatter shape and had to be corrected in review).
8. **`GHSA-2xp9-vwfh-vxw4` (the AVIF Image-Optimization RCE) is reachable in THIS app specifically because `/_next/image` is exempt from the proxy matcher** — the access gate in `src/proxy.ts` never sees that route. This is why the plan's "16.2.11 patch, 16.3.4 is a follow-up" call was overridden mid-session to go straight to 16.3.4: the advisory isn't hypothetical here, it's in the app's actual unauthenticated surface.
9. **CI installs with npm 10; local is npm 11 — a lockfile npm 11 accepts can still fail `npm ci` on CI.** npm 11 prunes a nested OPTIONAL peer it considers redundant (finding 4) and is happy to install without it; npm 10 resolves that same optional peer and REFUSES the lock for omitting it. So the first push of this branch died in CI at `npm ci` with "Missing: esbuild@0.28.2" (+27 `@esbuild/*` lines) while every local gate was green. Fixed in `6504189` by writing `node_modules/vitest/node_modules/esbuild` and its 26 `@esbuild/*` platform entries back into the lock at `0.28.1`, each `"optional": true` — the same recipe as `91d64c0`/`7221c14`, which makes this the **third** time this split has bitten. **Validate every lockfile change with `npx npm@10 ci --dry-run` AND `npm ci --dry-run` before pushing.** Note `npm@10 install --package-lock-only` is NOT a safe regenerator here: it also strips the npm-11-only `libc` discriminator from 49 linux platform packages (sharp, next/swc, napi-rs/canvas, lightningcss, oxide, rolldown, unrs) and adds unrelated wasm32-wasi entries.

## Next session — the release checklist

No feature work remains for Phases 1–2. In order:

1. **Fable whole-branch review** of the full remediation diff (`6d1449a..HEAD` — everything after the audit-doc commit) — the SDD skill's mandated final gate before push. **Not yet run**; this session (Task 10) only ran the mechanical gate and wrote this handoff, per its brief.
2. **DONE** — pushed 2026-09-13: `af5b4f8..ccc047f` (26 commits), then `6504189` + the release commit. Vercel production deployment READY.
3. **Confirm CI green** after the push — the `ccc047f` run FAILED at `npm ci` (the npm 10/11 lockfile split, finding 9); fixed by `6504189`, which was validated locally under both npm 10 and npm 11. Re-confirm the run goes green once it lands.
4. **Live-smoke** (owed since the 2026-09-01 handoff's release checklist, and now doubly relevant — this session's abort-handling change touches the exact code path):
   - Send a chat message → confirm a `usage_events` row with a plausible `cost_usd` (not 0/NaN unless the model is genuinely the unpriced Gemini sentinel).
   - Start a multi-step tool-calling turn and press **Stop mid-stream** → confirm **exactly one** `usage_events` row is written for that turn (not zero, not two — this is precisely what Task 8's first-wins guard exists to guarantee).
   - Open **Settings → Usage** and confirm it renders spend rather than the "Couldn't load usage" error state.
   - Open a chat's context menu and confirm the per-chat cost line appears.
5. **DONE** — `package.json` bumped to `4.55.0`, the four CHANGELOG entries stamped `2026-09-13`, released as `v4.55.0` (tagged 2026-09-13).
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
- **Task 6**: `vite@8.1.5`'s optional `esbuild` peer (`^0.27||^0.28`) had no locally-satisfying version once the nested copy was pruned (top-level `esbuild` is drizzle-kit's `0.25.12`) — **this was NOT harmless: it broke CI's `npm ci` under npm 10** (finding 9), fixed in `6504189` by restoring the nested copy at `0.28.1`. Still worth a glance on the next vite/vitest bump.
- **Task 7**: the 9 remaining `npm audit` advisories after the `next` bump are in `@xmldom/xmldom`, `baseline-browser-mapping`, `brace-expansion`, `exceljs`, `image-size`, `nanoid`, `pdfjs-dist`, `pptxgenjs`, `uuid` (an earlier draft of the implementer's report misnamed two of these as sharp/postcss); hoisted `postcss`/`nanoid` lost their `dev: true` lockfile flag (benign — `next` already ships a production `postcss`); `@img/sharp-win32-ia32` has an `engines` quirk but is an optional, never-selected package on this platform.
- **Task 8**: add an inline comment explaining why the undefined-usage check must run *before* the first-wins guard (because `onFinish` never follows a zero-step abort) — **DONE in `e5e5df3`**, which landed the comment alongside that commit's later-step-throw usage fix. Was cosmetic, not a defect.

## Carried items (from the 2026-09-01 handoff, still open)

- **Shared `@/db` test mock** — still the highest-value test-infra follow-up; unblocks a Vitest render of `SettingsDialog` (both `ChatContextMenu` and `UsageSettingsTab` have the same static-vs-dynamic-import `@/app/actions` hazard; only the former was fixed).
- Tailwind 4.3 visual smoke (live since 2026-07-17, still unverified); PDF preview/regeneration post-CSP-fix; Contract Abstract xlsx flow + 22-field review.
- Audit follow-ups not in Phase 3 (audit §4.4 — queued behind it): `pdfjs-dist` major bump (audit S2), streaming/resumable vision extraction (X2/X3), FTS OR-fusion for natural-language keyword queries (D1), transactional `ingestText` chunk-swap (D2), a WCAG contrast pass on raw Tailwind `-400`/`-500` colors (F5), the doc-drift cleanup in audit §3 not already closed by this session (K3–K6), and the `page.tsx` nine-seam decomposition sketched in the frontend lane's report.
- Roadmap after Phase 3: Code Phase C (Vercel Sandbox — needs security/cost decisions), the iteration-loop brainstorm, Batch D majors (AI SDK v7, eslint 10, TS 7, react-hooks 7.1 rule adoption).

## Rulings made by the controller

Decisions taken on the user's behalf during execution, copied verbatim from the execution ledger so they survive the workspace's deletion. Each ends with what it costs if wrong.

- Ruling: execute on `master` directly, no worktree — the user's global CLAUDE.md says "commit to main locally; do not push without explicit approval", the repo's own history works this way, and a worktree under OneDrive would need its own node_modules. Cost if wrong: commits land on master before the whole-branch review; mitigated by local-only commits and the push gate in Task 10.
- Ruling: run order T1 → T2 → T3 → T5 → T6 → T7 → T8, THEN stop for Task 4 (user-gated production migrate), then T9 → T10. Phase 2 tasks do not depend on the live DB; batching the one irreversible step to a single checkpoint costs the user one interruption instead of two. Cost if wrong: none to code — T1 still precedes T4, which is the ordering the plan cares about.
- Ruling: the plan's per-task tier tags express domain criticality; SDD model selection follows the work's shape — transcription tasks whose brief carries the complete code (T1, T2, T3, T5, T6, T7) get a Sonnet implementer and a Sonnet reviewer; T8 (chat-route stream lifecycle, judgment + integration) gets an Opus implementer and a Fable reviewer; the final whole-branch review runs on Fable. Cost if wrong: a subtle defect slips a mid-tier review — mitigated by tests that pin exact values and the Fable final review.
- Ruling: the plan-mandated finding is REAL — the plan's replacement text kept the old title/assertion shape and lost the test's discriminating power. Fix in Task 1 (same file): restore discrimination by asserting the registry reprices the seed through a pricing OVERRIDE (a value that differs from both EXACT_PRICING and the seed field), and retitle the test to say what it now proves. Cost if wrong: a few extra test lines in T1; no code-path change.
- Ruling: the brief's error-shape assumption was a plan defect; the adapted assertion is accepted provided the task reviewer confirms it still proves the constraint fires (the brief's intent). Cost if wrong: a test that passes for the wrong reason — the reviewer is asked to judge exactly that.
- Ruling (user instruction 2026-09-11, "use model routing, do not only use Fable for all tasks"): routing revised — T8 implementer Opus, T8 reviewer Opus (was Fable); T9/T10 docs on Sonnet with Sonnet review; ONLY the final whole-branch review stays on Fable (SDD skill mandate). Wrote docs/MODEL_ROUTING.md (untracked for now) as the standing routing doc; its CLAUDE.md pointer + commit are deferred until Task 3 lands because T3's implementer is editing and committing CLAUDE.md. Cost if wrong: an Opus review of the chat-route change misses something a Fable review would catch — the Fable final review still sees the whole branch.
- Ruling: the stale line is real and dangerous (audit finding 13 shape); Task 4 rewrites it post-apply but T4 is deferred, so the interim truth ("0018–0021 authored, pending apply") lands now as T3 fix round 1 rather than waiting. Cost if wrong: a one-line docs commit T4 will overwrite anyway.
- Ruling: the quoted sentence ("Step 1 may or may not reproduce on your run — record what you saw either way; the fix is required regardless") is verbatim from the controller's DISPATCH PROMPT, which the reviewer cannot see — a misattribution, not a fabrication. No code or report change required. Cost if wrong: none to the checkout.
- Ruling: run the brief's Step 4 recovery deterministically — restore base package.json/lock, `npm ci`, redo the two installs, compare. If npm reproduces the same prune from a clean tree, accept the tree (it is what any fresh install yields) and correct the report; if the clean install keeps the nested esbuild, commit the smaller lockfile. Cost if wrong: ~5 minutes of npm; no code risk either way.
- Ruling: the plan's "patch-level only, 16.3.4 is a follow-up" choice is overridden — GHSA-2xp9 is reachable in prod because `/_next/image` is exempt from the proxy matcher (audit §2.1). Bump to next@16.3.4 + eslint-config-next@16.3.4 as Task 7 fix round 1 with the full cold gate re-run; `next listed: false` becomes the acceptance check. Cost if wrong: a minor-version behavior change — covered by build + 991 tests locally and CI e2e after push.
- Ruling: fix #1 (first-wins guard in persistUsage + corrected comment); ALSO adopt #2 (return early when usage is undefined — a $0/exact row for unknown tokens reads as "free", which the ledger design forbids), #3 (seed the reduce with an all-undefined usage so single-step results are normalized, not aliased), #4 (test: invoke onAbort then onFinish on the captured options → recordUsage exactly once; and onAbort with steps: [] → recordUsage not called). Cost if wrong: an abort with zero completed steps leaves no row at all — accepted, the tokens are unknowable from the SDK. Plan text (brief comment + unconditional persist) overridden by this ruling.
- Ruling: Task 9's CHANGELOG text is amended by execution facts — `next` line reads 16.2.10 → 16.3.4 and names GHSA-p293-qw3h-jr36 + GHSA-2xp9-vwfh-vxw4 (fixed ≥16.3.3) alongside GHSA-6gpp-xcg3-4w24; the usage-capture bullet adds the first-wins guard + skip-when-unknown (SDK fires onAbort AND onFinish after ≥1 step). Cost if wrong: none — docs must match what shipped.
- Ruling: correctness concern → fix BEFORE review (SDD: address correctness/scope concerns first). Controller grep found exactly one live stale mention (CLAUDE.md:229) plus the unreleased 4.54.0 CHANGELOG intro instructing "must be applied BEFORE deploy" — both get a dated done-note in the same fix commit. Cost if wrong: none — status must match the live DB (audit finding 13).
- Ruling: ONE fix wave — (a) Important #1: onFinish falls back to sumUsage(steps) when totalUsage carries no token counts, with a test; fold in the deferred comment; (b) Minor #4 wording; (c) Minor #5: append the full `Ruling:` list to the tracked handoff as its own section; (d) Minor #6: correct the audit doc's "12 of 15" to "13 of 15" (the CHANGELOG's 13 is right); (e) Minors #2/#3 ride. Cost if wrong: one more small commit before the push.
- Ruling: `totalUsage?.inputTokens` optional chaining kept because a pre-existing test calls onFinish({ text }) with no usage object; real SDK events always carry totalUsage, so behavior is identical. Cost if wrong: none.

## Quick links

- Audit: `docs/audits/2026-09-01-codebase-audit.md` (+ `.html`) · Plan: `docs/plans/2026-09-11-audit-remediation.md` · Ledger: `.superpowers/sdd/2026-09-11-audit-remediation/progress.md` (local-only, gitignored)
- Model routing (new this session, standing doc): `docs/MODEL_ROUTING.md`, referenced from `CLAUDE.md`'s second paragraph
- Cost ledger: `src/lib/usage.ts` (`recordUsage`, `sumUsage`, `usageTokens`), `src/app/api/chat/route.ts` (abort/`after()` wiring), `src/lib/models/pricing.ts`
- Migrations: `drizzle/0018_dapper_morg.sql` (usage_events), `drizzle/0019_usage_events_indexes_checks.sql`, `drizzle/0020_enable_rls_all_tables.sql`, `drizzle/0021_revoke_anon_grants.sql`
- Schema RLS: `src/db/schema.ts` (`.enableRLS()` on every table)
- Test infra fix: `tests/helpers/test-db.ts` (memoized init), `vitest.config.ts` (`testTimeout: 15000`)
- CHANGELOG: `4.55.0` entry (this session) · `4.52.0`–`4.54.0` (carried) — all four stamped `2026-09-13` and shipped as `v4.55.0`
