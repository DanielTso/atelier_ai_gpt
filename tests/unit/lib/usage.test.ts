import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import type { LanguageModelUsage } from 'ai'
import { createTestDb, testDb } from '../../helpers/test-db'
import { usageEvents } from '@/db/schema'
import type { CatalogModel, ModelPricing } from '@/lib/models/types'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

// Controllable registry: tests seed byId per case. The real registry is
// exercised by tests/unit/lib/models — here it's the pricing SOURCE, not the
// unit under test.
const mockById = new Map<string, CatalogModel>()
vi.mock('@/lib/models/registry', () => ({
  getModelRegistry: () => Promise.resolve({ curated: [], byId: mockById, source: 'seed' }),
}))

import { estimateCost, usageTokens, sumUsage, recordUsage, CACHE_READ_RATE, CACHE_WRITE_RATE } from '@/lib/usage'
import { createProject, createChat } from '@/app/actions'

const PRICING_OPUS: ModelPricing = { inputPerMTok: 5, outputPerMTok: 25, estimated: false }

function catalogEntry(id: string, pricing: ModelPricing): CatalogModel {
  return {
    id,
    name: id,
    family: 'opus',
    provider: 'anthropic',
    createdAt: null,
    contextWindow: null,
    maxOutput: null,
    capabilities: {
      supportsEffort: false,
      effortLevels: [],
      supportsThinking: false,
      supportsImageInput: false,
      supportsStructuredOutputs: false,
    },
    pricing,
  }
}

// Mirrors the live shape captured for this task (a real Haiku call):
// inputTokens is the SDK's INCLUSIVE total = noCache + cacheRead + cacheWrite.
function makeUsage(overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 1300,
    inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 200, cacheWriteTokens: 100 },
    outputTokens: 400,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: 1700,
    ...overrides,
  }
}

// Hand-derived from the spec formula with PRICING_OPUS (5/25 per MTok):
// 1000×5 + 200×5×0.10 + 100×5×1.25 + 400×25 = 5000+100+625+10000 = 15725 / 1e6.
const EXPECTED_COST = 0.015725
// What the double-counting bug would produce (1300 fresh instead of 1000):
// 1300×5 + 100 + 625 + 10000 = 17225 / 1e6.
const DOUBLE_COUNTED_COST = 0.017225

describe('usageTokens', () => {
  it('splits usage into four mutually exclusive counts, taking fresh from noCacheTokens', () => {
    expect(usageTokens(makeUsage())).toEqual({
      inputTokens: 1000,
      outputTokens: 400,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
    })
  })

  it('derives fresh input from the inclusive total when noCacheTokens is absent', () => {
    const usage = makeUsage({
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 200, cacheWriteTokens: 100 },
    })
    // 1300 (inclusive) - 200 - 100 = 1000 — inputTokens is never used raw.
    expect(usageTokens(usage).inputTokens).toBe(1000)
  })

  it('clamps a negative derivation to zero', () => {
    const usage = makeUsage({
      inputTokens: 100,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 200, cacheWriteTokens: 100 },
    })
    expect(usageTokens(usage).inputTokens).toBe(0)
  })

  it('treats every missing field as zero (usage undefined, or all-undefined fields)', () => {
    const zeros = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    expect(usageTokens(undefined)).toEqual(zeros)
    expect(usageTokens(makeUsage({
      inputTokens: undefined,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokens: undefined,
      totalTokens: undefined,
    }))).toEqual(zeros)
  })
})

