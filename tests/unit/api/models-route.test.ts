import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CatalogModel } from '@/lib/models/types'

// The route is now a thin registry adapter (Task 6) — mock the registry
// itself instead of `@/lib/settings`, and hand it a canned `curated` list
// per test so the route's own mapping/ordering is what's under test, not
// key-gating logic (that lives in registry.test.ts).

const claudeCapabilities = {
  supportsEffort: true,
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as const,
  supportsThinking: true,
  supportsImageInput: true,
  supportsStructuredOutputs: true,
}

const claudePricing = { inputPerMTok: 5, outputPerMTok: 25, estimated: false }

function claudeModel(id: string, name: string, family: string): CatalogModel {
  return {
    id,
    name,
    family,
    provider: 'anthropic',
    createdAt: null,
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: { ...claudeCapabilities, effortLevels: [...claudeCapabilities.effortLevels] },
    pricing: { ...claudePricing },
  }
}

const opus = claudeModel('claude-opus-4-8', 'Claude Opus 4.8', 'opus')
const fable = claudeModel('claude-fable-5', 'Claude Fable 5', 'fable')
const sonnet = claudeModel('claude-sonnet-5', 'Claude Sonnet 5', 'sonnet')
const haiku = claudeModel('claude-haiku-4-5', 'Claude Haiku 4.5', 'haiku')

const nanoBanana: CatalogModel = {
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
  pricing: { inputPerMTok: 0, outputPerMTok: 0, estimated: false },
}

describe('GET /api/models', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockRegistry(curated: CatalogModel[]) {
    vi.doMock('@/lib/models/registry', () => ({
      getModelRegistry: () => Promise.resolve({
        curated,
        byId: new Map(curated.map((m) => [m.id, m])),
        source: 'live',
      }),
    }))
  }

  it('lists Claude models (Opus first) when the registry curates them', async () => {
    mockRegistry([opus, fable, sonnet, haiku])
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    expect(data.models[0].model).toBe('claude-opus-4-8')
    const ids = data.models.map((m: { model: string }) => m.model)
    expect(ids).toContain('claude-fable-5')
    expect(ids).toContain('claude-sonnet-5')
    expect(ids).toContain('claude-haiku-4-5')
    // Sonnet 4.6 is retired from the picker (superseded by Sonnet 5)
    expect(ids).not.toContain('claude-sonnet-4-6')
  })

  it('includes Nano Banana only when the registry curates it, no Gemini text models', async () => {
    mockRegistry([opus, fable, sonnet, haiku, nanoBanana])
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    const ids = data.models.map((m: { model: string }) => m.model)
    expect(ids).toContain('gemini-3.1-flash-image')
    expect(ids.some((id: string) => id.startsWith('gemini') && !id.includes('image'))).toBe(false)
  })

  it('returns no models when the registry curates nothing (no keys set)', async () => {
    mockRegistry([])
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    expect(data.models).toHaveLength(0)
  })

  it('sets cache-control header', async () => {
    mockRegistry([opus])
    const { GET } = await import('@/app/api/models/route')
    const response = await GET()
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('response rows carry capabilities, pricing, provider, and family', async () => {
    mockRegistry([opus, nanoBanana])
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    const claudeRow = data.models.find((m: { model: string }) => m.model === 'claude-opus-4-8')
    expect(claudeRow.provider).toBe('anthropic')
    expect(claudeRow.family).toBe('opus')
    expect(claudeRow.capabilities).toMatchObject({
      supportsEffort: true,
      effortLevels: expect.arrayContaining(['xhigh']),
    })
    expect(claudeRow.pricing).toMatchObject({ inputPerMTok: 5, outputPerMTok: 25, estimated: false })

    const geminiRow = data.models.find((m: { model: string }) => m.model === 'gemini-3.1-flash-image')
    expect(geminiRow.provider).toBe('google')
    expect(geminiRow.pricing).toMatchObject({ estimated: false })
  })
})
