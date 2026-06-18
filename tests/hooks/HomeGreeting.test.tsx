// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { HomeGreeting } from '@/components/chat/HomeGreeting'

afterEach(cleanup)

describe('HomeGreeting', () => {
  it('shows a time-of-day greeting with the name when provided', () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14) // afternoon
    render(<HomeGreeting displayName="Daniel Tso" />)
    expect(screen.getByText(/Good afternoon, Daniel Tso/)).toBeTruthy()
  })
  it('omits the comma/name when no name is provided', () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(8) // morning
    render(<HomeGreeting />)
    expect(screen.getByText('Good morning')).toBeTruthy()
  })
})
