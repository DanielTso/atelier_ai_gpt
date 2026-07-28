# Dynamic Model Registry + Cost Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new Anthropic model appears in Atelier — priced, with correct effort levels, adopted by the right personas — with zero code change; plus per-chat and monthly spend become visible.

**Architecture:** A cached server-side registry (`src/lib/models/*`) fetches Anthropic's `GET /v1/models`, curates newest-per-family, layers pricing on top, and becomes the single source of truth for the picker, request validation, provider wiring, and persona tiers. A `usage_events` table records tokens + cost frozen at generation time. Spec (the contract): `docs/specs/2026-07-21-dynamic-model-registry-design.md`.

**Tech Stack:** Next.js 16 · AI SDK v6 · Drizzle/Supabase · Zod · Vitest + PGlite.

## Global Constraints

- Single-quote no-semicolon in new files; match the file you're in (`providers.ts`, `schema.ts`, `route.ts` use semicolons). **Never run prettier.**
- Gate per task: `npm run typecheck` (0) → `npm run lint` (0 errors, ≤25 warnings) → `rm -rf .next && npm run build` (**cold**) → `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`. Run the suite **synchronously with a long timeout and wait** — do not background it.
- One Conventional Commit per task; trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Local only — push/migrate/tag are user-gated.
- **Tailwind scanner rule** (carried gotcha): never write literal `[cite:`+digits in scanned source files. Not expected here, but `globals.css` `@source not` exclusions exist for a reason.
- Anthropic Models API facts (verified, do not re-derive): `GET https://api.anthropic.com/v1/models`, headers `x-api-key` + `anthropic-version: 2023-06-01`; response `{data[], has_more, first_id, last_id}`; pagination is **`after_id`/`limit`** (NOT `page`/`next_page`); each model has `id`, `display_name`, `created_at`, `max_input_tokens`, `max_tokens`, and an **untyped** `capabilities` tree with `supported` booleans at the leaves (`capabilities.effort.{low,medium,high,xhigh,max}.supported`, `capabilities.thinking.types.adaptive.supported`, `capabilities.image_input.supported`, `capabilities.structured_outputs.supported`). **The API returns no pricing.**

---

### Task 1: Registry primitives (pure, no I/O except fetch)

**Files:** Create `src/lib/models/{types,seed,pricing,curate,fetch}.ts`; Test `tests/unit/lib/models/{curate,pricing,fetch}.test.ts`

**Produces (later tasks depend on these exact names):**
```ts
export type ModelTier = 'flagship' | 'opus' | 'sonnet' | 'haiku'
export interface ModelCapabilities { supportsEffort: boolean; effortLevels: Effort[]; supportsThinking: boolean; supportsImageInput: boolean; supportsStructuredOutputs: boolean }
export interface ModelPricing { inputPerMTok: number; outputPerMTok: number; estimated: boolean }
export interface CatalogModel { id: string; name: string; family: string; provider: 'anthropic' | 'google'; createdAt: string | null; contextWindow: number | null; maxOutput: number | null; capabilities: ModelCapabilities; pricing: ModelPricing }
export function parseFamily(modelId: string): string
export function curateCatalog(models: CatalogModel[]): CatalogModel[]
export function resolvePricing(modelId: string, family: string, overrides: PricingOverrides): ModelPricing
export async function fetchAllAnthropicModels(apiKey: string): Promise<RawAnthropicModel[]>
```

