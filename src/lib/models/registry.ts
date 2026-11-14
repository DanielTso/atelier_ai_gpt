import { getAnthropicApiKey, getGeminiApiKey } from '@/lib/settings'
import { curateCatalog, parseFamily, DATED_SNAPSHOT_RE } from './curate'
import { loadPricingOverrides, resolvePricing, type PricingOverrides } from './pricing'
import { fetchAllAnthropicModels, type RawAnthropicModel } from './fetch'
import { STATIC_SEED, SEED_ROUTABLE, LEGACY_PINS, GEMINI_MODELS } from './seed'
import { isModelTier, tierFamily, type CatalogModel, type ModelCapabilities, type ModelTier, type Effort } from './types'

/**
 * Where the Claude half of the registry came from:
 * - `live`: this build's own /v1/models fetch.
 * - `stale`: the fetch failed, so the last successful live catalog in this
 *   process is served again (re-priced with the current overrides) — audit
 *   B12: one failed refresh must not swap the models out from under a chat.
 * - `seed`: the fetch failed and there has never been a live build here.
 * Only `live` proves an id is absent from Anthropic's catalog.
 */
export type RegistrySource = 'live' | 'stale' | 'seed'

export interface ModelRegistry {
  curated: CatalogModel[]
  byId: Map<string, CatalogModel>
  source: RegistrySource
}

const EFFORT_LEVELS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// The id every resolver falls back to when the registry has no Anthropic
// entry at all (no key): the seed's first (newest Opus) model.
const DEFAULT_MODEL_ID = STATIC_SEED[0]?.id ?? 'claude-opus-5-5'

// Mirrors the TTL pattern in src/lib/settings.ts:5-40 — a confirmed live
// catalog is trusted longer than a degraded (stale or seed) one, so a
// transient Anthropic outage self-heals within a minute instead of pinning the
// app to the degraded list for a full 5 minutes.
const LIVE_TTL_MS = 5 * 60 * 1000
const DEGRADED_TTL_MS = 60 * 1000

const SAFE_DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsEffort: false,
  effortLevels: [],
  supportsThinking: false,
  supportsImageInput: false,
  supportsStructuredOutputs: false,
}

let cache: { registry: ModelRegistry; expiresAt: number } | null = null
// The normalized Claude catalog of the last successful live fetch — what a
// failed refresh serves as `stale`. Survives a plain cache clear.
let lastLiveClaude: CatalogModel[] | null = null
// One shared build for every caller that misses the cache at once, so a cold
// start under load makes one /v1/models round-trip, not one per request.
let inflight: Promise<ModelRegistry> | null = null
// Bumped on every clear: a build that started before the clear must not write
// its (pre-clear) result into the cache.
let generation = 0

/** Invalidate the cached registry. Call after anything that can change what
 * the registry can see (an API key edit, a pricing-override edit) — mirrors
 * `clearSettingsCache()`, wired into `actions.ts` beside it. The next read
 * rebuilds; the last good live catalog is kept as the fallback for that
 * rebuild (it is re-priced on use) unless `includeLastGood` is set. */
export function clearModelRegistryCache(options: { includeLastGood?: boolean } = {}): void {
  cache = null
  inflight = null
  generation++
  if (options.includeLastGood) lastLiveClaude = null
}

/**
 * Defensive optional-chaining mapper over the UNTYPED Anthropic `capabilities`
 * tree. Every branch is `?.`-guarded so a missing/reshaped field degrades to
 * `false`/`[]` instead of throwing — an API response should never be able to
 * break the registry build. `supportsEffort` is derived (not a raw field):
 * true iff at least one effort level reports `supported`.
 *
 * `EFFORT_LEVELS` is filtered against, so any level the API reports that our
 * `Effort` union doesn't know about is silently dropped rather than passed
 * through — safe today (we never send a param we don't recognize), but a
 * future new effort level needs a one-line addition to the `Effort` union
 * (types.ts) and `EFFORT_LEVELS` here or it will never surface.
 */
function mapCapabilities(rawCapabilities: unknown): ModelCapabilities {
  const caps = rawCapabilities as {
    effort?: Partial<Record<Effort, { supported?: boolean } | undefined>>
    thinking?: { types?: { adaptive?: { supported?: boolean } } }
    image_input?: { supported?: boolean }
    structured_outputs?: { supported?: boolean }
  } | null | undefined

  const effortLevels = EFFORT_LEVELS.filter(level => !!caps?.effort?.[level]?.supported)

  return {
    supportsEffort: effortLevels.length > 0,
    effortLevels,
    supportsThinking: !!caps?.thinking?.types?.adaptive?.supported,
    supportsImageInput: !!caps?.image_input?.supported,
    supportsStructuredOutputs: !!caps?.structured_outputs?.supported,
  }
}

