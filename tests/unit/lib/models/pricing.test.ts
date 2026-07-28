import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above the module, so the mock fn must be
// created via vi.hoisted to be referencable inside them (matches
// tests/unit/lib/tavily.test.ts's idiom for mocking @/lib/settings).
const { getSetting } = vi.hoisted(() => ({ getSetting: vi.fn() }))
vi.mock('@/lib/settings', () => ({ getServerSetting: getSetting }))

import { resolvePricing, loadPricingOverrides, FAMILY_TIER_PRICING, CONSERVATIVE_DEFAULT } from '@/lib/models/pricing'

describe('resolvePricing', () => {
  it('an override wins over the exact-id table', () => {
    const overrides = { 'claude-opus-4-8': { inputPerMTok: 99, outputPerMTok: 199 } }
    expect(resolvePricing('claude-opus-4-8', 'opus', overrides)).toEqual({
      inputPerMTok: 99, outputPerMTok: 199, estimated: false,
    })
  })

  it('uses the exact-id table when there is no override', () => {
    expect(resolvePricing('claude-sonnet-5', 'sonnet', {})).toEqual({
      inputPerMTok: 3, outputPerMTok: 15, estimated: false,
    })
  })

  it('falls back to family-tier pricing (estimated) for an unpriced id in a known family', () => {
    expect(resolvePricing('claude-opus-4-9', 'opus', {})).toEqual({
      ...FAMILY_TIER_PRICING.opus, estimated: true,
    })
  })

  it('falls back to the conservative opus-tier default (estimated) for an unknown family, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolvePricing('claude-nova-3', 'nova', {})).toEqual({
      ...CONSERVATIVE_DEFAULT, estimated: true,
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
})