- [ ] `types.ts` — the interfaces above. Import `Effort` from `@/types` (Task 3 moves it there; until then declare the union locally and swap in T3 — note this ordering in the commit).
- [ ] `curate.ts` — exact rule: `DATED_SNAPSHOT_RE = /-\d{8}$/`; `parseFamily` = lowercase match of `/^claude-([a-z]+)/`, else `'other'`; group by family; per family prefer non-dated aliases but **fall back to dated entries if that would empty the family**; keep newest 1 by `createdAt`; sort by `FAMILY_DISPLAY_ORDER = ['opus','fable','sonnet','haiku']` then newest-first for unknown families.
- [ ] `pricing.ts` — `EXACT_PRICING` (opus family 5/25, sonnet 3/15, haiku 1/5, fable 10/50 — enumerate current ids), `FAMILY_TIER_PRICING`, `CONSERVATIVE_DEFAULT = opus tier`, `loadPricingOverrides()` reading settings key `model-pricing-overrides` via `getServerSetting` with a `try/catch → {}` on malformed JSON + warn. Resolution order **override → exact → family tier(estimated) → conservative(estimated) + warn**.
- [ ] `fetch.ts` — `fetchWithTimeout` using `AbortController` (5 s) in a `try/finally clearTimeout`; loop `after_id` while `has_more && last_id`, `limit=100`, `MAX_PAGES=10` safety cap that throws if exceeded; non-2xx throws with the status. This introduces the repo's first outbound-fetch-with-timeout convention — comment it as such.
- [ ] `seed.ts` — `STATIC_SEED` = today's exact four (Opus 4.8, Fable 5, Sonnet 5, Haiku 4.5) with hand-authored capabilities (Haiku: `supportsEffort: false`); `LEGACY_PINS` = `claude-sonnet-4-6`; `GEMINI_MODELS` = Nano Banana 2 (`gemini-3.1-flash-image`, provider `google`, no effort).
- [ ] Tests (pure, no mocking for curate/pricing): dated-snapshot exclusion; newest-per-family; all-dated fallback; unknown-family ordering + conservative pricing + `estimated: true`; pricing resolution order incl. override wins over exact; malformed override JSON → `{}`. For `fetch.ts`: `vi.stubGlobal('fetch', …)` two-page pagination via `has_more`/`last_id`, non-2xx throws, abort/timeout propagates.
- [ ] Gate. Commit: `feat(models): registry primitives - curation, pricing, catalog fetch`

### Task 2: Registry assembly, cache, resolvers

**Files:** Create `src/lib/models/registry.ts`; Test `tests/unit/lib/models/registry.test.ts`

**Consumes:** T1. **Produces:**
```ts
export interface ModelRegistry { curated: CatalogModel[]; byId: Map<string, CatalogModel>; source: 'live' | 'seed' }
export async function getModelRegistry(): Promise<ModelRegistry>
export function clearModelRegistryCache(): void
export async function resolveRequestedModel(requested?: string): Promise<{ modelId: string; usedFallback: boolean }>
export async function resolveTier(tier: ModelTier): Promise<string>          // → concrete model id
export async function getModelCapabilities(modelId: string): Promise<ModelCapabilities>
```

