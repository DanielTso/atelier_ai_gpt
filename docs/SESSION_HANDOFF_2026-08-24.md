# Session Handoff — 2026-08-24

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-21.md`._

## TL;DR — where the project is

- **Dynamic Model Registry + Cost Visibility is COMPLETE — all 12 tasks done, gate green, nothing pushed.** T1–T8 shipped to prod earlier this session (`c10d490..1a2c35e`, CI green, Vercel deployed). **T9–T12 are LOCAL ONLY** — 4 commits ahead of `origin/master`. **Opus 5 appeared in the picker with zero code change** — the whole point of the feature, verified against the live Anthropic API.
- **Nothing is migrated or released.** Migrations `0017` (Grounded & Cited Answers, previous feature) and `0018` (this feature's `usage_events` table) are both authored and **NOT applied** to Supabase. `package.json` is still `4.51.0`; CHANGELOG carries **three unreleased entries** (`4.52.0` dep slice, `4.53.0` grounded & cited, `4.54.0` this feature) and no tags exist past `v4.51.0`.
- **981 tests / 141 files green** at the T12 commit (typecheck 0, lint 0/24, cold build clean).
- **Next action for whoever picks this up is the release checklist below, not more feature work** — the feature is done; only migrate → push → live-smoke remain, and all three are user-gated.

## What shipped this session (all local except T1-T8)

Spec `docs/specs/2026-07-21-dynamic-model-registry-design.md` · plan `docs/plans/2026-07-21-dynamic-model-registry.md` · per-task ledger `.superpowers/sdd/2026-07-21-dynamic-model-registry/progress.md` (T9-T12; T1-T8 in `.superpowers/sdd/progress.md`).

The model list used to be hardcoded in two places that had to agree, plus 14 personas, the chat-route default, a provider special-case, and the effort pill — every Anthropic release meant editing ~6 files. Now it's one live registry:

| Commit | What |
|---|---|
| `b97ca03` | Spec + plan (locked decisions from user Q&A) |
| `5520a0d` `9d7a98f` | T1 registry primitives — curation, pricing, catalog fetch (+ fix wave) |
| `b3c6a01` `9a78001` `5a26515` | T2 registry assembly, TTL cache, resolvers (+ 2 fix waves) |
| `eb4f490` | T3 one `Effort` union (was declared twice) with `xhigh`; capability-bearing `Model` |
| `51a0ff3` `20fe326` `35320c3` | T4/T5 validation swap + capability-derived providers (+ fix wave) |
| `42cf530` `a91f8c4` | T6/T7 `/api/models` registry adapter + project-default fix |
| `1a2c35e` | T8 price badges, provider grouping, capability-driven effort levels |
| **`7f6ca74`** | **T9** persona tiers (`flagship`/`opus`/`sonnet`/`haiku`), Contract Abstract pinned exact (+ fix wave, amended into this commit) |
| **`41d3c52`** | **T10** usage capture — migration `0018` (`usage_events`), `recordUsage()` at six capture sites, the cache-token accounting fix |
| **`e2e8b18`** | **T11** spend views — Settings → Usage tab (monthly by model), per-chat cost in the chat menu (+ fix wave, amended into this commit) |
| *(this commit)* | **T12** docs + final gate — CHANGELOG `4.54.0`, `CLAUDE.md`, `PERSONAS.md`, this handoff, one comment-only cleanup in `actions.ts` |

**Bold rows above (T9–T12) are local only** — not on `origin/master`.

Real defects fixed along the way: a stale `projects.default_model` used to 400 the chat with no recovery; the effort pill was missing `xhigh` (unreachable despite Opus 5/Sonnet 5/Fable supporting it); provider 400s were masked as "An error occurred."; and — the big one this half — **the AI SDK's `usage.inputTokens` on Anthropic is the inclusive sum of fresh + cached input, not fresh alone**, which would have double-billed every cached token had it shipped as originally sketched in the spec (caught and fixed *before* T10 landed, not after — see finding 8 below).

## 🔑 Findings that will bite whoever picks this up

1. **Not every model has a bare alias.** The live catalog returns `claude-haiku-4-5-20251001` (dated) — there is **no** `claude-haiku-4-5` entry. Our personas/seed/settings all use the alias. Without the alias-indexing fix (`5a26515`) every Haiku request silently fell back to Opus 5 — a **5× cost jump on the cheap tier**. Any new code that looks a model up by id must go through `registry.byId`, which indexes both forms.
2. **`streamText` is synchronous.** Provider errors never reach the route's `try/catch`; they go to `onError`, and `toUIMessageStreamResponse`'s default `onError` masks them as "An error occurred." Error handling for provider failures belongs in `onError`.
3. **The capabilities tree shape is verified, not assumed:** `capabilities.effort.{low,medium,high,xhigh,max}.supported`, `capabilities.thinking.types.adaptive.supported`, `capabilities.image_input.supported`, `capabilities.structured_outputs.supported`. Confirmed with a live call on 2026-07-21.
4. **Gate on the effort LEVEL, not just `supportsEffort`.** `selectedEffort` is model-independent React state that never resets on model switch, so `xhigh` can follow you onto a model that 400s on it. `providers.ts` checks `caps.effortLevels.includes(effort)`; the pill clamps the display.
5. **`.env.local` has a UTF-8 BOM on line 1**, before `ANTHROPIC_API_KEY`. `grep '^ANTHROPIC_API_KEY='` silently fails; strip the BOM first (`sed '1s/^\xEF\xBB\xBF//'`).
6. **Pricing is not in the API.** Resolution order is DB override (`settings` key `model-pricing-overrides`) → exact table → family tier (`estimated: true`). Sonnet 5 is on **introductory $2/$10 through 2026-08-31**, then reverts to $3/$15 — the override key exists to correct that without a deploy.
7. **Persona tiers resolve client-side, on purpose.** `resolveTier()` (`src/lib/models/registry.ts`) is server-only (reads API keys via `@/lib/settings`) and can never be imported into `usePersonas.ts`, a `'use client'` hook. `resolvePersonaModel()`/`resolvePersonaModelLabel()` resolve against the `models` list `page.tsx` already fetches from `GET /api/models` instead — `tierFamily()` is the single shared mapping (`'flagship'` → `fable` family) both resolvers call, so the semantics can't drift between the client and server copies.
8. **⚠️ The AI SDK's `usage.inputTokens` is INCLUSIVE, not fresh-only** (verified by reading the installed `@ai-sdk/anthropic@3.0.98` source, `dist/index.mjs:1869-1875` — not public docs, which mix SDK versions and give the wrong answer here). Anthropic's raw API reports fresh/cache-read/cache-write as mutually exclusive counts, but the SDK sums them into one `inputTokens` figure. A naive `inputTokens × rate + cacheRead × 0.1 × rate + cacheWrite × 1.25 × rate` formula (the spec's own sketch) **double-counts every cached token** — worst on exactly the long-context project chats this app is built for. `usage.inputTokenDetails.noCacheTokens` is the correct fresh count; `usage.cachedInputTokens` is deprecated in this SDK version and must not be read. This was resolved *before* T10 was implemented (see `.superpowers/sdd/2026-07-21-dynamic-model-registry/progress.md`, "RESOLVED AHEAD OF T10"), so every `usage_events` row shipped correct from the start — but the next SDK bump should re-verify this shape hasn't changed.
9. **The unpriced sentinel is easy to misrender as "free."** A `gemini-3.5-flash` housekeeping row (title/summarize/classify/memory-suggest) writes `cost_usd=0, cost_estimated=true` — the *same tuple* a genuinely free Claude generation could produce. Any new spend view must route through `isUnpricedUsage()` (`src/lib/utils.ts`) and render that case as "unpriced," never "$0.00."
10. **`project_id` is NULL on `generate-title`/`classify` usage rows** — those routes never load the chat, so they have no project id to stamp. A per-project spend view must join through `chat_id`, not filter on `project_id` directly, or it silently drops those rows.
11. **`ChatContextMenu`'s `@/app/actions` import is dynamic, `UsageSettingsTab.tsx`'s is static — same latent hazard, only one is triggered.** A static `'use server'` import resolves to the literal module under Vitest (no RSC transform), and `@/db` throws at import time when `DATABASE_URL` is unset — this broke three unrelated jsdom sidebar suites before `ChatContextMenu` switched to a dynamic import. `UsageSettingsTab.tsx` carries the identical risk but is only latent because no test currently renders `SettingsDialog`. **A shared `@/db` test mock is the real fix and is still a follow-up**, not built this session.
12. **Migration `0018` is authored but NOT applied.** Today, in production, opening Settings → Usage throws `relation "usage_events" does not exist` on every load — the tab's error state (distinct from "no spend yet") is exactly what fires. This is expected until the release checklist below runs, not a bug to chase.

## ⏳ Next session — the release checklist (everything else is done)

There is no more feature work queued for this spec. Pick up here:

1. **Apply migrations `0017` AND `0018` together**: `DIRECT_URL=... npx drizzle-kit migrate`. Do this BEFORE anything below — the standing rule (deployed Drizzle code emits explicit column lists; an unmigrated DB breaks whole tables app-wide, not just the new feature) is in full effect once T10's migration lands locally.
2. **Push T9–T12** (`7f6ca74..` through the T12 commit) to `origin/master`. Confirm CI green.
3. **Live-smoke**: send a chat message, then confirm a `usage_events` row exists with a plausible `cost_usd` (not 0/NaN unless the model is genuinely the unpriced sentinel). Open Settings → Usage and confirm it renders spend, not the error state. Open a chat's context menu and confirm a cost line appears.
4. **Re-confirm the zero-touch premise still holds** — it's a standing behavior claim (any new Anthropic release should appear automatically), not a one-time fact; worth a periodic spot-check whenever Anthropic ships something new, not just today.
5. **Version/tag catch-up is separate and still pending** (see below) — batch it with this push or do it right after; either order is fine, but don't let it silently ride along unremarked.

## Carried items (unchanged, user-side)

- **Version/tag housekeeping is now three releases deep**: `package.json` is 4.51.0; `4.52.0` (dep slice), `4.53.0` (grounded & cited), and `4.54.0` (this feature) are all unreleased in CHANGELOG with no tags past `v4.51.0`. Worth one combined catch-up bump + tag once T9-T12 are pushed and live-smoked.
- Tailwind 4.3 visual smoke (live since 07-17, still unverified); PDF preview/regeneration post-CSP-fix; Contract Abstract xlsx flow + 22-field review.
- Roadmap after this feature: Code Phase C (Vercel Sandbox — needs security/cost decisions), the iteration-loop brainstorm, Batch D majors (AI SDK v7, eslint 10, TS 7, react-hooks 7.1 rule adoption).

## Quick links

- Spec/plan: `docs/{specs,plans}/2026-07-21-dynamic-model-registry*` · SDD ledgers (per-task record incl. every review finding): `.superpowers/sdd/2026-07-21-dynamic-model-registry/progress.md` (T9-T12) and `.superpowers/sdd/progress.md` (T1-T8, search "Dynamic Model Registry")
- Registry code: `src/lib/models/{types,seed,pricing,curate,fetch,registry}.ts` · usage capture: `src/lib/usage.ts`, `src/db/schema.ts` (`usageEvents`) · spend views: `src/components/settings/UsageSettingsTab.tsx`, `src/components/chat/ChatContextMenu.tsx`, `getMonthlyUsageByModel`/`getChatCost` in `src/app/actions.ts` · personas: `src/hooks/usePersonas.ts`, `docs/PERSONAS.md`
