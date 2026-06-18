import { describe, it, expect } from 'vitest'
import { greetingForHour } from '@/lib/greeting'

describe('greetingForHour', () => {
  it('says good morning from 5 to 11', () => {
    expect(greetingForHour(5)).toBe('Good morning')
    expect(greetingForHour(11)).toBe('Good morning')
  })
  it('says good afternoon from 12 to 16', () => {
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(16)).toBe('Good afternoon')
  })
  it('says good evening from 17 to 4 (wrapping midnight)', () => {
    expect(greetingForHour(17)).toBe('Good evening')
    expect(greetingForHour(23)).toBe('Good evening')
    expect(greetingForHour(0)).toBe('Good evening')
    expect(greetingForHour(4)).toBe('Good evening')
  })
})