function normalizeAnthropicModel(raw: RawAnthropicModel, overrides: PricingOverrides): CatalogModel {
  const family = parseFamily(raw.id)
  return {
    id: raw.id,
    name: raw.display_name,
    family,
    provider: 'anthropic',
    createdAt: raw.created_at ?? null,
    contextWindow: raw.max_input_tokens ?? null,
    maxOutput: raw.max_tokens ?? null,
    capabilities: mapCapabilities(raw.capabilities),
    pricing: resolvePricing(raw.id, family, overrides),
  }
}

/**
 * Re-price a model that already carries a `pricing` field (STATIC_SEED,
 * SEED_ROUTABLE, GEMINI_MODELS, a stale live entry) through resolvePricing().
 * seed.ts hardcodes a `pricing` field per model that DUPLICATES pricing.ts and
 * has drifted before (Task 1 review), and a stale entry carries the overrides
 * of the build that fetched it. Every ANTHROPIC model this registry serves —
 * live, stale, seed, and legacy pin alike — is re-priced
 * HERE so pricing.ts stays the single source of truth; a model's own
 * hardcoded `pricing` field is never trusted downstream of this function.
 *
 * Token-priced carve-out (see the guard below): non-Anthropic models skip
 * repricing entirely and keep their own hardcoded `pricing` field.
 */
function repriceModel(model: CatalogModel, overrides: PricingOverrides): CatalogModel {
  // Gemini (e.g. Nano Banana 2, family 'nano-banana') is priced per-image,
  // not per-token — an explicit design non-goal for this feature (seed.ts).
  // resolvePricing() only recognizes Anthropic tiers, so running a
  // non-Anthropic model through it would replace the seed's deliberate `0/0`
  // "not token-priced" sentinel with a fabricated Opus-tier estimate AND fire
  // pricing.ts's unknown-family warn on every registry build (~every 5 min
  // per warm instance) — noise that's supposed to mean "a real new Anthropic
  // family shipped and needs pricing," not "Gemini exists." Leave
  // non-Anthropic models untouched.
  if (model.provider !== 'anthropic') return model
  return { ...model, pricing: resolvePricing(model.id, model.family, overrides) }
}

/**
 * Register the bare-alias form of any dated snapshot id (e.g.
 * `claude-haiku-4-5-20251001` -> `claude-haiku-4-5`) into `byId`, pointing at
 * the SAME CatalogModel object as the dated id. Anthropic's live catalog can
 * ship a family with ONLY a dated id and no bare alias (verified live: Haiku
 * 4.5, Sonnet 4.5, Opus 4.5, Opus 4.1 all currently lack one) — but the app
 * routes by the alias everywhere (STATIC_SEED, personas, the persisted
 * `default-model` setting, `projects.default_model` rows). Without this, the
 * alias MISSES `byId` and `resolveRequestedModel()` silently falls back to
 * the curated default (Opus) — e.g. every Haiku request becomes an Opus
 * request, ~5x the input/output cost, with only a console.warn.
 *
 * Never added to `curated` (the picker keeps exactly one row per family) and
 * never overwrites a real catalog entry: only fills the alias key when it's
 * not already taken, so if Anthropic later ships a bare id alongside the
 * dated one, the real entry wins.
 */
function registerDatedAliases(byId: Map<string, CatalogModel>, models: CatalogModel[]): void {
  for (const model of models) {
    if (!DATED_SNAPSHOT_RE.test(model.id)) continue
    const alias = model.id.replace(DATED_SNAPSHOT_RE, '')
    if (!byId.has(alias)) byId.set(alias, model)
  }
}

/**
 * Construct a minimal stand-in CatalogModel for a LEGACY_PINS id that the
 * live/seed catalog no longer returns. LEGACY_PINS is a `string[]`, not
 * CatalogModel[] — this is the "otherwise" branch: resolve from the full
 * catalog when Anthropic still serves the id (handled by the caller before
 * this is invoked), else fabricate a safe profile so an old chat/persona
 * pinned to a retired id never 400s.
 */
