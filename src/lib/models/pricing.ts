import { getServerSetting } from '@/lib/settings'
import { DATED_SNAPSHOT_RE } from './curate'
import type { ModelPricing } from './types'

const PRICING_OVERRIDES_KEY = 'model-pricing-overrides'

type Rates = { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number }

export type PricingOverrides = Record<string, Rates>

// Exact per-model pricing ($ / million tokens), from the claude-api skill's
// model table (cached 2026-11-03) checked against Anthropic's pricing page on
// 2026-11-14. Enumerate CURRENT (still-served) ids only — a retired id (e.g.
// claude-sonnet-4-6) intentionally falls through to its family tier below
// rather than being hand-maintained forever. `cacheReadPerMTok` is set only
// where the cache-hit rate is NOT the standard 0.1x of input. Cache writes are
// 1.25x input on every model (CACHE_WRITE_RATE in usage.ts).
//
// This table has NO date logic: a price change must be edited by hand on the
// day (or corrected without a deploy via the `model-pricing-overrides`
// settings row). Costs are frozen into DB rows at write time; a stale entry
// here mis-prices history permanently.
export const EXACT_PRICING: Record<string, Rates> = {
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-fable-5-2': { inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.2 },
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25 },
  // Contract Abstract is pinned to this exact id.
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1 },
  // $2/$10 is the standard price: the increase to $3/$15 scheduled for
  // 2026-09-01 was cancelled (pricing page footnote, read 2026-11-14).
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  // Prompts up to 100K tokens. A request over 100K is billed $0.50 / $2.50;
  // usage rows are priced from step-summed usage, which cannot tell a long
  // request apart, so those requests are under-costed here.
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
}

// Family-tier fallback for an id not (yet) in EXACT_PRICING — e.g. a brand-new
// snapshot Anthropic ships before we've hand-priced it. Always `estimated: true`.
export const FAMILY_TIER_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  opus: { inputPerMTok: 5, outputPerMTok: 25 },
  fable: { inputPerMTok: 10, outputPerMTok: 50 },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  haiku: { inputPerMTok: 1, outputPerMTok: 5 },
}

// A family we don't recognize at all (not even a tier guess) is priced at the
// Opus tier — the most expensive *mainline* tier, so a garden-variety unknown
// model is never silently under-quoted. Note this is NOT the ceiling: Fable
// is priced 2x Opus, so a future above-Opus family would still be under-quoted
// here until it's given exact/family-tier pricing.
export const CONSERVATIVE_DEFAULT = FAMILY_TIER_PRICING.opus

/**
 * Read the `model-pricing-overrides` settings row (JSON string, no migration —
 * `settings` is already key/text). Missing / malformed -> {} and never throws,
 * matching the house degradation style (queryRewrite.ts / rerank.ts).
 *
 * Per-entry shape validation: a hand-authored settings row can contain
 * anything JSON allows (a bare string, a partial object, non-numeric rates,
 * etc). Costs resolved from an override are frozen into DB rows downstream, so
 * an unvalidated entry (e.g. {"claude-opus-4-8":"free"} or {"input":5}) would
 * permanently corrupt cost data via NaN rather than just failing loudly. Each
 * entry is kept only when both rates are present and `Number.isFinite`;
 * anything else is dropped (falls through to exact/family pricing) with a
 * `console.warn` naming the model id.
 */
export async function loadPricingOverrides(): Promise<PricingOverrides> {
  try {
    const raw = await getServerSetting(PRICING_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const validated: PricingOverrides = {}
    for (const [modelId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const rates = entry as { inputPerMTok?: unknown; outputPerMTok?: unknown; cacheReadPerMTok?: unknown } | null
      if (
        rates &&
        typeof rates === 'object' &&
        !Array.isArray(rates) &&
        Number.isFinite(rates.inputPerMTok) &&
        Number.isFinite(rates.outputPerMTok)
      ) {
        validated[modelId] = { inputPerMTok: rates.inputPerMTok as number, outputPerMTok: rates.outputPerMTok as number }
        // Optional; a non-finite value is dropped and cache hits fall back to
        // the standard 0.1x multiplier.
        if (Number.isFinite(rates.cacheReadPerMTok)) validated[modelId].cacheReadPerMTok = rates.cacheReadPerMTok as number
      } else {
        console.warn(`[models/pricing] malformed override entry for model "${modelId}", dropping`)
      }
    }
    return validated
  } catch (error) {
    console.warn('[models/pricing] malformed model-pricing-overrides setting, ignoring', error)
    return {}
  }
}

/**
 * Resolve pricing for a model. Resolution order (highest first):
 * DB override -> exact-id table -> family tier (estimated) -> conservative
 * Opus-tier default (estimated, warns). Override and exact-id hits are NOT
 * estimated; family-tier and conservative-default hits ARE.
 *
 * Override and exact lookups try the id itself, then its bare alias (audit
 * B19): the live catalog can ship a family only as a dated snapshot
 * (`claude-haiku-4-5-20251001`), while both tables are keyed by alias. An
 * entry for the exact dated id still wins over one for its alias.
 */
export function resolvePricing(modelId: string, family: string, overrides: PricingOverrides): ModelPricing {
  const alias = modelId.replace(DATED_SNAPSHOT_RE, '')

  const override = overrides[modelId] ?? overrides[alias]
  if (override) {
    return { ...override, estimated: false }
  }

  const exact = EXACT_PRICING[modelId] ?? EXACT_PRICING[alias]
  if (exact) {
    return { ...exact, estimated: false }
  }

  const tier = FAMILY_TIER_PRICING[family]
  if (tier) {
    return { ...tier, estimated: true }
  }

  console.warn(`[models/pricing] unknown family "${family}" for model "${modelId}" — using conservative Opus-tier estimate`)
  return { ...CONSERVATIVE_DEFAULT, estimated: true }
}
