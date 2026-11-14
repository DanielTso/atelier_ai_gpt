import type { CatalogModel, ModelCapabilities } from './types'

// Hand-authored fallback catalog — used only when the live Anthropic models
// API has never answered in this process (no key, network failure, non-2xx,
// MAX_PAGES exceeded); once a live build has succeeded, a failed refresh
// serves that last live catalog marked `stale` instead (registry.ts). Lists
// the current newest model per family from the claude-api skill's model table
// (cached 2026-11-03): Opus 5.5 first (-> default), then Fable 5.2, Sonnet
// 5.5, Haiku 5.5. `createdAt`/`contextWindow`/`maxOutput` are unknown without
// a live catalog fetch, so they're `null` here — curateCatalog only needs
// `createdAt` to break ties within a family, and the seed already has exactly
// one entry per family. `pricing` is re-derived from pricing.ts on every
// build (repriceModel); the copy here only keeps the type complete.
//
// All four take adaptive thinking (on by default) and effort low..max (Haiku
// 5.5 included, unlike Haiku 4.5, which takes neither).
const CURRENT_CAPABILITIES: ModelCapabilities = {
  supportsEffort: true,
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsThinking: true,
  supportsImageInput: true,
  supportsStructuredOutputs: true,
}

export const STATIC_SEED: CatalogModel[] = [
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    family: 'opus',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: CURRENT_CAPABILITIES,
    pricing: { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, estimated: false },
  },
  {
    id: 'claude-fable-5-2',
    name: 'Claude Fable 5.2',
    family: 'fable',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: CURRENT_CAPABILITIES,
    pricing: { inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.2, estimated: false },
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    family: 'sonnet',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: CURRENT_CAPABILITIES,
    pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, estimated: false },
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    family: 'haiku',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: CURRENT_CAPABILITIES,
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5, estimated: false },
  },
]

// The previous seed generation, still served by Anthropic. Routable on the
// seed path (registry.ts adds them to `byId` only, never to `curated`) so an id
// a chat, persona or project default already holds keeps its own model during
// a cold-start outage instead of falling back to the default. Contract
// Abstract is pinned to the exact `claude-fable-5`. Haiku 4.5 takes neither
// effort nor adaptive thinking (it uses a manual thinking budget).
function previous(id: string, name: string, family: string, capabilities: ModelCapabilities): CatalogModel {
  return {
    id, name, family, provider: 'anthropic', createdAt: null, contextWindow: null, maxOutput: null, capabilities,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, estimated: true }, // re-derived by repriceModel
  }
}
export const SEED_ROUTABLE: CatalogModel[] = [
  previous('claude-opus-4-8', 'Claude Opus 4.8', 'opus', CURRENT_CAPABILITIES),
  previous('claude-fable-5', 'Claude Fable 5', 'fable', CURRENT_CAPABILITIES),
  previous('claude-sonnet-5', 'Claude Sonnet 5', 'sonnet', CURRENT_CAPABILITIES),
  previous('claude-haiku-4-5', 'Claude Haiku 4.5', 'haiku', {
    supportsEffort: false,
    effortLevels: [],
    supportsThinking: false,
    supportsImageInput: true,
    supportsStructuredOutputs: true,
  }),
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
