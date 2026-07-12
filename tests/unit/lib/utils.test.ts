import { describe, it, expect } from 'vitest'
import { cn, formatPageList } from '@/lib/utils'

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
