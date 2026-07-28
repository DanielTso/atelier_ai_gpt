import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above the module, so the mock fn must be
// created via vi.hoisted to be referencable inside them (matches
// tests/unit/lib/tavily.test.ts's idiom for mocking @/lib/settings).
const { getSetting } = vi.hoisted(() => ({ getSetting: vi.fn() }))
vi.mock('@/lib/settings', () => ({ getServerSetting: getSetting }))

import { resolvePricing, loadPricingOverrides } from '@/lib/models/pricing'

describe('resolvePricing', () => {
  it('an override wins over the exact-id table', () => {
    const overrides = { 'claude-opus-4-8': { inputPerMTok: 99, outputPerMTok: 199 } }
    expect(resolvePricing('claude-opus-4-8', 'opus', overrides)).toEqual({
      inputPerMTok: 99, outputPerMTok: 199, estimated: false,
    })
  })

  it('uses the exact-id table when there is no override', () => {
    // Claude Sonnet 5 introductory pricing (through 2026-08-31): 2/10.
    expect(resolvePricing('claude-sonnet-5', 'sonnet', {})).toEqual({
      inputPerMTok: 2, outputPerMTok: 10, estimated: false,
    })
  })

  it('falls back to family-tier pricing (estimated) for an unpriced id in a known family', () => {
    // Literal expected values (not FAMILY_TIER_PRICING.opus itself) so this
    // test still catches a wrong constant, not just an internally-consistent one.
    expect(resolvePricing('claude-opus-4-9', 'opus', {})).toEqual({
      inputPerMTok: 5, outputPerMTok: 25, estimated: true,
    })
  })

  it('falls back to the conservative opus-tier default (estimated) for an unknown family, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Literal expected values (not CONSERVATIVE_DEFAULT itself) — this is the
    // "never under-quote" guard and must fail if the default constant is ever
    // switched to a cheaper tier, not just pass because it matches itself.
    expect(resolvePricing('claude-nova-3', 'nova', {})).toEqual({
      inputPerMTok: 5, outputPerMTok: 25, estimated: true,
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('loadPricingOverrides', () => {
  beforeEach(() => {
    getSetting.mockReset()
  })

  it('parses a valid JSON overrides setting', async () => {
    getSetting.mockResolvedValue(JSON.stringify({ 'claude-opus-4-8': { inputPerMTok: 1, outputPerMTok: 2 } }))
    expect(await loadPricingOverrides()).toEqual({ 'claude-opus-4-8': { inputPerMTok: 1, outputPerMTok: 2 } })
  })

  it('returns {} when no setting is stored', async () => {
    getSetting.mockResolvedValue(null)
    expect(await loadPricingOverrides()).toEqual({})
  })

  it('returns {} (never throws) on malformed JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSetting.mockResolvedValue('{not valid json')
    await expect(loadPricingOverrides()).resolves.toEqual({})
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns {} on a JSON array (not an overrides object)', async () => {
    getSetting.mockResolvedValue('[1,2,3]')
    expect(await loadPricingOverrides()).toEqual({})
  })

  it('drops a malformed override entry (bare string, or missing/non-numeric rates) and warns naming the model id, keeping any valid sibling entries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSetting.mockResolvedValue(JSON.stringify({
      'claude-opus-4-8': 'free',
      'claude-fable-5': { inputPerMTok: 5 }, // missing outputPerMTok
      'claude-haiku-4-5': { inputPerMTok: 'cheap', outputPerMTok: 5 }, // non-numeric
      'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 }, // valid
    }))

    expect(await loadPricingOverrides()).toEqual({
      'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude-opus-4-8'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude-fable-5'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude-haiku-4-5'))
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('claude-sonnet-5'))
    warn.mockRestore()
  })

  it('a dropped malformed entry falls through to exact-id pricing when resolved (never NaN, never a phantom estimated:false)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSetting.mockResolvedValue(JSON.stringify({ 'claude-opus-4-8': { input: 5 } }))

    const overrides = await loadPricingOverrides()
    expect(overrides).toEqual({})
    expect(resolvePricing('claude-opus-4-8', 'opus', overrides)).toEqual({
      inputPerMTok: 5, outputPerMTok: 25, estimated: false,
    })
    warn.mockRestore()
  })

  it('a valid override entry still wins over exact-id pricing once resolved', async () => {
    getSetting.mockResolvedValue(JSON.stringify({
      'claude-opus-4-8': { inputPerMTok: 99, outputPerMTok: 199 },
    }))

    const overrides = await loadPricingOverrides()
    expect(overrides).toEqual({ 'claude-opus-4-8': { inputPerMTok: 99, outputPerMTok: 199 } })
    expect(resolvePricing('claude-opus-4-8', 'opus', overrides)).toEqual({
      inputPerMTok: 99, outputPerMTok: 199, estimated: false,
    })
  })
})
