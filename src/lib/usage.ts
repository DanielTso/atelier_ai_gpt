import type { LanguageModelUsage } from 'ai'
import { db } from '@/db'
import { usageEvents } from '@/db/schema'
import { getModelRegistry } from '@/lib/models/registry'
import { loadPricingOverrides, resolvePricing } from '@/lib/models/pricing'
import { parseFamily } from '@/lib/models/curate'
import type { ModelPricing } from '@/lib/models/types'

// Usage capture (spec C6): one usage_events row per LLM generation, with the
// cost computed and FROZEN at write time. Everything here is best-effort — a
// usage-write failure must never fail the request that generated the tokens.

export type UsagePurpose =
  | 'chat'
  | 'artifact-regenerate'
  | 'summarize'
  | 'generate-title'
  | 'classify'
  | 'memory-suggest'

// Prompt-cache pricing multipliers relative to the fresh-input rate
// (Anthropic: cache read ~0.1x, cache write ~1.25x).
export const CACHE_READ_RATE = 0.1
export const CACHE_WRITE_RATE = 1.25

// Sentinel for a model this feature deliberately does not token-price: the
// internal gemini-3.5-flash housekeeping model (and any other non-Anthropic id
// the registry doesn't carry). Gemini pricing is a spec non-goal — record the
// tokens, freeze cost 0, and mark it estimated, mirroring seed.ts's zeroed
// Nano Banana pricing rather than fabricating an Opus-tier figure.
const UNPRICED: ModelPricing = { inputPerMTok: 0, outputPerMTok: 0, estimated: true }

