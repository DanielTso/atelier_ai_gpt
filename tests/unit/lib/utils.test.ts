import { describe, it, expect } from 'vitest'
import { cn, formatPageList, formatUsd, isUnpricedUsage } from '@/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('deduplicates tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('handles undefined and null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end')
  })

  it('handles empty input', () => {
    expect(cn()).toBe('')
  })

  it('merges conflicting tailwind utilities', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles array input', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })
})

describe('formatPageList', () => {
  it('collapses consecutive runs', () => {
    expect(formatPageList([12, 13, 14, 30])).toBe('12–14, 30')
  })
  it('handles single pages and unsorted input', () => {
    expect(formatPageList([7])).toBe('7')
    expect(formatPageList([3, 1, 2, 9])).toBe('1–3, 9')
  })
  it('returns empty string for empty input', () => {
    expect(formatPageList([])).toBe('')
  })
})

describe('formatUsd', () => {
  it('formats an exact zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
  it('formats an ordinary amount to 2 decimals', () => {
    expect(formatUsd(1.2345)).toBe('$1.23')
    expect(formatUsd(0.08)).toBe('$0.08')
  })
  it('formats a sub-cent amount without rounding away to $0.00', () => {
    expect(formatUsd(0.0007)).toBe('$0.0007')
    // The exact regression case from review: a fixed 4-decimal formatter
    // rounds this to "$0.0000", indistinguishable from a genuine zero.
    expect(formatUsd(0.00003)).toBe('$0.00003')
  })
  it('groups thousands so a heavy month does not run digits together', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50')
    expect(formatUsd(1234567.89)).toBe('$1,234,567.89')
  })
  it('rounds a .005-boundary value the way toFixed cannot (binary float representation)', () => {
    expect(formatUsd(1.005)).toBe('$1.01')
  })
})

describe('isUnpricedUsage', () => {
  it('is true for a non-Anthropic model with the cost-0/estimated sentinel tuple', () => {
    expect(isUnpricedUsage('gemini-3.5-flash', 0, true)).toBe(true)
  })
  it('is false for a Claude model even with the same cost-0/estimated tuple (family-tier estimate)', () => {
    expect(isUnpricedUsage('claude-opus-9-20990101', 0, true)).toBe(false)
  })
  it('is false for a non-Anthropic model once it has real cost', () => {
    expect(isUnpricedUsage('gemini-3.5-flash', 0.01, true)).toBe(false)
  })
  it('is false for a non-Anthropic model that is not estimated', () => {
    expect(isUnpricedUsage('gemini-3.5-flash', 0, false)).toBe(false)
  })
})
