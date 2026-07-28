import { describe, it, expect } from 'vitest'
import { parseFamily, curateCatalog } from '@/lib/models/curate'
import type { CatalogModel } from '@/lib/models/types'

function model(overrides: Partial<CatalogModel> & Pick<CatalogModel, 'id' | 'family'>): CatalogModel {
  return {
    name: overrides.id,
    provider: 'anthropic',
    createdAt: '2026-01-01T00:00:00Z',
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high'],
      supportsThinking: true,
      supportsImageInput: true,
      supportsStructuredOutputs: true,
    },
    pricing: { inputPerMTok: 1, outputPerMTok: 1, estimated: false },
    ...overrides,
  }
}

describe('parseFamily', () => {
  it('extracts the lowercase family segment after claude-', () => {
    expect(parseFamily('claude-opus-4-8')).toBe('opus')
    expect(parseFamily('claude-haiku-4-5')).toBe('haiku')
    expect(parseFamily('CLAUDE-SONNET-5')).toBe('sonnet')
  })

  it('returns "other" for non-claude / unrecognized ids', () => {
    expect(parseFamily('gemini-3.1-flash-image')).toBe('other')
    expect(parseFamily('mystery-model')).toBe('other')
  })
})

describe('curateCatalog', () => {
  it('excludes dated snapshots from a family that also has an undated alias', () => {
    const models = [
      model({ id: 'claude-opus-4-8', family: 'opus', createdAt: '2026-05-01T00:00:00Z' }),
      model({ id: 'claude-opus-4-1-20250805', family: 'opus', createdAt: '2026-06-01T00:00:00Z' }),
    ]
    const curated = curateCatalog(models)
    expect(curated).toHaveLength(1)
    expect(curated[0].id).toBe('claude-opus-4-8')
  })

  it('keeps only the newest model per family', () => {
    const models = [
      model({ id: 'claude-sonnet-4-6', family: 'sonnet', createdAt: '2026-01-01T00:00:00Z' }),
      model({ id: 'claude-sonnet-5', family: 'sonnet', createdAt: '2026-06-01T00:00:00Z' }),
    ]
    const curated = curateCatalog(models)
    expect(curated).toHaveLength(1)
    expect(curated[0].id).toBe('claude-sonnet-5')
  })

  it('falls back to dated snapshots when a family has ONLY dated entries', () => {
    const models = [
      model({ id: 'claude-opus-4-1-20250805', family: 'opus', createdAt: '2026-01-01T00:00:00Z' }),
      model({ id: 'claude-opus-4-1-20250910', family: 'opus', createdAt: '2026-03-01T00:00:00Z' }),
    ]
    const curated = curateCatalog(models)
    expect(curated).toHaveLength(1)
    expect(curated[0].id).toBe('claude-opus-4-1-20250910')
  })

  it('sorts an unknown family last', () => {
    const models = [
      model({ id: 'claude-nova-3', family: 'nova' }),
      model({ id: 'claude-haiku-4-5', family: 'haiku' }),
      model({ id: 'claude-opus-4-8', family: 'opus' }),
    ]
    const curated = curateCatalog(models)
    expect(curated.map(m => m.family)).toEqual(['opus', 'haiku', 'nova'])
  })

  it('orders known families opus -> fable -> sonnet -> haiku', () => {
    const models = [
      model({ id: 'claude-haiku-4-5', family: 'haiku' }),
      model({ id: 'claude-sonnet-5', family: 'sonnet' }),
      model({ id: 'claude-fable-5', family: 'fable' }),
      model({ id: 'claude-opus-4-8', family: 'opus' }),
    ]
    const curated = curateCatalog(models)
    expect(curated.map(m => m.family)).toEqual(['opus', 'fable', 'sonnet', 'haiku'])
  })

  it('returns [] for empty input', () => {
    expect(curateCatalog([])).toEqual([])
  })

  it('keeps input order when two same-family candidates have an identical createdAt (stable-sort tie-break)', () => {
    const models = [
      model({ id: 'claude-opus-4-8', family: 'opus', createdAt: '2026-05-01T00:00:00Z' }),
      model({ id: 'claude-opus-4-8-alt', family: 'opus', createdAt: '2026-05-01T00:00:00Z' }),
    ]
    const curated = curateCatalog(models)
    expect(curated).toHaveLength(1)
    expect(curated[0].id).toBe('claude-opus-4-8')
  })

  it('sorts a null createdAt last within its own family pool', () => {
    const models = [
      model({ id: 'claude-opus-4-8', family: 'opus', createdAt: null }),
      model({ id: 'claude-opus-4-8-newer', family: 'opus', createdAt: '2026-05-01T00:00:00Z' }),
    ]
    const curated = curateCatalog(models)
    expect(curated).toHaveLength(1)
    expect(curated[0].id).toBe('claude-opus-4-8-newer')
  })

  it('orders two unrecognized families newest-first relative to each other, both sorted after known families', () => {
    const models = [
      model({ id: 'claude-nova-3', family: 'nova', createdAt: '2026-01-01T00:00:00Z' }),
      model({ id: 'claude-comet-1', family: 'comet', createdAt: '2026-06-01T00:00:00Z' }),
      model({ id: 'claude-opus-4-8', family: 'opus', createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const curated = curateCatalog(models)
    expect(curated.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-comet-1', 'claude-nova-3'])
  })
})
