// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CapacityBar } from '@/components/chat/CapacityBar'

afterEach(cleanup)

describe('CapacityBar', () => {
  it('shows the rounded percent used', () => {
    render(<CapacityBar usedBytes={500} capBytes={1000} />)
    expect(screen.getByText(/50% of project capacity used/)).toBeTruthy()
  })
  it('clamps over-capacity to 100%', () => {
    render(<CapacityBar usedBytes={3000} capBytes={1000} />)
    expect(screen.getByText(/100% of project capacity used/)).toBeTruthy()
  })
  it('handles a zero cap without NaN', () => {
    render(<CapacityBar usedBytes={10} capBytes={0} />)
    expect(screen.getByText(/0% of project capacity used/)).toBeTruthy()
  })
})
