# Dynamic Model Registry + Cost Visibility — design spec

- **Date:** 2026-07-21
- **Status:** Approved (plan-mode brainstorm + Q&A; three decisions locked by the user) → implementation
- **Target release:** v4.54.0
- **Migration:** `0018` (usage events) — migrate BEFORE deploy (standing rule)

## Problem

Claude Opus 5 shipped and Atelier can't offer it. The model list is hardcoded in **two places that must agree** — the curated array in `src/app/api/models/route.ts` and the `MODEL_IDS` Zod allow-list in `src/lib/validation.ts` — plus exact model ids are baked into 13 personas (`usePersonas.ts`), the chat-route default (`route.ts:96`), provider special-cases (`providers.ts:32`), and the effort pill. Adding one model means editing ~6 files, and that repeats every Anthropic release.

Exploration surfaced three defects worth fixing in the same pass:

1. **Live bug:** `projects.defaultModel` is written unvalidated (`actions.ts` `updateProjectDefaults`) and read at `page.tsx:727` with **no membership check**. A stale id reaches `/api/chat`, fails `z.enum(MODEL_IDS)`, and returns `400 Invalid request body` — the chat is unusable with no recovery path.
2. **Wrong effort ladder:** `EffortPill.tsx:9` hardcodes `low|medium|high|max`, missing **`xhigh`** — which Opus 5, Sonnet 5, and Fable 5 all support and which Anthropic recommends as the default for coding/agentic work. The best setting is unreachable in the UI.
3. **Zero cost data:** `chat/route.ts:210` destructures only `{ text }` from `onFinish`; a repo-wide search for `.usage` returns nothing. "What did this month cost?" is unanswerable.

## Goals

1. A new Anthropic model appears in the picker — correctly priced, with the right effort levels, adopted by the personas that should use it — with **no code change**.
2. Every picker row shows its price, so an expensive model can never be selected unaware.
3. Per-chat and monthly-by-model spend become answerable, with cost frozen at generation time.
4. Fix the three defects above; degrade gracefully at every stage (no key / API down / retired model → never a broken chat).

## Locked decisions (user-answered)

| Decision | Choice | Rationale |
|---|---|---|
| New models | **Auto-appear** with price badges; inferred prices marked `est.` | Zero-touch is the whole point; visibility (not hiding) is the cost guard |
| Personas | **Tier-pinned** (`flagship`/`opus`/`sonnet`/`haiku`), exact ids still honored | The other half of never touching code again |
| Cost tracking | **Full** — capture + spend views | Turns "expensive analyst, cheap secretary" from habit into measurement |
| Gemini | Stays static | No discovery need: one image model + one internal utility model |
| Curation depth | Newest **1 per family** | Matches today's behavior (Sonnet 4.6 dropped from picker, still routable) |

## Non-goals

Gemini model discovery · per-message cost hover · budget caps/alerts/auto-throttling · in-app pricing editor (code table + one settings-key override suffices) · retroactive repricing of historical rows · Nano Banana image cost (per-image, not per-token — own pass) · `queryRewrite`/`rerank` usage capture (signature churn for sub-cent Flash calls) · document vision-extraction cost (own pass) · family sub-grouping in the picker · a generic retrying HTTP client.

## Architecture

```
src/lib/models/
  types.ts     CatalogModel, ModelCapabilities, ModelPricing, ModelTier
  fetch.ts     fetchAllAnthropicModels(apiKey) — AbortController 5s, after_id pagination, MAX_PAGES cap
  curate.ts    parseFamily(), curateCatalog()  — pure, no I/O
  pricing.ts   resolvePricing()                — override → exact table → family tier (estimated)
  seed.ts      STATIC_SEED, LEGACY_PINS, GEMINI_MODELS
  registry.ts  getModelRegistry(), resolveRequestedModel(), resolveTier(), getModelCapabilities()
```

Flow: `GET /v1/models` (our own key) → normalize → curate → price → cache → `/api/models` → client.

