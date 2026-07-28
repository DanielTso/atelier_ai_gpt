import { getServerSetting } from '@/lib/settings'
import type { ModelPricing } from './types'

const PRICING_OVERRIDES_KEY = 'model-pricing-overrides'

export type PricingOverrides = Record<string, { inputPerMTok: number; outputPerMTok: number }>

// Exact per-model pricing ($ / million tokens). Enumerate CURRENT ids only —
// a retired id (e.g. claude-sonnet-4-6) intentionally falls through to its
// family tier below rather than being hand-maintained forever.
export const EXACT_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  // Introductory pricing through 2026-08-31 (standing rate is 3/15, reverting
  // automatically after that date). Costs are frozen into DB rows at write
  // time, so the intro rate is the more accurate figure for spend today. If
  // this drifts, the `model-pricing-overrides` settings row can correct it
  // without a deploy.
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
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
      const rates = entry as { inputPerMTok?: unknown; outputPerMTok?: unknown } | null
      if (
        rates &&
        typeof rates === 'object' &&
        !Array.isArray(rates) &&
        Number.isFinite(rates.inputPerMTok) &&
        Number.isFinite(rates.outputPerMTok)
      ) {
        validated[modelId] = { inputPerMTok: rates.inputPerMTok as number, outputPerMTok: rates.outputPerMTok as number }
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
 */
export function resolvePricing(modelId: string, family: string, overrides: PricingOverrides): ModelPricing {
  const override = overrides[modelId]
  if (override) {
    return { inputPerMTok: override.inputPerMTok, outputPerMTok: override.outputPerMTok, estimated: false }
  }

  const exact = EXACT_PRICING[modelId]
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
