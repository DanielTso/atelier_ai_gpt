# Session Handoff — 2026-09-01

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-08-24.md` (kept as the T1–T8 point-in-time record)._

## TL;DR — where the project is

- **Dynamic Model Registry + Cost Visibility is COMPLETE — all 12 tasks, gate green, nothing pushed.** T1–T8 shipped to prod in the previous session (`c10d490..1a2c35e`, CI green, Vercel deployed). **T9–T12 plus a final fix wave are LOCAL ONLY — 5 commits ahead of `origin/master`.** **Opus 5 appears in the picker with zero code change** — the point of the feature, verified against the live Anthropic API.
- **Only migration `0018` is pending.** `0017` (Grounded & Cited Answers) **is already applied** — verified read-only against the live DB this session: `drizzle.__drizzle_migrations` holds 18 rows (`0000`–`0017`), `document_chunks.page_start`/`page_end` exist, documents are 5 ready / 0 error. `0018` (`usage_events`) is authored and **NOT applied**.
- **985 tests / 141 files green** (typecheck 0, lint 0 errors/24 warnings, cold build clean).
- **`package.json` is still `4.51.0`**; CHANGELOG carries **three unreleased entries** (`4.52.0` dep slice, `4.53.0` grounded & cited, `4.54.0` this feature) and no tags exist past `v4.51.0`.
- **Next action is the release checklist below, not more feature work.** Migrate → push → live-smoke, all user-gated.

## What shipped this session

Spec `docs/specs/2026-07-21-dynamic-model-registry-design.md` · plan `docs/plans/2026-07-21-dynamic-model-registry.md` · per-task ledger `.superpowers/sdd/2026-07-21-dynamic-model-registry/progress.md` (T9–T12; T1–T8 in `.superpowers/sdd/progress.md`, search "Dynamic Model Registry").

Built subagent-driven: one implementer per task, an independent review after each, fix rounds where needed, then a whole-branch review. Three tasks needed fix rounds; all closed.

| Commit | What |
|---|---|
| `7f6ca74` | **T9** persona tiers (`flagship`/`opus`/`sonnet`/`haiku`); Contract Abstract stays pinned exact (fix round amended in) |
| `41d3c52` | **T10** usage capture — migration `0018` (`usage_events`), `recordUsage()` at six sites, the cache-token accounting fix |
| `e2e8b18` | **T11** spend views — Settings → Usage tab (monthly by model), per-chat cost in the chat menu (fix round amended in) |
| `84c9cbd` | **T12** docs — CHANGELOG `4.54.0`, `CLAUDE.md`, `PERSONAS.md`, handoff, one comment-only cleanup in `actions.ts` |
| `1d72d0e` | **Final-review fix wave** — migration-status corrections, stale Opus 4.8 → Opus 5 in PERSONAS, dated-id label strip, `monthsBack` clamp |

All five are local only — not on `origin/master`.

## 🔑 Findings that will bite whoever picks this up

1. **Not every model has a bare alias.** The live catalog returns `claude-haiku-4-5-20251001` (dated) — there is **no** `claude-haiku-4-5`. Personas/seed/settings use the alias. Without alias indexing every Haiku request silently fell back to Opus 5 — a **5× cost jump on the cheap tier**. Any lookup by model id must go through `registry.byId`, which indexes both forms.
2. **`streamText` is synchronous.** Provider errors never reach the route's `try/catch`; they go to `onError`, and `toUIMessageStreamResponse`'s default `onError` masks them as "An error occurred." Provider error handling belongs in `onError`.
3. **The capabilities tree shape is verified, not assumed:** `capabilities.effort.{low,medium,high,xhigh,max}.supported`, `capabilities.thinking.types.adaptive.supported`, `capabilities.image_input.supported`, `capabilities.structured_outputs.supported`.
4. **Gate on the effort LEVEL, not just `supportsEffort`.** `selectedEffort` is model-independent React state that never resets on model switch, so `xhigh` can follow you onto a model that 400s on it. `providers.ts` checks `caps.effortLevels.includes(effort)`; the pill clamps the display.
5. **`.env.local` has a UTF-8 BOM on line 1.** A naive `grep` for a key anchored at line start silently fails; strip the BOM first.
6. **Pricing is not in the API.** Order: DB override (`settings` key `model-pricing-overrides`) → exact table → family tier (`estimated: true`). **Sonnet 5's introductory $2/$10 rate expired 2026-08-31** — it should now be $3/$15. Verify `EXACT_PRICING` reflects that; the override key exists to correct it without a deploy.
7. **Persona tiers resolve client-side, on purpose.** `resolveTier()` is server-only (reads API keys) and can never be imported into `usePersonas.ts`, a `'use client'` hook. `resolvePersonaModel()`/`resolvePersonaModelLabel()` resolve against the `models` list `page.tsx` already fetches. `tierFamily()` is the single shared mapping (`'flagship'` → `fable`) both sides call, so semantics can't drift.
8. **⚠️ The AI SDK's `usage.inputTokens` is INCLUSIVE, not fresh-only** (verified by reading installed `@ai-sdk/anthropic@3.0.98`, `dist/index.mjs:1869-1875` — public docs mix SDK versions and give the wrong answer here). Anthropic's raw API reports fresh / cache-read / cache-write as mutually exclusive counts; the SDK sums them. The spec's own sketched formula would have **double-counted every cached token**, worst on exactly the long-context project chats this app targets. `usage.inputTokenDetails.noCacheTokens` is the correct fresh count; `usage.cachedInputTokens` is deprecated in this version. Resolved *before* T10 was implemented, so every row shipped correct. **Re-verify this shape on the next AI SDK bump — the whole cost ledger rests on it.**
9. **The unpriced sentinel is easy to misrender as "free."** A `gemini-3.5-flash` housekeeping row writes `cost_usd=0, cost_estimated=true` — the *same tuple* a genuinely free Claude generation would produce. Any new spend view must route through `isUnpricedUsage()` (`src/lib/utils.ts`) and render "unpriced", never "$0.00".
10. **`project_id` is NULL on `generate-title` / `classify` usage rows** — those routes never load the chat. A per-project spend view must join through `chat_id`, not filter on `project_id`, or it silently drops them.
11. **`ChatContextMenu`'s `@/app/actions` import is dynamic; `UsageSettingsTab.tsx`'s is static — same hazard, only one triggered.** A static `'use server'` import resolves to the literal module under Vitest (no RSC transform) and `@/db` throws at import time when `DATABASE_URL` is unset; this broke three unrelated jsdom sidebar suites before `ChatContextMenu` went dynamic. `UsageSettingsTab` is latent only because no test currently renders `SettingsDialog`. **A shared `@/db` test mock is the real fix and is still a follow-up.**
12. **Before `0018` is applied, Settings → Usage shows its "Couldn't load usage" error state on every open.** That is by design — the tab distinguishes a failed query from "no spend yet" precisely because of this window. Expected until the release checklist runs; not a bug to chase.
13. **📌 Migration status in docs must be updated when a migration is APPLIED, not when it is authored.** `CLAUDE.md` said "`0017` authored, pending apply" long after `0017` had been applied. That one stale line misled this session's whole-branch reviewer into a confident, well-argued false alarm that production document ingest and retrieval were broken — it took a live read-only DB check to disprove. The cost of a stale status line is not mild confusion; it is a fix aimed in the wrong direction.

## ⏳ Next session — the release checklist (everything else is done)

No feature work remains for this spec.

1. **Apply migration `0018`**: `DIRECT_URL=... npx drizzle-kit migrate`. **`0017` is already applied — do not expect it in the output.** Migrate BEFORE pushing: deployed Drizzle code emits explicit column lists, so an unmigrated DB breaks whole tables' queries app-wide, not just the new feature.
2. **Push the 5 local commits** (`7f6ca74..1d72d0e`) to `origin/master`. Confirm CI green. Auto-deploys to Vercel.
3. **Live-smoke**: send a chat message → confirm a `usage_events` row with a plausible `cost_usd` (not 0/NaN unless the model is genuinely the unpriced sentinel) → open Settings → Usage and confirm it renders spend rather than the error state → open a chat's context menu and confirm the cost line appears.
4. **Version/tag catch-up** — three releases deep; see Carried items. Batch it with this push or do it right after, but don't let it ride along unremarked.
5. **Delete the SDD workspace** (`.superpowers/sdd/2026-07-21-dynamic-model-registry/`) once the release lands — git history becomes the record. Kept until then because it holds the decision trail for work not yet reviewed by a human.

## Follow-ups deliberately deferred (none block release)

- **Shared `@/db` test mock** (see finding 11) — highest value; unblocks testing `SettingsDialog`.
- `estimateCost`'s zero-clamp doesn't force `costEstimated: true`. Verified unreachable today (overrides are `Number.isFinite`-validated, token counts clamped ≥ 0); defense-in-depth only.
- `recordUsage` computes `usageTokens` twice, to keep the pinned `estimateCost` signature. Pure arithmetic.
- `resolveTierRow`'s warn is not de-duplicated and fires once per persona per render on a genuine catalog anomaly. Noisy-but-visible beats the silent 5× failure it replaced.
- `CLAUDE.md` has a count mismatch: "~6 files by hand" while naming four. One-line fix.
- `docs/PERSONAS.md`'s "snapshot as of this doc's last edit" framing carries no edit-date stamp, so a reader cannot gauge staleness.

## Carried items (unchanged, user-side)

- **Version/tag housekeeping is three releases deep**: `package.json` is `4.51.0`; `4.52.0` (dep slice), `4.53.0` (grounded & cited) and `4.54.0` (this feature) are all unreleased in CHANGELOG with no tags past `v4.51.0`. Worth one combined bump + tag after the push and smoke.
- Tailwind 4.3 visual smoke (live since 07-17, still unverified); PDF preview/regeneration post-CSP-fix; Contract Abstract xlsx flow + 22-field review.
- Roadmap after this feature: Code Phase C (Vercel Sandbox — needs security/cost decisions), the iteration-loop brainstorm, Batch D majors (AI SDK v7, eslint 10, TS 7, react-hooks 7.1 rule adoption).

## Quick links

- Spec/plan: `docs/{specs,plans}/2026-07-21-dynamic-model-registry*` · SDD ledgers (per-task record incl. every review finding and controller ruling): `.superpowers/sdd/2026-07-21-dynamic-model-registry/progress.md` (T9–T12) and `.superpowers/sdd/progress.md` (T1–T8)
- Registry: `src/lib/models/{types,seed,pricing,curate,fetch,registry}.ts`
- Usage capture: `src/lib/usage.ts`, `src/db/schema.ts` (`usageEvents`), migration `drizzle/0018_dapper_morg.sql`
- Spend views: `src/components/settings/UsageSettingsTab.tsx`, `src/components/chat/ChatContextMenu.tsx`, `getMonthlyUsageByModel` / `getChatCost` in `src/app/actions.ts`
- Personas: `src/hooks/usePersonas.ts`, `docs/PERSONAS.md`
