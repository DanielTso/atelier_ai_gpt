// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoCollapseSidebar } from '@/hooks/useAutoCollapseSidebar'

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}

// With innerWidth 1200: cramped = 1200 - 288 - panelWidth < 520 -> panelWidth > 392.
const WIDE = 700 // cramped
const NARROW = 300 // not cramped

describe('useAutoCollapseSidebar', () => {
  beforeEach(() => setWidth(1200))

  it('collapses when active and the panel is wide enough to cramp', () => {
    const ref = { current: false }
    const set = vi.fn((v: boolean) => { ref.current = v })
    renderHook(() => useAutoCollapseSidebar({ active: true, panelWidth: WIDE, sidebarCollapsedRef: ref, setSidebarCollapsed: set }))
    expect(set).toHaveBeenCalledWith(true)
    expect(ref.current).toBe(true)
  })

  it('does not collapse when the panel is narrow', () => {
    const ref = { current: false }
    const set = vi.fn((v: boolean) => { ref.current = v })
    renderHook(() => useAutoCollapseSidebar({ active: true, panelWidth: NARROW, sidebarCollapsedRef: ref, setSidebarCollapsed: set }))
    expect(set).not.toHaveBeenCalled()
  })

  it('restores when the panel narrows after an auto-collapse', () => {
    const ref = { current: false }
    const set = vi.fn((v: boolean) => { ref.current = v })
    const { rerender } = renderHook(
      ({ w }) => useAutoCollapseSidebar({ active: true, panelWidth: w, sidebarCollapsedRef: ref, setSidebarCollapsed: set }),
      { initialProps: { w: WIDE } }
    )
    expect(set).toHaveBeenLastCalledWith(true)
    rerender({ w: NARROW })
    expect(set).toHaveBeenLastCalledWith(false)
    expect(ref.current).toBe(false)
  })

  it('restores when the artifact closes (active -> false) after an auto-collapse', () => {
    const ref = { current: false }
    const set = vi.fn((v: boolean) => { ref.current = v })
    const { rerender } = renderHook(
      ({ a }) => useAutoCollapseSidebar({ active: a, panelWidth: WIDE, sidebarCollapsedRef: ref, setSidebarCollapsed: set }),
      { initialProps: { a: true } }
    )
    expect(set).toHaveBeenLastCalledWith(true)
    rerender({ a: false })
    expect(set).toHaveBeenLastCalledWith(false)
  })

  it('leaves a user-collapsed sidebar alone (only restores what it auto-collapsed)', () => {
    const ref = { current: true } // user already collapsed it
    const set = vi.fn((v: boolean) => { ref.current = v })
    const { rerender } = renderHook(
      ({ a }) => useAutoCollapseSidebar({ active: a, panelWidth: WIDE, sidebarCollapsedRef: ref, setSidebarCollapsed: set }),
      { initialProps: { a: true } }
    )
    expect(set).not.toHaveBeenCalled() // cramped, but it didn't collapse (already collapsed)
    rerender({ a: false })
    expect(set).not.toHaveBeenCalled() // and it must not "restore" what it never collapsed
  })

  it('restores on unmount if it auto-collapsed', () => {
    const ref = { current: false }
    const set = vi.fn((v: boolean) => { ref.current = v })
    const { unmount } = renderHook(() => useAutoCollapseSidebar({ active: true, panelWidth: WIDE, sidebarCollapsedRef: ref, setSidebarCollapsed: set }))
    expect(set).toHaveBeenLastCalledWith(true)
    set.mockClear()
    unmount()
    expect(set).toHaveBeenCalledWith(false)
  })
})
