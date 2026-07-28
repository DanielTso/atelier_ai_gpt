import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWebSearch = vi.fn(() => ({ type: 'provider-defined', id: 'web_search' }))
const mockGoogleSearch = vi.fn(() => ({ type: 'provider-defined', id: 'google_search' }))

function mockProviders() {
  vi.doMock('@ai-sdk/anthropic', () => ({
    createAnthropic: () => Object.assign(
      (model: string) => ({ modelId: model, provider: 'anthropic' }),
      { tools: { webSearch_20250305: mockWebSearch } }
    ),
  }))
  vi.doMock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: () => Object.assign(
      (model: string) => ({ modelId: model, provider: 'google' }),
      { tools: { googleSearch: mockGoogleSearch } }
    ),
  }))
}

// createProvider() now derives effort support from the model registry instead
// of a `startsWith('claude-haiku')` guess — stub it in every case so no test
// hits the network (the real registry would call fetchAllAnthropicModels).
function mockRegistry(supportsEffort: boolean) {
  vi.doMock('@/lib/models/registry', () => ({
    getModelCapabilities: vi.fn().mockResolvedValue({
      supportsEffort,
      effortLevels: supportsEffort ? ['low', 'medium', 'high', 'xhigh', 'max'] : [],
      supportsThinking: true,
      supportsImageInput: false,
      supportsStructuredOutputs: true,
    }),
  }))
}

// For asserting per-LEVEL gating (not just per-model): a model can report
// supportsEffort:true while still excluding a specific level, e.g. a legacy
// pin (claude-sonnet-4-6) that predates `xhigh`.
function mockRegistryLevels(effortLevels: string[]) {
  const getModelCapabilities = vi.fn().mockResolvedValue({
    supportsEffort: effortLevels.length > 0,
    effortLevels,
    supportsThinking: true,
    supportsImageInput: false,
    supportsStructuredOutputs: true,
  })
  vi.doMock('@/lib/models/registry', () => ({ getModelCapabilities }))
  return getModelCapabilities
}

describe('createProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('routes claude models to Anthropic with a web_search tool', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-opus-4-8')
    expect(result.model).toEqual({ modelId: 'claude-opus-4-8', provider: 'anthropic' })
    expect(result.tools).toHaveProperty('web_search')
    expect(mockWebSearch).toHaveBeenCalled()
  })

  it('claude with effort sets adaptive thinking AND effort', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-opus-4-8', 'high')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBe('high')
  })

  it('a model whose registry capabilities report supportsEffort:false OMITS effort but keeps adaptive thinking (e.g. Haiku 4.5)', async () => {
    mockProviders()
    mockRegistry(false)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-haiku-4-5', 'high')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBeUndefined()
  })

  it('an effort-supporting model INCLUDES effort in providerOptions', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-sonnet-5', 'xhigh')
    expect(result.providerOptions?.anthropic?.effort).toBe('xhigh')
  })

  it('an UNKNOWN model (registry returns the safe default) omits effort rather than throwing', async () => {
    mockProviders()
    // Mirrors registry.ts's SAFE_DEFAULT_CAPABILITIES for an unrecognized id —
    // getModelCapabilities() never throws, it degrades to all-false.
    mockRegistry(false)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-unknown-model-9', 'high')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBeUndefined()
  })

  it('claude with no effort still enables adaptive thinking', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-opus-4-8')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBeUndefined()
  })

  it('gates per LEVEL, not just per model: a legacy pin whose effortLevels excludes xhigh omits effort for xhigh but still applies high', async () => {
    mockProviders()
    // Mirrors buildLegacyPin (registry.ts) — claude-sonnet-4-6 predates xhigh.
    mockRegistryLevels(['low', 'medium', 'high', 'max'])
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')

    const xhighResult = await createProvider('claude-sonnet-4-6', 'xhigh')
    expect(xhighResult.providerOptions?.anthropic?.effort).toBeUndefined()
    expect(xhighResult.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })

    const highResult = await createProvider('claude-sonnet-4-6', 'high')
    expect(highResult.providerOptions?.anthropic?.effort).toBe('high')
  })

  it('short-circuits before calling getModelCapabilities when no effort is requested', async () => {
    mockProviders()
    const getModelCapabilities = mockRegistryLevels(['low', 'medium', 'high', 'xhigh', 'max'])
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    await createProvider('claude-opus-4-8')
    expect(getModelCapabilities).not.toHaveBeenCalled()
  })

  it('throws when claude selected but no Anthropic key', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    await expect(createProvider('claude-opus-4-8')).rejects.toThrow('Anthropic API Key is missing')
  })

  it('routes the gemini image model with TEXT+IMAGE modalities', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve('gemini-key'),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('gemini-3.1-flash-image')
    expect(result.providerOptions).toEqual({ google: { responseModalities: ['TEXT', 'IMAGE'] } })
  })

  it('routes internal gemini text with google_search grounding', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve('gemini-key'),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('gemini-3.5-flash')
    expect(result.tools).toHaveProperty('google_search')
  })

  it('throws for an unknown provider', async () => {
    mockProviders()
    mockRegistry(true)
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('k'),
      getGeminiApiKey: () => Promise.resolve('k'),
    }))
    const { createProvider } = await import('@/lib/providers')
    await expect(createProvider('llama3')).rejects.toThrow('Unknown model provider')
  })
})
