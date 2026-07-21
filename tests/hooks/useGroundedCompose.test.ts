// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGroundedCompose } from '@/hooks/useGroundedCompose'

describe('useGroundedCompose', () => {
  it('initializes from the passed default', () => {
    const off = renderHook(() => useGroundedCompose(false))
    expect(off.result.current.grounded).toBe(false)
    const on = renderHook(() => useGroundedCompose(true))
    expect(on.result.current.grounded).toBe(true)
  })

  it('toggle flips the pill', () => {
    const { result } = renderHook(() => useGroundedCompose(false))
    act(() => result.current.toggle())
    expect(result.current.grounded).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.grounded).toBe(false)
  })

  it('applyPersonaDefault adopts the persona default when the user has not toggled', () => {
    const { result } = renderHook(() => useGroundedCompose(false))
    act(() => result.current.applyPersonaDefault(true))
    expect(result.current.grounded).toBe(true)
  })

  // The v4.50 precedence regression class: a manual pick must survive a late
  // persona/default load that would otherwise revert it.
  it('a manual toggle WINS over a subsequent persona default reload', () => {
    const { result } = renderHook(() => useGroundedCompose(false))
    act(() => result.current.toggle()) // user turns grounded ON
    expect(result.current.grounded).toBe(true)
    // A grounded=false persona default arrives late — it must NOT clobber the pick.
    act(() => result.current.applyPersonaDefault(false))
    expect(result.current.grounded).toBe(true)
  })

  // Review F2/F4: opening an existing chat resets the pill OFF and clears the
  // pick guard — the exact call sequence page.tsx's chat-open effect runs.
  it('chat-open reset (resetPick + applyPersonaDefault(false)) forces OFF even after a manual toggle', () => {
    const { result } = renderHook(() => useGroundedCompose(false))
    act(() => result.current.toggle()) // grounded ON in a previous surface
    expect(result.current.grounded).toBe(true)
    act(() => {
      result.current.resetPick()
      result.current.applyPersonaDefault(false)
    })
    expect(result.current.grounded).toBe(false)
    // The guard is clear: a later persona default applies normally again.
    act(() => result.current.applyPersonaDefault(true))
    expect(result.current.grounded).toBe(true)
  })

  it('resetPick clears the guard so the next persona default applies again', () => {
    const { result } = renderHook(() => useGroundedCompose(false))
    act(() => result.current.toggle()) // picked ON
    act(() => result.current.applyPersonaDefault(false)) // ignored (picked)
    expect(result.current.grounded).toBe(true)
    act(() => result.current.resetPick()) // new compose session
    act(() => result.current.applyPersonaDefault(false)) // now honored
    expect(result.current.grounded).toBe(false)
  })
})
