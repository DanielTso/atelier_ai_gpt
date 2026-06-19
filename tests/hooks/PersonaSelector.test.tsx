// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PersonaSelector } from '@/components/ui/PersonaSelector'

afterEach(cleanup)

describe('PersonaSelector trigger', () => {
  it('shows the General Assistant default when no prompt is set', () => {
    render(<PersonaSelector currentPrompt={null} onSelect={vi.fn()} />)
    expect(screen.getByText('General Assistant')).toBeTruthy()
  })

  it('shows "Custom" when the prompt matches no known persona', () => {
    render(<PersonaSelector currentPrompt={'some bespoke system prompt'} onSelect={vi.fn()} />)
    expect(screen.getByText('Custom')).toBeTruthy()
  })
})
