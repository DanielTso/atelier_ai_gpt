import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.mock factories are hoisted above the module, so the mock fns must be
// created via vi.hoisted (matches tests/unit/lib/tavily.test.ts /
// tests/unit/lib/models/pricing.test.ts's idiom for mocking @/lib/settings).
// registry.ts imports getAnthropicApiKey/getGeminiApiKey directly, while
// pricing.ts's loadPricingOverrides (called internally by registry.ts) uses
// getServerSetting — all three live on the same mocked module.
const { getAnthropicApiKey, getGeminiApiKey, getServerSetting } = vi.hoisted(() => ({
  getAnthropicApiKey: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getServerSetting: vi.fn(),
}))
vi.mock('@/lib/settings', () => ({ getAnthropicApiKey, getGeminiApiKey, getServerSetting }))

import {
  getModelRegistry,
  clearModelRegistryCache,
  resolveRequestedModel,
  resolveTier,
  getModelCapabilities,
} from '@/lib/models/registry'

const OPUS_RAW = {
  id: 'claude-opus-4-8',
  display_name: 'Claude Opus 4.8',
  created_at: '2026-06-01T00:00:00Z',
  max_input_tokens: 200000,
  max_tokens: 64000,
  capabilities: {
    effort: {
      low: { supported: true },
      medium: { supported: true },
      high: { supported: true },
      xhigh: { supported: true },
      max: { supported: true },
    },
    thinking: { types: { adaptive: { supported: true } } },
    image_input: { supported: true },
    structured_outputs: { supported: true },
  },
}

const HAIKU_RAW = {
  id: 'claude-haiku-4-5',
  display_name: 'Claude Haiku 4.5',
  created_at: '2026-05-01T00:00:00Z',
  max_input_tokens: 200000,
  max_tokens: 32000,
  capabilities: {
    effort: {},
    thinking: { types: { adaptive: { supported: true } } },
    image_input: { supported: true },
    structured_outputs: { supported: true },
  },
}

// A dated legacy snapshot in a RECOGNIZED family (curateCatalog prefers the
// non-dated, newer OPUS_RAW within family 'opus') — proves a live-path model
// can stay routable via `byId` while being excluded from `curated` (the
// picker only ever surfaces one entry per family).
const DATED_OPUS_SNAPSHOT_RAW = {
  id: 'claude-opus-4-1-20250805',
  display_name: 'Claude Opus 4.1 (dated snapshot)',
  created_at: '2025-08-05T00:00:00Z',
  max_input_tokens: 200000,
  max_tokens: 32000,
  capabilities: {
    effort: { low: { supported: true }, medium: { supported: true }, high: { supported: true } },
    thinking: { types: { adaptive: { supported: true } } },
    image_input: { supported: true },
    structured_outputs: { supported: true },
  },
}

// Defensive-input fixtures for mapCapabilities() — missing, null, a scalar,
// and a null `effort` subtree all must degrade to false/[] rather than throw.
const NO_CAPS_RAW = {
  id: 'claude-no-caps',
  display_name: 'Claude No Caps',
  created_at: '2026-01-01T00:00:00Z',
  max_input_tokens: 100000,
  max_tokens: 8000,
  // `capabilities` intentionally omitted
}

const NULL_CAPS_RAW = {
  id: 'claude-null-caps',
  display_name: 'Claude Null Caps',
  created_at: '2026-01-01T00:00:00Z',
  max_input_tokens: 100000,
  max_tokens: 8000,
  capabilities: null,
}

const SCALAR_CAPS_RAW = {
  id: 'claude-scalar-caps',
  display_name: 'Claude Scalar Caps',
  created_at: '2026-01-01T00:00:00Z',
  max_input_tokens: 100000,
  max_tokens: 8000,
  capabilities: 'not-an-object',
}

const NULL_EFFORT_RAW = {
  id: 'claude-null-effort',
  display_name: 'Claude Null Effort',
  created_at: '2026-01-01T00:00:00Z',
  max_input_tokens: 100000,
  max_tokens: 8000,
  capabilities: {
    effort: null,
    thinking: { types: { adaptive: { supported: true } } },
    image_input: { supported: true },
    structured_outputs: { supported: true },
  },
}

