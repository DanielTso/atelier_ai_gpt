import { getAnthropicApiKey, getGeminiApiKey } from '@/lib/settings'
import { curateCatalog, parseFamily } from './curate'
import { loadPricingOverrides, resolvePricing, type PricingOverrides } from './pricing'
import { fetchAllAnthropicModels, type RawAnthropicModel } from './fetch'
import { STATIC_SEED, LEGACY_PINS, GEMINI_MODELS } from './seed'
import type { CatalogModel, ModelCapabilities, ModelTier, Effort } from './types'

export interface ModelRegistry {
  curated: CatalogModel[]
  byId: Map<string, CatalogModel>
  source: 'live' | 'seed'
}

const EFFORT_LEVELS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Mirrors the TTL pattern in src/lib/settings.ts:5-40 — a confirmed live
// catalog is trusted longer than a degraded (seed) one, so a transient
// Anthropic outage self-heals within a minute instead of pinning the app to
// the seed list for a full 5 minutes.
const LIVE_TTL_MS = 5 * 60 * 1000
const SEED_TTL_MS = 60 * 1000

const SAFE_DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsEffort: false,
  effortLevels: [],
  supportsThinking: false,
  supportsImageInput: false,
  supportsStructuredOutputs: false,
}

let cache: { registry: ModelRegistry; expiresAt: number } | null = null

/** Invalidate the cached registry. Call after anything that can change what
 * the registry can see (an API key edit, a pricing-override edit) — mirrors
 * `clearSettingsCache()`, wired into `actions.ts` beside it. */
export function clearModelRegistryCache(): void {
  cache = null
}

/**
 * Defensive optional-chaining mapper over the UNTYPED Anthropic `capabilities`
 * tree. Every branch is `?.`-guarded so a missing/reshaped field degrades to
 * `false`/`[]` instead of throwing — an API response should never be able to
 * break the registry build. `supportsEffort` is derived (not a raw field):
 * true iff at least one effort level reports `supported`.
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
 * GEMINI_MODELS) through resolvePricing(). Carry-over fact from the Task 1
 * review: seed.ts hardcodes a `pricing` field per model that DUPLICATES
 * pricing.ts and has already drifted (Sonnet 5's seed entry says 3/15 while
 * EXACT_PRICING now has the introductory 2/10 rate). Every model this
 * registry serves — live, seed, legacy pin, and Gemini alike — is re-priced
 * HERE so pricing.ts stays the single source of truth; a model's own
 * hardcoded `pricing` field is never trusted downstream of this function.
 *
 * Note for Gemini specifically: GEMINI_MODELS' family is `'nano-banana'`,
 * which resolvePricing() doesn't recognize (Nano Banana is priced per-image,
 * not per-token — an explicit design non-goal for this feature). Re-pricing
 * it therefore resolves to the conservative Opus-tier estimate (with a
 * console.warn naming the unknown family) rather than the seed's deliberate
 * `0/0` sentinel. That's an accepted, visible consequence of "pricing.ts is
 * the only source of truth" — per-token cost display is not yet wired to any
 * UI for the image model, and a future pass can special-case per-image cost
 * without touching this repricing rule.
 */
function repriceModel(model: CatalogModel, overrides: PricingOverrides): CatalogModel {
  return { ...model, pricing: resolvePricing(model.id, model.family, overrides) }
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

async function buildRegistry(): Promise<ModelRegistry> {
  const [anthropicApiKey, geminiApiKey, overrides] = await Promise.all([
    getAnthropicApiKey(),
    getGeminiApiKey(),
    loadPricingOverrides(),
  ])

  const byId = new Map<string, CatalogModel>()
  let curatedClaude: CatalogModel[] = []
  let source: 'live' | 'seed' = 'seed'

  // No Anthropic key -> no Claude entries at all (matches today's gate in
  // src/app/api/models/route.ts) and the live fetch must never even be
  // attempted without a key.
  if (anthropicApiKey) {
    let claudeModels: CatalogModel[]
    try {
      const raw = await fetchAllAnthropicModels(anthropicApiKey)
      claudeModels = raw.map(r => normalizeAnthropicModel(r, overrides))
      source = 'live'
    } catch (error) {
      console.warn('[models] live Anthropic models fetch failed, falling back to seed', error)
      claudeModels = STATIC_SEED.map(m => repriceModel(m, overrides))
      source = 'seed'
    }

    // byId gets the FULL normalized/seed catalog (not just curated) — dated
    // snapshots and unrecognized families (fact (d): e.g. claude-3-7-sonnet-*
    // collapsing into family 'other') stay routable even though curateCatalog
    // only surfaces the newest-per-family subset in the picker.
    for (const model of claudeModels) byId.set(model.id, model)
    curatedClaude = curateCatalog(claudeModels)

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

  return { curated: [...curatedClaude, ...geminiModels], byId, source }
}

/** Get the (cached) model registry, rebuilding when the TTL has expired.
 * TTL is 5 min for a confirmed live catalog, 60 s for a seed/degraded one. */
export async function getModelRegistry(): Promise<ModelRegistry> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.registry
  }
  const registry = await buildRegistry()
  const ttl = registry.source === 'live' ? LIVE_TTL_MS : SEED_TTL_MS
  cache = { registry, expiresAt: Date.now() + ttl }
  return registry
}

/**
 * Resolve a requested model id against the registry. NEVER throws — this is
 * the fix for a real bug where a stale project default 400s the chat.
 * - No id requested: returns the current default (not a "correction", so
 *   `usedFallback` is false).
 * - Known id (curated, full raw catalog, legacy pin, or Gemini): passed
 *   through unchanged.
 * - Unknown / retired / tampered id: falls back to the default with a
 *   console.warn and `usedFallback: true`.
 */
export async function resolveRequestedModel(requested?: string): Promise<{ modelId: string; usedFallback: boolean }> {
  const registry = await getModelRegistry()
  const fallback = registry.curated[0]?.id ?? 'claude-opus-4-8'

  if (!requested) {
    return { modelId: fallback, usedFallback: false }
  }
  if (registry.byId.has(requested)) {
    return { modelId: requested, usedFallback: false }
  }

  console.warn(`[models] unknown model id "${requested}" requested, falling back to "${fallback}"`)
  return { modelId: fallback, usedFallback: true }
}

/**
 * Resolve a persona/effort tier to a concrete model id. 'flagship' maps to
 * the newest 'fable'-family model; every other tier maps to its same-named
 * family. curateCatalog() has already reduced `curated` to the single newest
 * (non-dated-snapshot-preferred) entry per family, so a `.find` here IS the
 * "newest of that family" lookup. A family absent from the registry entirely
 * (e.g. no Anthropic key, so `curated` is empty) falls back to `curated[0]`
 * (or the literal default id) with a warn — never throws.
 */
export async function resolveTier(tier: ModelTier): Promise<string> {
  const registry = await getModelRegistry()
  const family = tier === 'flagship' ? 'fable' : tier
  const match = registry.curated.find(m => m.family === family)
  if (match) return match.id

  const fallback = registry.curated[0]?.id ?? 'claude-opus-4-8'
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