interface TokenBreakdown {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/**
 * Split an AI SDK usage object into the four MUTUALLY EXCLUSIVE counts the
 * usage_events columns store. Accounting fact (settled against the installed
 * @ai-sdk/anthropic@3.0.98 source, dist/index.mjs:1869-1875, and confirmed on
 * a live call): the SDK's `usage.inputTokens` is the INCLUSIVE sum
 * fresh + cacheRead + cacheWrite — Anthropic reports the three counts as
 * mutually exclusive, but the SDK sums them. `inputTokenDetails.noCacheTokens`
 * IS the fresh input; when it's absent, fresh is derived by subtracting the
 * cache counts from the inclusive total — `usage.inputTokens` is NEVER used
 * raw (that would double-count every cached token in both tokens and cost).
 * (`usage.cachedInputTokens` is deprecated in this SDK version — not read.)
 */
export function usageTokens(usage: LanguageModelUsage | undefined): TokenBreakdown {
  const cacheReadTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheCreationTokens = usage?.inputTokenDetails?.cacheWriteTokens ?? 0
  const inputTokens =
    usage?.inputTokenDetails?.noCacheTokens ??
    (usage?.inputTokens != null ? Math.max(0, usage.inputTokens - cacheReadTokens - cacheCreationTokens) : 0)
  return {
    inputTokens,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens,
    cacheCreationTokens,
  }
}

// Identity element for the sumUsage reduce: every count absent, so seeding
// contributes nothing (addCounts(undefined, x) === x) while guaranteeing the
// result is always a newly built object with the full shape.
const EMPTY_USAGE: LanguageModelUsage = {
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
}

// Add two optional counts: undefined only when BOTH are absent, so a field no
// step reported stays absent instead of becoming a misleading 0.
function addCounts(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined
  return (a ?? 0) + (b ?? 0)
}

/**
 * Sum the usage of several completed steps into one LanguageModelUsage (the
 * shape recordUsage/usageTokens already consume). Used by the chat route's
 * onAbort — the SDK hands it `steps[]` (each with its own usage) but no
 * totalUsage, since the run never finished. Undefined when no step has usage.
 */
export function sumUsage(usages: Array<LanguageModelUsage | undefined>): LanguageModelUsage | undefined {
  const present = usages.filter((u): u is LanguageModelUsage => u != null)
  if (present.length === 0) return undefined
  // Seeded so a single-step run returns a fresh, fully-normalized object rather
  // than aliasing steps[0].usage (a caller must never be able to mutate the
  // SDK's own step record through the returned value). addCounts(undefined, x)
  // is x, so seeding changes no sum.
  return present.reduce((acc, u) => ({
    inputTokens: addCounts(acc.inputTokens, u.inputTokens),
    outputTokens: addCounts(acc.outputTokens, u.outputTokens),
    totalTokens: addCounts(acc.totalTokens, u.totalTokens),
    inputTokenDetails: {
      noCacheTokens: addCounts(acc.inputTokenDetails?.noCacheTokens, u.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: addCounts(acc.inputTokenDetails?.cacheReadTokens, u.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: addCounts(acc.inputTokenDetails?.cacheWriteTokens, u.inputTokenDetails?.cacheWriteTokens),
    },
    outputTokenDetails: {
      textTokens: addCounts(acc.outputTokenDetails?.textTokens, u.outputTokenDetails?.textTokens),
      reasoningTokens: addCounts(acc.outputTokenDetails?.reasoningTokens, u.outputTokenDetails?.reasoningTokens),
    },
  }), EMPTY_USAGE)
}

/**
 * Frozen-at-write-time cost in USD. Rates are per million tokens:
 *
 *   cost = fresh      x inputRate
 *        + cacheRead  x inputRate x 0.10
 *        + cacheWrite x inputRate x 1.25
 *        + output     x outputRate
 */
export function estimateCost(modelId: string, usage: LanguageModelUsage | undefined, pricing: ModelPricing): number {
  const t = usageTokens(usage)
  const cost =
    (t.inputTokens * pricing.inputPerMTok +
      t.cacheReadTokens * pricing.inputPerMTok * CACHE_READ_RATE +
      t.cacheCreationTokens * pricing.inputPerMTok * CACHE_WRITE_RATE +
      t.outputTokens * pricing.outputPerMTok) / 1_000_000
  if (!Number.isFinite(cost) || cost < 0) {
    console.warn(`[usage] non-finite/negative cost computed for model "${modelId}" — recording 0`)
    return 0
  }
  return cost
}

/**
 * Pricing for a usage row. registry.byId is the primary lookup — it indexes
 * dated AND bare-alias forms (several models are dated-only in the live
 * catalog, e.g. claude-haiku-4-5-20251001; a lookup that assumes a bare alias
 * silently billed Haiku as Opus earlier in this feature). A Claude id the
 * registry doesn't carry (degraded no-key registry state) still resolves
 * through the override -> exact -> family-tier chain; anything else is the
 * deliberately-unpriced sentinel (see UNPRICED).
 */
async function resolveUsagePricing(modelId: string): Promise<ModelPricing> {
  const registry = await getModelRegistry()
  const known = registry.byId.get(modelId)
  if (known) return known.pricing
  if (modelId.startsWith('claude-')) {
    return resolvePricing(modelId, parseFamily(modelId), await loadPricingOverrides())
  }
  return UNPRICED
}

export interface RecordUsageArgs {
  chatId?: number | null
  projectId?: number | null
  purpose: UsagePurpose
  model: string
  usage: LanguageModelUsage | undefined
}

/**
 * Insert one usage_events row. BEST-EFFORT: never throws into a request path —
 * any failure (registry, pricing, DB) is swallowed with a console.warn. Call
 * sites fire-and-forget: `void recordUsage({...}).catch(() => {})`.
 *
 * The stored input_tokens is the FRESH (non-cached) count — see usageTokens()
 * and the column comment in src/db/schema.ts.
 */
export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  try {
    const pricing = await resolveUsagePricing(args.model)
    const tokens = usageTokens(args.usage)
    const costUsd = estimateCost(args.model, args.usage, pricing)
    await db.insert(usageEvents).values({
      chatId: args.chatId ?? null,
      projectId: args.projectId ?? null,
      purpose: args.purpose,
      model: args.model,
      ...tokens,
      costUsd,
      costEstimated: pricing.estimated,
    })
  } catch (error) {
    console.warn('[usage] failed to record usage event', error)
  }
}