function buildLegacyPin(id: string, overrides: PricingOverrides): CatalogModel {
  const family = parseFamily(id)
  return {
    id,
    name: id,
    family,
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: true,
      // Legacy pins predate the `xhigh` effort level (introduced with Opus 5 /
      // Sonnet 5 / Fable 5) — never offer it for a pinned pre-xhigh model.
      effortLevels: ['low', 'medium', 'high', 'max'],
      supportsThinking: true,
      supportsImageInput: true,
      supportsStructuredOutputs: true,
    },
    pricing: resolvePricing(id, family, overrides),
  }
}

async function buildRegistry(): Promise<{ registry: ModelRegistry; liveClaude: CatalogModel[] | null }> {
  // getAnthropicApiKey()/getGeminiApiKey() are getServerSetting() -> db.select()
  // and can reject (DB outage, pool exhaustion) — unlike loadPricingOverrides(),
  // which already catches internally. A rejection here must not propagate past
  // buildRegistry(): the "never throws" contract on resolveRequestedModel() /
  // getModelCapabilities() depends on it. Degrade to "no key" so the registry
  // still builds (seed/empty), cached under the shorter DEGRADED_TTL_MS so a
  // transient DB blip self-heals in 60s instead of throwing on every request.
  const [anthropicApiKey, geminiApiKey, overrides] = await Promise.all([
    getAnthropicApiKey().catch((error) => {
      console.warn('[models] getAnthropicApiKey failed, degrading to no-key state', error)
      return null
    }),
    getGeminiApiKey().catch((error) => {
      console.warn('[models] getGeminiApiKey failed, degrading to no-key state', error)
      return null
    }),
    loadPricingOverrides(),
  ])

  const byId = new Map<string, CatalogModel>()
  let curatedClaude: CatalogModel[] = []
  let source: RegistrySource = 'seed'
  let liveClaude: CatalogModel[] | null = null

  // No Anthropic key -> no Claude entries at all (matches today's gate in
  // src/app/api/models/route.ts) and the live fetch must never even be
  // attempted without a key.
  if (anthropicApiKey) {
    let claudeModels: CatalogModel[]
    try {
      const raw = await fetchAllAnthropicModels(anthropicApiKey)
      claudeModels = raw.map(r => normalizeAnthropicModel(r, overrides))
      source = 'live'
      liveClaude = claudeModels
    } catch (error) {
      if (lastLiveClaude) {
        console.warn('[models] live Anthropic models fetch failed, serving the last live catalog (stale)', error)
        claudeModels = lastLiveClaude.map(m => repriceModel(m, overrides))
        source = 'stale'
      } else {
        console.warn('[models] live Anthropic models fetch failed and no live catalog was ever loaded, falling back to seed', error)
        claudeModels = STATIC_SEED.map(m => repriceModel(m, overrides))
        source = 'seed'
      }
    }

    // byId gets the FULL normalized/seed catalog (not just curated) — dated
    // snapshots, older family members and unrecognized families stay routable
    // even though curateCatalog only surfaces the newest-per-family subset in
    // the picker.
    for (const model of claudeModels) byId.set(model.id, model)
    // Alias pass runs AFTER all real ids are set, so a real bare entry (if
    // Anthropic ever ships one) is already in byId and the guard inside
    // registerDatedAliases() leaves it untouched regardless of array order.
    registerDatedAliases(byId, claudeModels)
    curatedClaude = curateCatalog(claudeModels)

    // Seed path only: the previous seed generation stays routable (byId, not
    // the picker) so an id already held by a chat, persona or project default
    // keeps its own model instead of falling back to the default.
    if (source === 'seed') {
      for (const model of SEED_ROUTABLE) {
        if (!byId.has(model.id)) byId.set(model.id, repriceModel(model, overrides))
      }
    }

    // Legacy pins stay routable even though they're not offered in the
    // picker. Resolve each from the full (live or seed) catalog when
    // Anthropic still serves it; otherwise construct a minimal stand-in.
    for (const pinId of LEGACY_PINS) {
      if (!byId.has(pinId)) {
        byId.set(pinId, buildLegacyPin(pinId, overrides))
      }
    }
  }

  let geminiModels: CatalogModel[] = []
  if (geminiApiKey) {
    geminiModels = GEMINI_MODELS.map(m => repriceModel(m, overrides))
    for (const model of geminiModels) byId.set(model.id, model)
  }

  return { registry: { curated: [...curatedClaude, ...geminiModels], byId, source }, liveClaude }
}

/** Get the (cached) model registry, rebuilding when the TTL has expired.
 * TTL is 5 min for a confirmed live catalog, 60 s for a stale or seed one.
 * Concurrent callers that miss the cache share one in-flight build. */