function mockLivePage(data: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ data, has_more: false }) }
}

describe('models/registry', () => {
  beforeEach(() => {
    getAnthropicApiKey.mockReset()
    getGeminiApiKey.mockReset()
    getServerSetting.mockReset()
    getServerSetting.mockResolvedValue(null) // no pricing overrides by default
    getGeminiApiKey.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn())
    clearModelRegistryCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('getModelRegistry — live path', () => {
    it('normalizes the live catalog, curates it, and sets source "live"', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW, HAIKU_RAW]))

      const registry = await getModelRegistry()

      expect(registry.source).toBe('live')
      expect(registry.curated.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5'])

      const opus = registry.byId.get('claude-opus-4-8')
      expect(opus?.contextWindow).toBe(200000)
      expect(opus?.maxOutput).toBe(64000)
      expect(opus?.capabilities).toEqual({
        supportsEffort: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        supportsThinking: true,
        supportsImageInput: true,
        supportsStructuredOutputs: true,
      })
      expect(opus?.pricing).toEqual({ inputPerMTok: 5, outputPerMTok: 25, estimated: false })

      const haiku = registry.byId.get('claude-haiku-4-5')
      expect(haiku?.capabilities.supportsEffort).toBe(false)
      expect(haiku?.capabilities.effortLevels).toEqual([])
    })
  })

  describe('getModelRegistry — degradation', () => {
    it('falls back to STATIC_SEED (source "seed") when the live fetch fails', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const registry = await getModelRegistry()

      expect(registry.source).toBe('seed')
      expect(registry.curated.map(m => m.id)).toEqual([
        'claude-opus-4-8', 'claude-fable-5', 'claude-sonnet-5', 'claude-haiku-4-5',
      ])
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('returns zero Claude models and never calls fetch when there is no Anthropic key', async () => {
      getAnthropicApiKey.mockResolvedValue(null)
      const fetchMock = fetch as ReturnType<typeof vi.fn>

      const registry = await getModelRegistry()

      expect(registry.curated).toEqual([])
      expect([...registry.byId.values()].some(m => m.provider === 'anthropic')).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getModelRegistry — caching', () => {
    it('serves from cache within the live TTL (5 min) and refetches after it expires', async () => {
      vi.useFakeTimers()
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW]))

      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 4 * 60 * 1000 + 59 * 1000) // +4:59
      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(1) // still cached

      vi.setSystemTime(Date.now() + 2 * 1000) // past the 5:00 mark
      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(2) // expired, rebuilt
    })

    it('serves from cache within the seed TTL (60s) and refetches after it expires', async () => {
      vi.useFakeTimers()
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 59 * 1000)
      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(1) // still cached

      vi.setSystemTime(Date.now() + 2 * 1000) // past the 60s mark
      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(2) // expired, rebuilt
    })

    it('clearModelRegistryCache() forces an immediate rebuild', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW]))

      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      clearModelRegistryCache()
      await getModelRegistry()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('resolveRequestedModel', () => {
    it('returns the current default with usedFallback:false when no id is requested (omission is the normal default path, not a correction)', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW, HAIKU_RAW]))

      const result = await resolveRequestedModel(undefined)
      expect(result).toEqual({ modelId: 'claude-opus-4-8', usedFallback: false })
    })

    it('passes through a known id unchanged', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW, HAIKU_RAW]))

      const result = await resolveRequestedModel('claude-haiku-4-5')
      expect(result).toEqual({ modelId: 'claude-haiku-4-5', usedFallback: false })
    })

    it('falls back to the curated default and warns on an unknown id', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW, HAIKU_RAW]))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await resolveRequestedModel('claude-does-not-exist')
      expect(result).toEqual({ modelId: 'claude-opus-4-8', usedFallback: true })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude-does-not-exist'))
      warn.mockRestore()
    })

    it('never throws — resolves a legacy pin even when the live fetch fails', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      // claude-sonnet-4-6 is not in STATIC_SEED (it's the id superseded BY
      // Sonnet 5) so this only passes if buildLegacyPin() synthesizes it.
      const result = await resolveRequestedModel('claude-sonnet-4-6')
      expect(result).toEqual({ modelId: 'claude-sonnet-4-6', usedFallback: false })
    })

    it('passes through the Gemini model id unchanged', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      getGeminiApiKey.mockResolvedValue('gk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW]))

      const result = await resolveRequestedModel('gemini-3.1-flash-image')
      expect(result).toEqual({ modelId: 'gemini-3.1-flash-image', usedFallback: false })
    })
  })

  describe('getModelRegistry — DB failure degradation (M2: never throws)', () => {
    it('resolves (does not throw) when the Anthropic key read rejects, degrading to a no-key registry', async () => {
      getAnthropicApiKey.mockRejectedValue(new Error('db unavailable'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const registry = await getModelRegistry()
      expect(registry.curated).toEqual([])
      expect([...registry.byId.values()].some(m => m.provider === 'anthropic')).toBe(false)

      // resolveRequestedModel still returns a usable fallback, never a throw.
      const result = await resolveRequestedModel('claude-opus-4-8')
      expect(result).toEqual({ modelId: 'claude-opus-4-8', usedFallback: true })
      warn.mockRestore()
    })

    it('resolves (does not throw) when the Gemini key read rejects, degrading to zero Gemini entries', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      getGeminiApiKey.mockRejectedValue(new Error('db unavailable'))
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW]))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const registry = await getModelRegistry()
      expect(registry.curated.map(m => m.id)).toEqual(['claude-opus-4-8'])
      warn.mockRestore()
    })
  })

  describe('curated vs byId on the live path (byId is the superset)', () => {
    it('keeps a dated legacy snapshot routable via byId while curateCatalog excludes it from curated (the picker)', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW, DATED_OPUS_SNAPSHOT_RAW, HAIKU_RAW]))

      const registry = await getModelRegistry()

      expect(registry.byId.has('claude-opus-4-1-20250805')).toBe(true)
      expect(registry.curated.some(m => m.id === 'claude-opus-4-1-20250805')).toBe(false)
      // the undated, newer opus entry is the one that surfaces in the picker
      expect(registry.curated.some(m => m.id === 'claude-opus-4-8')).toBe(true)
    })
  })

  describe('mapCapabilities defensive inputs', () => {
    it('never throws on missing/null/scalar capabilities or a null effort subtree, and yields supportsEffort:false / effortLevels:[]', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([NO_CAPS_RAW, NULL_CAPS_RAW, SCALAR_CAPS_RAW, NULL_EFFORT_RAW]))

      const registry = await getModelRegistry()

      for (const id of ['claude-no-caps', 'claude-null-caps', 'claude-scalar-caps', 'claude-null-effort']) {
        const model = registry.byId.get(id)
        expect(model).toBeDefined()
        expect(model?.capabilities.supportsEffort).toBe(false)
        expect(model?.capabilities.effortLevels).toEqual([])
      }
    })
  })

  describe('resolveTier', () => {
    beforeEach(() => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) // -> STATIC_SEED
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it("'flagship' resolves to the newest 'fable'-family model", async () => {
      expect(await resolveTier('flagship')).toBe('claude-fable-5')
    })

    it("'opus'/'sonnet'/'haiku' resolve to their own family", async () => {
      expect(await resolveTier('opus')).toBe('claude-opus-4-8')
      expect(await resolveTier('sonnet')).toBe('claude-sonnet-5')
      expect(await resolveTier('haiku')).toBe('claude-haiku-4-5')
    })

    it('falls back to the literal default id (or the one Anthropic model present) and warns when curated is empty entirely', async () => {
      getAnthropicApiKey.mockResolvedValue(null) // -> curated is empty entirely
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(await resolveTier('opus')).toBe('claude-opus-4-8')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('opus'))
      warn.mockRestore()
    })

    it('falls back to the one model actually IN the registry (not the hardcoded default) when the requested family is absent but curated is non-empty', async () => {
      // Rebuilds the weak "empty curated" case above, which can't distinguish
      // the hardcoded fallback from a correct family match. A registry
      // containing ONLY haiku exercises the real "family absent, curated
      // non-empty" branch: resolveTier('opus') has no 'opus' family to find,
      // so it must fall through to the one Anthropic model that IS present
      // (claude-haiku-4-5), not silently succeed by coincidentally matching
      // the literal 'claude-opus-4-8' default.
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([HAIKU_RAW])) // only haiku, no opus
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(await resolveTier('opus')).toBe('claude-haiku-4-5')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('opus'))
      warn.mockRestore()
    })
  })

  describe('tier/default fallback never returns the image model (M3)', () => {
    it('resolveTier falls back to the literal Anthropic default, not Gemini, when only a Gemini key is configured', async () => {
      getAnthropicApiKey.mockResolvedValue(null)
      getGeminiApiKey.mockResolvedValue('gk-test') // -> curated === [nanoBanana] alone
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await resolveTier('opus')
      expect(result).toBe('claude-opus-4-8')
      expect(result).not.toBe('gemini-3.1-flash-image')
      warn.mockRestore()
    })

    it('resolveRequestedModel(undefined) falls back to the literal Anthropic default, not Gemini, when only a Gemini key is configured', async () => {
      getAnthropicApiKey.mockResolvedValue(null)
      getGeminiApiKey.mockResolvedValue('gk-test') // -> curated === [nanoBanana] alone

      const result = await resolveRequestedModel(undefined)
      expect(result).toEqual({ modelId: 'claude-opus-4-8', usedFallback: false })
    })
  })

  describe('getModelCapabilities', () => {
    it('returns the registry model’s capabilities for a known id', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW]))

      const caps = await getModelCapabilities('claude-opus-4-8')
      expect(caps.supportsEffort).toBe(true)
      expect(caps.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    })

    it('returns a safe all-false default and warns for an unknown id', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue(mockLivePage([OPUS_RAW]))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const caps = await getModelCapabilities('claude-does-not-exist')
      expect(caps).toEqual({
        supportsEffort: false,
        effortLevels: [],
        supportsThinking: false,
        supportsImageInput: false,
        supportsStructuredOutputs: false,
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude-does-not-exist'))
      warn.mockRestore()
    })
  })

  describe('repricing (Anthropic seed/legacy go through resolvePricing; non-Anthropic is carved out)', () => {
    it('prices seeded Sonnet 5 at the EXACT_PRICING rate, not the (stale) seed rate', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) // -> STATIC_SEED
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const registry = await getModelRegistry()
      const sonnet5 = registry.byId.get('claude-sonnet-5')
      // EXACT_PRICING (pricing.ts) is 2/10 introductory; STATIC_SEED's own
      // hardcoded field (seed.ts) has drifted to the stale 3/15 standing rate.
      expect(sonnet5?.pricing).toEqual({ inputPerMTok: 2, outputPerMTok: 10, estimated: false })
    })

    it('prices a synthesized legacy pin via resolvePricing (family-tier, since it has no hardcoded field to drift from)', async () => {
      getAnthropicApiKey.mockResolvedValue('sk-test')
      const fetchMock = fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) // -> STATIC_SEED
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const registry = await getModelRegistry()
      const legacySonnet = registry.byId.get('claude-sonnet-4-6')
      // Not in EXACT_PRICING (deliberately — retired ids fall through to the
      // family tier) -> sonnet family tier, estimated.
      expect(legacySonnet?.pricing).toEqual({ inputPerMTok: 3, outputPerMTok: 15, estimated: true })
    })

    it('leaves the Gemini seed entry\'s 0/0 "not token-priced" sentinel untouched (token-priced carve-out)', async () => {
      getAnthropicApiKey.mockResolvedValue(null)
      getGeminiApiKey.mockResolvedValue('gk-test')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const registry = await getModelRegistry()
      const nanoBanana = registry.byId.get('gemini-3.1-flash-image')
      // Nano Banana is priced per-image, not per-token (design non-goal) —
      // repriceModel() must skip non-Anthropic models entirely rather than
      // running them through resolvePricing(), which would (a) replace the
      // seed's deliberate 0/0 sentinel with a fabricated Opus-tier estimate,
      // rendered as "$5 / $25 est." in a picker for an image model, and
      // (b) fire the unknown-family warn on every registry build.
      expect(nanoBanana?.pricing).toEqual({ inputPerMTok: 0, outputPerMTok: 0, estimated: true })
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('unknown family'))
      warn.mockRestore()
    })
  })
})
