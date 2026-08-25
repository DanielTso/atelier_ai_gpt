// Dynamic Model Registry — pure primitive types (Task 1 of the design spec at
// docs/specs/2026-07-21-dynamic-model-registry-design.md). No I/O here.

// Effort/ModelCapabilities/ModelPricing live in `@/types` (the shared module the
// client also reads) and are re-exported here so registry code can import
// everything it needs from one place.
export type { Effort, ModelCapabilities, ModelPricing } from '@/types'
import type { ModelCapabilities, ModelPricing } from '@/types'

export type ModelTier = 'flagship' | 'opus' | 'sonnet' | 'haiku'

// Runtime mirror of the ModelTier union (a `type` has no runtime
// representation). Shared by both sides of the client/server boundary: the
// server-only registry.ts (resolveRequestedModel's defensive backstop) and
// the 'use client' usePersonas.ts (resolvePersonaModel) both need to
// recognize a tier string — this file has no I/O, so it's safe for either.
export const MODEL_TIERS: readonly ModelTier[] = ['flagship', 'opus', 'sonnet', 'haiku']

export function isModelTier(value: string): value is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(value)
}

/**
 * Map a tier to the CatalogModel `family` it resolves against. 'flagship' is
 * the one irregular tier — it follows the 'fable' family, not a family
 * literally named 'flagship'; every other tier maps to its own name. This is
 * the semantic core of tiering, so it lives in exactly one place: the
 * server-only `resolveTier()` (registry.ts) and the client
 * `resolvePersonaModel()` (usePersonas.ts) both call this instead of each
 * carrying their own copy of the mapping.
 */
export function tierFamily(tier: ModelTier): string {
  return tier === 'flagship' ? 'fable' : tier
}

export interface CatalogModel {
  id: string
  name: string
  family: string
  provider: 'anthropic' | 'google'
  createdAt: string | null
  contextWindow: number | null
  maxOutput: number | null
  capabilities: ModelCapabilities
  pricing: ModelPricing
}
