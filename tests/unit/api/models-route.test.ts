import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/models', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockKeys({ anthropic = null as string | null, gemini = null as string | null } = {}) {
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(anthropic),
      getGeminiApiKey: () => Promise.resolve(gemini),
    }))
  }

  it('lists Claude models (Opus first) when Anthropic key is set', async () => {
    mockKeys({ anthropic: 'a-key' })
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    expect(data.models[0].model).toBe('claude-opus-4-8')
    const ids = data.models.map((m: { model: string }) => m.model)
    expect(ids).toContain('claude-sonnet-4-6')
    expect(ids).toContain('claude-haiku-4-5')
  })

  it('includes Nano Banana when Gemini key is set, no Gemini text models', async () => {
    mockKeys({ anthropic: 'a-key', gemini: 'g-key' })
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    const ids = data.models.map((m: { model: string }) => m.model)
    expect(ids).toContain('gemini-3.1-flash-image')
    expect(ids.some((id: string) => id.startsWith('gemini') && !id.includes('image'))).toBe(false)
  })

  it('returns no models when no keys are set', async () => {
    mockKeys()
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    expect(data.models).toHaveLength(0)
  })

  it('sets cache-control header', async () => {
    mockKeys({ anthropic: 'a-key' })
    const { GET } = await import('@/app/api/models/route')
    const response = await GET()
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  })
})