- [ ] `buildRegistry()`: `Promise.all([getAnthropicApiKey(), getGeminiApiKey(), loadPricingOverrides()])`; if key → `try { fetchAllAnthropicModels } catch { console.warn('[models] …falling back to seed'); STATIC_SEED }`; no key → no Claude entries (matches today's gate). Union `LEGACY_PINS` (only if absent) and Gemini statics into `byId`; `curated` = curated Claude ids + Gemini (when key present).
- [ ] Cache: module-level `{ registry, expiresAt } | null`; TTL 5 min on `source: 'live'`, 60 s on `'seed'`; `clearModelRegistryCache()` exported and called from `actions.ts` next to the existing `clearSettingsCache()` sites (dynamic `import()`, matching that file's convention).
- [ ] `resolveRequestedModel`: fallback = `registry.curated[0]?.id ?? 'claude-opus-4-8'`; unknown id → warn + fallback, `usedFallback: true`. Never throws.
- [ ] `resolveTier`: `'flagship'` → newest `fable` family, else newest family match; if the family is absent from the registry, fall back to `curated[0]` + warn.
- [ ] `getModelCapabilities`: registry lookup; unknown → safe default `{ supportsEffort: false, … }` + warn (never send an unsupported param).
- [ ] `mapCapabilities(raw)` — all optional-chaining over the untyped tree, `EFFORT_LEVELS.filter(l => !!caps?.effort?.[l]?.supported)`.
- [ ] Tests with `vi.stubGlobal('fetch')` + `vi.useFakeTimers()`: live path shape; fetch failure → `source: 'seed'`; no key → zero Claude models **and fetch never called**; TTL hit/miss both TTLs; `clearModelRegistryCache()` forces rebuild; `resolveRequestedModel` known/stale/legacy-pin (legacy resolves even when fetch fails); `resolveTier` per tier + missing-family fallback.
- [ ] Gate. Commit: `feat(models): registry assembly, TTL cache, model + tier resolvers`

### Task 3: Shared types — one `Effort`, richer `Model`

**Files:** Modify `src/types.ts`, `src/lib/providers.ts`, `src/hooks/usePersonas.ts`, `src/lib/models/types.ts`

`Effort` is currently declared **twice** (`providers.ts:13`, `usePersonas.ts:6`) with identical unions. Consolidate:

- [ ] `src/types.ts`: `export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'` (adds `xhigh`), plus `ModelCapabilities`/`ModelPricing` re-exported from the models module, and extend `Model` with `provider`, `family`, `capabilities`, `pricing`.
- [ ] `providers.ts` and `usePersonas.ts`: delete the local declarations, `export type { Effort } from '@/types'` so every existing `import { type Effort } from '@/hooks/usePersonas'` keeps compiling.
- [ ] Verify with `npx tsc --noEmit` that no call site broke; no test changes expected.
- [ ] Gate. Commit: `refactor(types): single Effort union with xhigh, capability-bearing Model`

### Task 4: Validation swap + chat-route resolution

**Files:** Modify `src/lib/validation.ts`, `src/app/api/chat/route.ts`; Tests `tests/unit/lib/validation.test.ts` (new), extend `tests/unit/api/chat-route.test.ts`

- [ ] Delete `MODEL_IDS`/`modelEnum`. Add `const modelIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9.-]*$/i)` with a comment: **shape guard only — the allow-list is `registry.byId` via `resolveRequestedModel`**. Swap it into the 4 schemas that reference `modelEnum`. Widen the `effort` enum to include `xhigh`.
- [ ] `chat/route.ts`: replace `const modelName = model || 'claude-opus-4-8'` with `const { modelId: modelName } = await resolveRequestedModel(model)`.
- [ ] Also in `chat/route.ts` catch block: keep the existing API-key/provider special-cases, and add — for `Error` messages containing `invalid_request_error` or a 400 — surfacing the raw provider text truncated to 300 chars, so an unhandled model rule is legible instead of "An error occurred during text generation." (spec C4 residual gap).
- [ ] RED→GREEN tests: schema accepts a legacy/unknown well-shaped id and rejects empty/oversize/bad-charset; **chat route with a stale model returns 200 using the fallback, not 400** (this is the locked bug fix — spy `console.warn`).
- [ ] Gate. Commit: `fix(chat): registry-backed model resolution - stale ids fall back instead of 400ing`

### Task 5: Capability-derived provider wiring

**Files:** Modify `src/lib/providers.ts`; extend `tests/unit/lib/providers.test.ts`

- [ ] Replace `if (effort && !modelName.startsWith('claude-haiku'))` with `const caps = await getModelCapabilities(modelName); if (effort && caps.supportsEffort)`. `createProvider` is already `async` and all 4 call sites already `await` — no signature change.
- [ ] Update `providers.test.ts`: add `vi.doMock('@/lib/models/registry', …)` to every case so no test hits the network; assert the Haiku case now flows through capability data, and that a capability-less/unknown model omits `effort`.
- [ ] Gate. Commit: `feat(providers): derive effort support from model capabilities`

### Task 6: `/api/models` as a registry adapter

**Files:** Modify `src/app/api/models/route.ts`; rewrite `tests/unit/api/models-route.test.ts`

- [ ] Route becomes: `const registry = await getModelRegistry()` → map `curated` to the wire shape `{ name, model, digest, provider, family, capabilities, pricing }` (keep `name`/`model`/`digest` for back-compat; `digest` stays the id). Preserve `Cache-Control: public, max-age=300`.
- [ ] Rewrite the test to `vi.doMock('@/lib/models/registry')` with a canned registry instead of mocking `@/lib/settings`; keep the existing assertions (Claude-first ordering, Gemini gated, empty when no keys, exact Cache-Control) and add: response rows carry `capabilities` + `pricing`.
- [ ] Gate. Commit: `feat(models): serve the curated registry with capabilities and pricing`

### Task 7: Project-default bug fix (two layers)

**Files:** Modify `src/app/actions.ts` (`updateProjectDefaults`), `src/app/page.tsx` (two call sites); extend `tests/unit/actions/projects.test.ts`

- [ ] `updateProjectDefaults`: before writing, if `defaultModel` is set, `resolveRequestedModel` it (dynamic `import()`, matching the `clearSettingsCache` convention in this file) and **persist `null` instead of an unrecognized id**.
- [ ] `page.tsx` (~line 727 `createChatForProject`, ~line 871 landing compose): apply `defaults.defaultModel` only when `models.some(m => m.model === defaults.defaultModel)`, else keep current selection + `console.warn` — mirroring the check `fetchModels` already does for the settings default.
- [ ] PGlite test: bogus `defaultModel` → row stores `null`; valid id → stored as-is.
- [ ] Gate. Commit: `fix(projects): never persist or apply an unavailable default model`

### Task 8: Client — price badges, provider grouping, dynamic effort

**Files:** Modify `src/components/ui/ModelSelect.tsx`, `src/components/chat/ChatInputArea.tsx`, `src/components/ui/EffortPill.tsx`; Test `tests/hooks/ModelSelect.test.tsx` (new)

- [ ] `ModelSelect`: group by `m.provider === 'anthropic' | 'google'` (replacing `startsWith('claude')`/`includes('image')`); render price per row — `$5 / $25` with a `~`/`est.` marker when `pricing.estimated`, using the existing chip idiom (`text-[10px]`, `text-muted-foreground`, `bg-primary/15` for the estimated marker; semantic tokens only).
- [ ] `EffortPill`: delete the module-level `LEVELS`; accept required `levels: Effort[]` and map over it.
- [ ] `ChatInputArea`: look up the selected model in the `models` prop it already has; render the pill only when `caps.supportsEffort`, passing `caps.effortLevels` (this is what surfaces `xhigh`). Delete the `startsWith('claude') && !startsWith('claude-haiku')` gate.
- [ ] jsdom tests: price rendered incl. estimated marker; provider grouping; effort pill hidden for a no-effort model and shows exactly the model's levels (incl. `xhigh`).
- [ ] Gate. Commit: `feat(ui): model prices in the picker, capability-driven effort levels`

### Task 9: Persona tiers

**Files:** Modify `src/hooks/usePersonas.ts`, `src/app/api/chat/route.ts` or `page.tsx` (wherever a persona's model is applied); Test extend `tests/hooks/usePersonas.test.tsx`

- [ ] `Persona.model: ModelTier | string`. Convert the 12 built-ins to tiers (`flagship` for Claims/Contract-Spec/Constructability/Deep-Reasoner, `opus` for Coding/Code-Review/Deep-Analysis/Construction-Pro, `sonnet` for General/Creative/Teacher/Plan-Spec-Reader, `haiku` for Brief). **Contract Abstract stays pinned to `claude-fable-5`** (locked-schema output).
- [ ] Resolution happens server-side or at selection time via `resolveTier`; `MODEL_SHORT_LABELS`/`modelShortLabel()` must render a tier sensibly (resolve first, then label). Custom personas (localStorage, exact ids) keep working.
- [ ] Tests: the three flagship personas resolve to the newest fable model; a tier with no matching family falls back; Contract Abstract stays exactly `claude-fable-5`.
- [ ] Gate. Commit: `feat(personas): tier-pinned models that adopt new releases automatically`

### Task 10: Usage capture (migration 0018)

**Files:** Modify `src/db/schema.ts`; generate `drizzle/0018_*.sql`; create `src/lib/usage.ts`; modify `src/app/api/chat/route.ts` + `artifacts/[id]/regenerate` + `summarize` + `generate-title` + `classify` + `memory/suggest`; Tests `tests/unit/lib/usage.test.ts`, extend route tests

- [ ] **FIRST — the accounting check:** log one real `totalUsage` (or assert against AI SDK types/docs) to determine whether `usage.inputTokens` already excludes `inputTokenDetails.cacheReadTokens`/`cacheWriteTokens`. Record the finding in the report; the `freshInput` computation depends on it.
- [ ] `usageEvents` table + 2 indexes per spec C6; `npx drizzle-kit generate` → verify the SQL contains only the new table + indexes.
- [ ] `src/lib/usage.ts`: `estimateCost(modelId, usage, pricing)` (cache read ×0.1, cache write ×1.25 of input rate) and `recordUsage(args)` — resolves pricing from the registry, computes cost, inserts. **Best-effort**: internal `try/catch` + `console.warn`, never throws into a request path.
- [ ] Wire the six capture sites; chat uses `totalUsage` (12-step loop) inside the existing `onFinish`, alongside the untouched `[cite-compliance]` log.
- [ ] Tests: cost math incl. cache tokens and `estimated` propagation; PGlite insert + a rollup query; a `recordUsage` failure does not fail the caller.
- [ ] Gate. Commit: `feat(usage): capture tokens and frozen cost per generation (migration 0018)`

### Task 11: Spend views

**Files:** Modify `src/app/actions.ts` (rollup queries), `src/components/ui/SettingsDialog.tsx`, create `src/components/settings/UsageSettingsTab.tsx`, modify the chat menu component; Tests PGlite for the actions + jsdom for the tab

- [ ] Actions: `getMonthlyUsageByModel(monthsBack = 3)` → `{ month, model, costUsd, inputTokens, outputTokens, estimated }[]`; `getChatCost(chatId)` → `{ costUsd, estimated }`.
- [ ] `UsageSettingsTab`: fourth tab; monthly total + per-model bars reusing the `ProjectDefaultsDialog` stats idiom; show an `est.` note when any row is estimated; empty state when no data.
- [ ] Chat menu: one line, `Cost: $0.08` (hidden when zero/unknown).
- [ ] Gate. Commit: `feat(usage): monthly spend by model and per-chat cost`

### Task 12: Docs + final gate

- [ ] CHANGELOG `[4.54.0]`; CLAUDE.md (models/registry section, migration `0018`, effort ladder incl. `xhigh`, usage table); `docs/PERSONAS.md` (tiers + auto-adoption); new `docs/SESSION_HANDOFF_<date>.md` superseding 07-21 with the release checklist (**migrate 0018 → push → live acceptance: Opus 5 appears with no code change**).
- [ ] Full cold gate one final time. Commit: `docs: dynamic model registry + cost visibility (4.54.0)`
- [ ] STOP — release is user-gated.

## Self-review

- Spec coverage: C1→T1, C2→T1, C3→T4, C4→T5+T8, C5→T9, C6→T10, C7→T11; defects #1→T7+T4, #2→T3+T8, #3→T10.
- Ordering note: T1 declares `Effort` locally and T3 swaps it to the shared type — intentional, called out in T1.
- Types consistent across tasks: `CatalogModel`, `ModelCapabilities`, `ModelPricing`, `ModelTier`, `resolveRequestedModel`, `resolveTier`, `getModelCapabilities`, `recordUsage`, `estimateCost`.