**Every stage degrades** (house style, per `queryRewrite.ts`/`rerank.ts`/`retrieval.ts`): no key or fetch failure → `STATIC_SEED` (today's exact list) with a `console.warn`, never an empty picker.

**Caching** mirrors `settings.ts:5-40`: module-level TTL cache, differentiated TTLs (5 min success / 60 s failure), `clearModelRegistryCache()` invalidation called from `actions.ts` beside the existing `clearSettingsCache()` calls.

### C1 — Curation rule (the zero-touch core)

Exclude dated snapshots (`/-\d{8}$/`); group by the family segment after `claude-`; keep the **newest per family** by `created_at`; order `opus → fable → sonnet → haiku → unknown`. Edge cases:
- A family with **only** dated snapshots (no bare alias yet) falls back to those rather than vanishing.
- An **unknown family** (e.g. `claude-nova-3`) still appears, sorted last, priced at the conservative Opus tier and marked `est.` — visible and safe, never silently dropped. It does not become the *default* (curated[0]) until a one-line, cosmetic `FAMILY_DISPLAY_ORDER` addition.
- Previous-generation models leave the picker but stay **routable** (existing chats keep working).

### C2 — Pricing (API returns none)

Resolution order, highest first: **DB override → exact-id table → family tier (`estimated: true`)**. Override wins so a wrong/stale code price can be corrected without a deploy. Storage: one `settings` row, key `model-pricing-overrides`, value = JSON string (no migration; the table is key/text). Unknown family → conservative Opus-tier estimate + warn (never under-quote).

### C3 — Validation (must not get weaker)

`z.enum(MODEL_IDS)` is deleted; the allow-list **moves**, it does not disappear. Zod keeps a shape guard only (`min(1).max(64)`, charset); the real gate is `registry.byId` — the live catalog Anthropic serves under **our** key, plus `LEGACY_PINS` and Gemini statics.

```ts
resolveRequestedModel(requested?: string): Promise<{ modelId: string; usedFallback: boolean }>
```

Unknown / retired / tampered → falls back to the current default **with a server log, never a 400**. This is the route-level fix for defect #1; `updateProjectDefaults` additionally refuses to persist an unrecognized id (root-cause fix), and `page.tsx` gains the membership check `fetchModels` already applies to the settings default (defense in depth).

### C4 — Capability-derived behavior

`createProvider` is **already `async` and all four call sites already `await`** — so replacing the `!modelName.startsWith('claude-haiku')` effort gate with `caps.supportsEffort` is a drop-in with zero signature ripple. `EffortPill` takes a `levels` prop derived from the selected model's capabilities (picking up `xhigh` automatically). Capabilities are mapped defensively from the untyped `capabilities` tree (all optional-chaining → `false`, never throws). Capability data reaches server and client from the already-cached registry — **no per-request network call**.

**Residual gap, accepted:** org-level rules (Fable's 30-day retention requirement) aren't per-model capability fields and can't be derived. Mitigation is to make the failure legible instead: the chat route's catch block surfaces raw Anthropic 400 text (truncated) rather than today's generic "An error occurred during text generation."

### C5 — Persona tiers

`Persona.model` accepts `ModelTier | string`. `resolveTier('flagship')` → newest Fable-family, `'opus'` → newest Opus, etc. The 13 built-ins move to tiers **except Contract Abstract**, which stays pinned to `claude-fable-5` (locked-schema extraction output must not shift under the user). Custom personas in localStorage keep exact ids and continue to work unchanged.

### C6 — Cost capture

**New `usage_events` table**, not columns on `messages`: the assistant row is written **client-side** (`useChatPersistence.ts:82`) *after* the server's `onFinish` fires, so there's no safe 1:1 moment. Keying on `chatId` sidesteps the race and is more correct — you are billed even if the user closes the tab mid-stream.

`onFinish` already has `chatId`, `projectId`, and `modelName` in scope, so capture needs **no client plumbing and no `messageId` handshake**:

```ts
onFinish: ({ text, totalUsage }) => {   // totalUsage = summed across the 12-step tool loop
  /* existing [cite-compliance] log unchanged */
  void recordUsage({ chatId, projectId, purpose: 'chat', model: modelName, usage: totalUsage })
}
```

Columns: `chatId, projectId, purpose, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd, costEstimated, createdAt` + indexes on `chat_id` and `(model, created_at)`.

- **`costUsd` is computed and frozen at write time** — a later price change must never silently reprice history (also handles Sonnet 5's intro pricing expiring).
- Cache read (~0.1×) and cache write (~1.25×) priced separately — prompt caching materially changes Claude cost.
- Captured: **chat**, **artifact-regenerate** (real Claude spend on Sonnet 5 — not free housekeeping), summarize, generate-title, classify, memory-suggest. Skipped per Non-goals: `queryRewrite`/`rerank`, vision extraction.
- All writes best-effort (`void` + `.catch`) — a usage-write failure must never fail a chat turn.

⚠️ **Verify before task 10 lands:** whether AI SDK v6's `usage.inputTokens` already excludes `inputTokenDetails.cacheReadTokens`/`cacheWriteTokens` or double-counts them. One `console.log` of a real `totalUsage` settles it; getting it wrong silently corrupts every cost row.

### C7 — Spend views

Primary: **Settings → Usage** tab (a fourth tab beside appearance/defaults/keys) — monthly rollup grouped by model, reusing the thin-bar/percentage idiom already in `ProjectDefaultsDialog`. Secondary (same aggregate, different `WHERE`): **per-chat cost** in the chat menu.

## Client contract

`Model` gains `provider`, `family`, `capabilities`, `pricing`. `ModelSelect` groups by `provider` (robust to a new Claude family name) instead of `startsWith('claude')`/`includes('image')`, and renders `$in/$out` per row with an `est.` marker. `Effort` — currently defined **twice** (`providers.ts:13` and `usePersonas.ts:6`) — consolidates into `src/types.ts` with `xhigh` added; both modules re-export for back-compat.

## Verification gate

Per task: `npm run typecheck` (0) → `npm run lint` (0 errors, ≤25 warnings) → **cold** build (`rm -rf .next`) → `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`.

Live acceptance after deploy: `curl /api/models` shows **Opus 5 with no code change** (the whole point); key removed → seed fallback + log; a chat turn writes a `usage_events` row with plausible `costUsd`; Settings → Usage shows a non-zero monthly figure.

## Risks

| Risk | Mitigation |
|---|---|
| A $10/$50 flagship auto-appears and is clicked unaware | Price on every row; `est.` badge when inferred |
| New model needs API wiring we lack (Fable rejects `thinking:disabled`; Opus 5 caps disabled-thinking at `high`) | Capability-derived wiring covers param cases; raw 400 text surfaced for the rest |
| Live catalog widens the allow-list vs. a hand-curated enum | Bound stays real (only ids Anthropic serves under our key + pins); single-user app; stale clients now degrade instead of 400ing |
| Anthropic API down / slow in the request path | 5 s abort, 5 min success cache, 60 s failure cache, seed fallback; `createProvider` never blocks on a live fetch |
| Model retired under a persona/project default | `resolveRequestedModel` substitutes + logs; tier-pinned personas immune by design |
| Cost rows silently wrong | Cache-token accounting verified before task 10 lands |

## Definition of done

Registry (T1–T9) + cost visibility (T10–T11) landed with the gate green per task, migration `0018` authored, docs updated (CHANGELOG 4.54.0, CLAUDE.md, PERSONAS.md, handoff). Release (migrate → push → tag) user-gated.
