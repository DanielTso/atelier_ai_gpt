# Session Handoff — 2026-08-24

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-21.md`._

## TL;DR — where the project is

- **Dynamic Model Registry is 8 of 12 tasks done and SHIPPED to prod.** Pushed `c10d490..1a2c35e` (13 commits), CI run 32789783764 **green**, Vercel deployed, prod `/login` 200. **Opus 5 now appears in the picker with no code change** — the whole point of the feature, verified against the live Anthropic API.
- **Remaining: T9 (persona tiers), T10 (usage capture + migration `0018`), T11 (spend views), T12 (docs).** T10 introduces this feature's first migration — from there the standing **migrate-before-deploy** rule is back in play.
- 913 tests / 136 files green. `package.json` still **4.51.0**; CHANGELOG carries **three unreleased** entries (4.52.0 dep slice, 4.53.0 grounded & cited, 4.54.0 registry in progress) and no tags exist past `v4.51.0`.

## What shipped this session (all live)

Spec `docs/specs/2026-07-21-dynamic-model-registry-design.md` · plan `docs/plans/2026-07-21-dynamic-model-registry.md`.

The model list used to be hardcoded in two places that had to agree, plus 13 personas, the chat-route default, a provider special-case, and the effort pill — every Anthropic release meant editing ~6 files. Now:

| Commit | What |
|---|---|
| `b97ca03` | Spec + plan (locked decisions from user Q&A) |
| `5520a0d` `9d7a98f` | T1 registry primitives — curation, pricing, catalog fetch (+ fix wave) |
| `b3c6a01` `9a78001` `5a26515` | T2 registry assembly, TTL cache, resolvers (+ 2 fix waves) |
| `eb4f490` | T3 one `Effort` union (was declared twice) with `xhigh`; capability-bearing `Model` |
| `51a0ff3` `20fe326` `35320c3` | T4/T5 validation swap + capability-derived providers (+ fix wave) |
| `42cf530` `a91f8c4` | T6/T7 `/api/models` registry adapter + project-default fix |
| `1a2c35e` | T8 price badges, provider grouping, capability-driven effort levels |

**Three real defects fixed along the way:** a stale `projects.default_model` used to 400 the chat with no recovery; the effort pill was missing `xhigh` (unreachable in the UI despite Opus 5/Sonnet 5/Fable supporting it); provider 400s were masked as "An error occurred."

## 🔑 Findings that will bite whoever picks this up

1. **Not every model has a bare alias.** The live catalog returns `claude-haiku-4-5-20251001` (dated) — there is **no** `claude-haiku-4-5` entry. Our personas/seed/settings all use the alias. Without the alias-indexing fix (`5a26515`) every Haiku request silently fell back to Opus 5 — a **5× cost jump on the cheap tier**. Any new code that looks a model up by id must go through `registry.byId`, which indexes both forms.
2. **`streamText` is synchronous.** Provider errors never reach the route's `try/catch`; they go to `onError`, and `toUIMessageStreamResponse`'s default `onError` masks them as "An error occurred." A passthrough written in the catch block is dead code (we shipped that mistake and fixed it in `35320c3`). Error handling for provider failures belongs in `onError`.
3. **The capabilities tree shape is verified, not assumed:** `capabilities.effort.{low,medium,high,xhigh,max}.supported`, `capabilities.thinking.types.adaptive.supported`, `capabilities.image_input.supported`, `capabilities.structured_outputs.supported`. Confirmed with a live call on 2026-07-21.
4. **Gate on the effort LEVEL, not just `supportsEffort`.** `selectedEffort` is model-independent React state that never resets on model switch, so `xhigh` can follow you onto a model that 400s on it. `providers.ts` checks `caps.effortLevels.includes(effort)`; the pill clamps the display.
5. **`.env.local` has a UTF-8 BOM on line 1**, before `ANTHROPIC_API_KEY`. `grep '^ANTHROPIC_API_KEY='` silently fails; strip the BOM first (`sed '1s/^\xEF\xBB\xBF//'`).
6. **Pricing is not in the API.** Resolution order is DB override (`settings` key `model-pricing-overrides`) → exact table → family tier (`estimated: true`). Sonnet 5 is on **introductory $2/$10 through 2026-08-31**, then reverts to $3/$15 — the override key exists to correct that without a deploy.
7. **Subagent sessions were killed mid-task three times** this build (API errors / teardown). Always verify on-disk state with `git status` before re-dispatching; twice the work was nearly complete and only needed the gate + commit.

## ⏳ Next session — pick up at Task 9

Plan file has full per-task detail. In order:

1. **T9 persona tiers** — `Persona.model` accepts `ModelTier | string`; the 12 built-ins move to `flagship`/`opus`/`sonnet`/`haiku` so they adopt new releases automatically. **Contract Abstract keeps its exact `claude-fable-5` pin** (locked 22-field schema must not shift). Resolution is client-side against the `models` list (`resolveTier` is server-only). Persona chips must resolve before labelling — never print a raw tier.
2. **T10 usage capture — introduces migration `0018`.** New `usage_events` table (NOT columns on `messages`: the assistant row is written client-side *after* the server's `onFinish`, so there's no safe 1:1 moment). `onFinish` already has `chatId`/`projectId`/`modelName` in scope — no client handshake needed. **Before trusting any cost row, verify whether AI SDK v6's `usage.inputTokens` already excludes `inputTokenDetails.cacheReadTokens`/`cacheWriteTokens` or double-counts them** — one `console.log` of a real `totalUsage` settles it. Capture chat + **artifact-regenerate (real Claude spend, not free housekeeping)** + the four Gemini Flash routes.
3. **T11 spend views** — Settings → Usage tab (monthly by model, reusing the `ProjectDefaultsDialog` bar idiom) + per-chat cost in the chat menu.
4. **T12 docs** — CHANGELOG 4.54.0, CLAUDE.md, PERSONAS.md, handoff.

**Release checklist when T10+ land:** apply migration `0018` to Supabase FIRST (`DIRECT_URL=… npx drizzle-kit migrate`), then push, then live-smoke a chat and confirm a `usage_events` row with a plausible `costUsd`.

## Carried items (unchanged, user-side)

- **Version/tag housekeeping is now three releases deep**: `package.json` is 4.51.0; 4.52.0 (dep slice), 4.53.0 (grounded & cited), and 4.54.0 (registry) are all unreleased with no tags. Worth one combined catch-up.
- Tailwind 4.3 visual smoke (live since 07-17, still unverified); PDF preview/regeneration post-CSP-fix; Contract Abstract xlsx flow + 22-field review.
- Roadmap after this feature: Code Phase C (Vercel Sandbox — needs security/cost decisions), the iteration-loop brainstorm, Batch D majors (AI SDK v7, eslint 10, TS 7, react-hooks 7.1 rule adoption).

## Quick links

- Spec/plan: `docs/{specs,plans}/2026-07-21-dynamic-model-registry*` · SDD ledger (per-task record incl. every review finding): `.superpowers/sdd/progress.md`
- Registry code: `src/lib/models/{types,seed,pricing,curate,fetch,registry}.ts`
