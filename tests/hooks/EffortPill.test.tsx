// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { EffortPill } from '@/components/ui/EffortPill'

// Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function openPill() {
  const trigger = screen.getByTitle('Reasoning effort')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.pointerUp(trigger)
}

describe('EffortPill', () => {
  it('renders exactly the levels passed, in order, nothing else', () => {
    render(<EffortPill value="low" levels={['low', 'medium']} onChange={vi.fn()} />)
    openPill()
    expect(screen.getByRole('menuitem', { name: 'Low' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Medium' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'High' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Xhigh' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Max' })).toBeNull()
  })

  it('surfaces xhigh when it is one of the passed levels', () => {
    render(<EffortPill value="xhigh" levels={['low', 'medium', 'high', 'xhigh', 'max']} onChange={vi.fn()} />)
    openPill()
    expect(screen.getByRole('menuitem', { name: 'Xhigh' })).toBeTruthy()
  })

  it('calls onChange with the selected level', () => {
    const onChange = vi.fn()
    render(<EffortPill value="low" levels={['low', 'medium']} onChange={onChange} />)
    openPill()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Medium' }))
    expect(onChange).toHaveBeenCalledWith('medium')
  })
})
