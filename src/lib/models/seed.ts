import type { CatalogModel } from './types'

// Hand-authored fallback catalog — used whenever the live Anthropic models API
// is unreachable (no key, network failure, non-2xx, MAX_PAGES exceeded) so the
// picker is NEVER empty. Mirrors today's hardcoded list (the one this feature
// replaces) in src/app/api/models/route.ts: Opus 4.8 first (-> default), then
// Fable 5, Sonnet 5, Haiku 4.5. `createdAt`/`contextWindow`/`maxOutput` are
// unknown without a live catalog fetch, so they're `null` here — curateCatalog
// only needs `createdAt` to break ties within a family, and the seed already
// has exactly one entry per family.
export const STATIC_SEED: CatalogModel[] = [
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    family: 'opus',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsThinking: true,
      supportsImageInput: true,
      supportsStructuredOutputs: true,
    },
    pricing: { inputPerMTok: 5, outputPerMTok: 25, estimated: false },
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    family: 'fable',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsThinking: true,
      supportsImageInput: true,
      supportsStructuredOutputs: true,
    },
    pricing: { inputPerMTok: 10, outputPerMTok: 50, estimated: false },
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    family: 'sonnet',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsThinking: true,
      supportsImageInput: true,
      supportsStructuredOutputs: true,
    },
    pricing: { inputPerMTok: 3, outputPerMTok: 15, estimated: false },
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    family: 'haiku',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      // Haiku 400s on the effort param (see providers.ts's existing special
      // case) — never offer effort levels for it.
      supportsEffort: false,
      effortLevels: [],
      supportsThinking: true,
      supportsImageInput: true,
      supportsStructuredOutputs: true,
    },
    pricing: { inputPerMTok: 1, outputPerMTok: 5, estimated: false },
  },
]

// Ids no longer offered in the curated picker (superseded by a newer family
// member) but that must keep routing for chats/personas already pinned to
// them — never rejected by validation, never re-curated into the picker.
export const LEGACY_PINS = ['claude-sonnet-4-6'] as const

// Gemini is not discovered live (design spec non-goal — no per-token catalog
// need beyond the one image model + the internal utility model). Static.
export const GEMINI_MODELS: CatalogModel[] = [
  {
    id: 'gemini-3.1-flash-image',
    name: 'Nano Banana 2',
    family: 'nano-banana',
    provider: 'google',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: false,
      effortLevels: [],
      supportsThinking: false,
      supportsImageInput: true,
      supportsStructuredOutputs: false,
    },
    // Per-image, not per-token (design spec non-goal: Nano Banana cost is its
    // own pass) — zeroed out here rather than a misleading per-token estimate.
    pricing: { inputPerMTok: 0, outputPerMTok: 0, estimated: true },
  },
]
