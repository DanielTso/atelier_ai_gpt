import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/models', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockSettings(apiKey: string | null = 'test-key') {
    vi.doMock('@/lib/settings', () => ({
      getGeminiApiKey: () => Promise.resolve(apiKey),
    }))
  }

  it('returns Gemini models when API key is set', async () => {
    mockSettings()

    const { GET } = await import('@/app/api/models/route')
    const response = await GET()
    const data = await response.json()

    expect(data.models.length).toBeGreaterThanOrEqual(5)
    expect(data.models.every((m: { model: string }) => m.model.startsWith('gemini'))).toBe(true)
  })

  it('excludes models when no API key', async () => {
    mockSettings(null)

    const { GET } = await import('@/app/api/models/route')
    const response = await GET()
    const data = await response.json()

    expect(data.models).toHaveLength(0)
  })

  it('sets cache-control header', async () => {
    mockSettings()

    const { GET } = await import('@/app/api/models/route')
    const response = await GET()

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  })
})
