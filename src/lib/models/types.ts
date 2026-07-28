// Dynamic Model Registry — pure primitive types (Task 1 of the design spec at
// docs/specs/2026-07-21-dynamic-model-registry-design.md). No I/O here.

// Effort union declared LOCALLY for now. Task 3 moves this to the shared
// `@/types` module (consolidating the two existing copies in providers.ts and
// usePersonas.ts, adding `xhigh`) — this ordering is intentional: the registry
// primitives land first, the shared-type consolidation is a separate task.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ModelTier = 'flagship' | 'opus' | 'sonnet' | 'haiku'

export interface ModelCapabilities {
  supportsEffort: boolean
  effortLevels: Effort[]
  supportsThinking: boolean
  supportsImageInput: boolean
  supportsStructuredOutputs: boolean
}

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  estimated: boolean
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
