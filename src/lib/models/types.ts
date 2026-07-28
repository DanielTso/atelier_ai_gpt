// Dynamic Model Registry — pure primitive types (Task 1 of the design spec at
// docs/specs/2026-07-21-dynamic-model-registry-design.md). No I/O here.

// Effort/ModelCapabilities/ModelPricing live in `@/types` (the shared module the
// client also reads) and are re-exported here so registry code can import
// everything it needs from one place.
export type { Effort, ModelCapabilities, ModelPricing } from '@/types'
import type { ModelCapabilities, ModelPricing } from '@/types'

export type ModelTier = 'flagship' | 'opus' | 'sonnet' | 'haiku'

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
