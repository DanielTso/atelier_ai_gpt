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

describe('createProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('routes claude models to Anthropic with a web_search tool', async () => {
    mockProviders()
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
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-opus-4-8', 'high')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBe('high')
  })

  it('haiku OMITS effort (API rejects it) but keeps adaptive thinking', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-haiku-4-5', 'high')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBeUndefined()
  })

  it('claude with no effort still enables adaptive thinking', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-opus-4-8')
    expect(result.providerOptions?.anthropic?.thinking).toEqual({ type: 'adaptive' })
    expect(result.providerOptions?.anthropic?.effort).toBeUndefined()
  })

  it('throws when claude selected but no Anthropic key', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    await expect(createProvider('claude-opus-4-8')).rejects.toThrow('Anthropic API Key is missing')
  })

  it('routes the gemini image model with TEXT+IMAGE modalities', async () => {
    mockProviders()
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
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('k'),
      getGeminiApiKey: () => Promise.resolve('k'),
    }))
    const { createProvider } = await import('@/lib/providers')
    await expect(createProvider('llama3')).rejects.toThrow('Unknown model provider')
  })
})