describe('estimateCost', () => {
  it('prices fresh + cache read (x0.1) + cache write (x1.25) + output per MTok', () => {
    expect(CACHE_READ_RATE).toBe(0.1)
    expect(CACHE_WRITE_RATE).toBe(1.25)
    expect(estimateCost('claude-opus-4-8', makeUsage(), PRICING_OPUS)).toBeCloseTo(EXPECTED_COST, 12)
  })

  it('never uses the SDK inclusive inputTokens raw (no cache double-counting)', () => {
    const cost = estimateCost('claude-opus-4-8', makeUsage(), PRICING_OPUS)
    expect(cost).not.toBeCloseTo(DOUBLE_COUNTED_COST, 12)
  })

  it('is zero for an undefined usage', () => {
    expect(estimateCost('claude-opus-4-8', undefined, PRICING_OPUS)).toBe(0)
  })

  it('guards non-finite pricing to zero with a warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const bad: ModelPricing = { inputPerMTok: Number.NaN, outputPerMTok: 25, estimated: false }
      expect(estimateCost('claude-bogus', makeUsage(), bad)).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('claude-bogus'))
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('recordUsage', () => {
  beforeEach(async () => {
    await createTestDb()
    mockById.clear()
    mockById.set('claude-opus-4-8', catalogEntry('claude-opus-4-8', PRICING_OPUS))
  })

  it('inserts a row storing FRESH input tokens (not the SDK inclusive total) and a frozen cost', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    await recordUsage({ chatId: chat.id, projectId: project.id, purpose: 'chat', model: 'claude-opus-4-8', usage: makeUsage() })

    const rows = await testDb.select().from(usageEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      chatId: chat.id,
      projectId: project.id,
      purpose: 'chat',
      model: 'claude-opus-4-8',
      inputTokens: 1000, // fresh — NOT the inclusive 1300
      outputTokens: 400,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      costEstimated: false,
    })
    expect(rows[0].costUsd).toBeCloseTo(EXPECTED_COST, 8)
    // The three input columns reconstruct the SDK's inclusive total exactly.
    expect(rows[0].inputTokens + rows[0].cacheReadTokens + rows[0].cacheCreationTokens).toBe(1300)
  })

  it('propagates pricing.estimated into costEstimated', async () => {
    mockById.set('claude-sonnet-5-20991231', catalogEntry('claude-sonnet-5-20991231', { inputPerMTok: 3, outputPerMTok: 15, estimated: true }))

    await recordUsage({ chatId: null, projectId: null, purpose: 'chat', model: 'claude-sonnet-5-20991231', usage: makeUsage() })

    const rows = await testDb.select().from(usageEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0].costEstimated).toBe(true)
    expect(rows[0].costUsd).toBeCloseTo((1000 * 3 + 200 * 3 * 0.1 + 100 * 3 * 1.25 + 400 * 15) / 1e6, 8)
  })

  it('falls back to family-tier pricing for a Claude id the registry does not carry', async () => {
    // Not in mockById; parseFamily('claude-opus-9-...') = 'opus' -> tier 5/25, estimated.
    await recordUsage({ chatId: null, projectId: null, purpose: 'chat', model: 'claude-opus-9-20990101', usage: makeUsage() })

    const rows = await testDb.select().from(usageEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0].costUsd).toBeCloseTo(EXPECTED_COST, 8)
    expect(rows[0].costEstimated).toBe(true)
  })

  it('records tokens with cost 0 (estimated) for the unpriced internal Gemini model', async () => {
    await recordUsage({ chatId: null, projectId: null, purpose: 'classify', model: 'gemini-3.5-flash', usage: makeUsage() })

    const rows = await testDb.select().from(usageEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      model: 'gemini-3.5-flash',
      purpose: 'classify',
      inputTokens: 1000,
      outputTokens: 400,
      costUsd: 0,
      costEstimated: true,
    })
  })

  it('supports the Task 11 rollup: SUM of the mutually exclusive columns groups cleanly by model', async () => {
    await recordUsage({ chatId: null, projectId: null, purpose: 'chat', model: 'claude-opus-4-8', usage: makeUsage() })
    await recordUsage({ chatId: null, projectId: null, purpose: 'chat', model: 'claude-opus-4-8', usage: makeUsage() })
    await recordUsage({ chatId: null, projectId: null, purpose: 'summarize', model: 'gemini-3.5-flash', usage: makeUsage() })

    const rollup = await testDb
      .select({
        model: usageEvents.model,
        totalCost: sql<number>`sum(${usageEvents.costUsd})::float8`,
        totalInput: sql<number>`sum(${usageEvents.inputTokens} + ${usageEvents.cacheReadTokens} + ${usageEvents.cacheCreationTokens})::int`,
        totalOutput: sql<number>`sum(${usageEvents.outputTokens})::int`,
      })
      .from(usageEvents)
      .groupBy(usageEvents.model)
      .orderBy(usageEvents.model)

    expect(rollup).toEqual([
      { model: 'claude-opus-4-8', totalCost: expect.closeTo(2 * EXPECTED_COST, 8), totalInput: 2600, totalOutput: 800 },
      { model: 'gemini-3.5-flash', totalCost: 0, totalInput: 1300, totalOutput: 400 },
    ])
  })

  it('never throws into the caller — a DB failure is swallowed with a warn and no row', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // chatId 999999 violates the FK -> the insert rejects inside recordUsage.
      await expect(
        recordUsage({ chatId: 999999, projectId: null, purpose: 'chat', model: 'claude-opus-4-8', usage: makeUsage() })
      ).resolves.toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith('[usage] failed to record usage event', expect.anything())
      expect(await testDb.select().from(usageEvents)).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('sumUsage', () => {
  it('returns undefined when there is nothing to sum', () => {
    expect(sumUsage([])).toBeUndefined()
    expect(sumUsage([undefined, undefined])).toBeUndefined()
  })

  it('adds every field across steps, keeping the fresh/cache split intact', () => {
    const step1 = {
      inputTokens: 1300, outputTokens: 400, totalTokens: 1700,
      inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 200, cacheWriteTokens: 100 },
      outputTokenDetails: { textTokens: 400, reasoningTokens: 0 },
    } as LanguageModelUsage
    const step2 = {
      inputTokens: 50, outputTokens: 10, totalTokens: 60,
      inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 10, reasoningTokens: 0 },
    } as LanguageModelUsage
    expect(sumUsage([step1, undefined, step2])).toEqual({
      inputTokens: 1350, outputTokens: 410, totalTokens: 1760,
      inputTokenDetails: { noCacheTokens: 1050, cacheReadTokens: 200, cacheWriteTokens: 100 },
      outputTokenDetails: { textTokens: 410, reasoningTokens: 0 },
    })
    // The summed object must feed usageTokens() unchanged: fresh = noCacheTokens.
    expect(usageTokens(sumUsage([step1, step2])).inputTokens).toBe(1050)
  })

  it('keeps a field undefined only when every step lacks it', () => {
    const a = { inputTokens: 10, inputTokenDetails: {}, outputTokenDetails: {} } as LanguageModelUsage
    const b = { inputTokens: 5, outputTokens: 3, inputTokenDetails: {}, outputTokenDetails: {} } as LanguageModelUsage
    const sum = sumUsage([a, b])!
    expect(sum.inputTokens).toBe(15)
    expect(sum.outputTokens).toBe(3)
    expect(sum.totalTokens).toBeUndefined()
    expect(sum.inputTokenDetails.cacheReadTokens).toBeUndefined()
  })
})