export async function getModelRegistry(): Promise<ModelRegistry> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.registry
  }
  if (inflight) return inflight

  const startedAt = generation
  const build: Promise<ModelRegistry> = buildRegistry()
    .then(({ registry, liveClaude }) => {
      // A clear landed while this build ran: hand the result to the callers
      // already waiting, but never cache it or keep it as the last good one.
      if (startedAt === generation) {
        if (liveClaude) lastLiveClaude = liveClaude
        const ttl = registry.source === 'live' ? LIVE_TTL_MS : DEGRADED_TTL_MS
        cache = { registry, expiresAt: Date.now() + ttl }
      }
      return registry
    })
    .finally(() => {
      if (inflight === build) inflight = null
    })
  inflight = build
  return build
}

/**
 * Resolve a requested model id against the registry. NEVER throws — this is
 * the fix for a real bug where a stale project default 400s the chat.
 * - No id requested: returns the current default (not a "correction", so
 *   `usedFallback` is false).
 * - Known id (curated, full raw catalog, legacy pin, or Gemini): returns the
 *   id of the catalog entry it matched (prior audit C3) — for a bare alias of
 *   a dated-only model that is the dated id, the one Anthropic serves.
 * - Unknown / retired / tampered id: falls back to the default with a
 *   console.warn and `usedFallback: true`.
 *
 * The default is the first ANTHROPIC entry in `curated`, not literally
 * `curated[0]` — with a Gemini key but no Anthropic key, `curated` is
 * `[nanoBanana]` alone, and `curated[0]` would silently route a text
 * request to an image model (responseModalities TEXT+IMAGE). Falls back to
 * the literal id only when curated has no Anthropic entry at all.
 */
export async function resolveRequestedModel(requested?: string): Promise<{ modelId: string; usedFallback: boolean }> {
  const registry = await getModelRegistry()
  const fallback = registry.curated.find(m => m.provider === 'anthropic')?.id ?? DEFAULT_MODEL_ID

  if (!requested) {
    return { modelId: fallback, usedFallback: false }
  }
  // Defensive backstop: personas are tiered client-side (usePersonas.ts's
  // resolvePersonaModel), so a real tier string should never reach here — but
  // if one does (a stale client build, a non-browser caller), resolve it via
  // resolveTier() instead of silently falling back to the curated default.
  // The client stays the primary resolver; this only prevents a tier from
  // masquerading as an "unknown model id" warning + wrong-model fallback.
  if (isModelTier(requested)) {
    return { modelId: await resolveTier(requested), usedFallback: false }
  }
  const match = registry.byId.get(requested)
  if (match) {
    return { modelId: match.id, usedFallback: false }
  }

  console.warn(`[models] unknown model id "${requested}" requested (registry: ${registry.source}), falling back to "${fallback}"`)
  return { modelId: fallback, usedFallback: true }
}

/**
 * Resolve a persona/effort tier to a concrete model id. 'flagship' maps to
 * the newest 'fable'-family model; every other tier maps to its same-named
 * family. curateCatalog() has already reduced `curated` to the single newest
 * (non-dated-snapshot-preferred) entry per family, so a `.find` here IS the
 * "newest of that family" lookup. A family absent from the registry (e.g.
 * no Anthropic key, so `curated` holds only Gemini, or a live catalog that
 * happens to lack that family) falls back to the first ANTHROPIC entry in
 * `curated` (never `curated[0]` literally — that could be the Gemini image
 * model with a Gemini-only key) or the literal default id — with a warn,
 * never a throw.
 */
export async function resolveTier(tier: ModelTier): Promise<string> {
  const registry = await getModelRegistry()
  const family = tierFamily(tier)
  const match = registry.curated.find(m => m.family === family)
  if (match) return match.id

  const fallback = registry.curated.find(m => m.provider === 'anthropic')?.id ?? DEFAULT_MODEL_ID
  console.warn(`[models] tier "${tier}" (family "${family}") has no match in the curated registry, falling back to "${fallback}"`)
  return fallback
}

/**
 * Look up a model's capabilities so callers never send an unsupported param
 * (e.g. `effort` to a model that 400s on it). Unknown id -> a safe
 * all-`false` default (with a warn), never a throw.
 */
export async function getModelCapabilities(modelId: string): Promise<ModelCapabilities> {
  const registry = await getModelRegistry()
  const model = registry.byId.get(modelId)
  if (!model) {
    console.warn(`[models] unknown model id "${modelId}" requested for capabilities, using safe defaults`)
    return SAFE_DEFAULT_CAPABILITIES
  }
  return model.capabilities
}
