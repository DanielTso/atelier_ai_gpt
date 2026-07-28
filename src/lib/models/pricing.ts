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
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
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
// Opus tier — conservative so an unknown model is never silently under-quoted.
export const CONSERVATIVE_DEFAULT = FAMILY_TIER_PRICING.opus

/**
 * Read the `model-pricing-overrides` settings row (JSON string, no migration —
 * `settings` is already key/text). Missing / malformed -> {} and never throws,
 * matching the house degradation style (queryRewrite.ts / rerank.ts).
 */
export async function loadPricingOverrides(): Promise<PricingOverrides> {
  try {
    const raw = await getServerSetting(PRICING_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as PricingOverrides
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
