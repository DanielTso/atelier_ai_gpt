// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from '@/hooks/useLocalStorage'

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns initial value when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStorage('key', 'initial'))
    expect(result.current[0]).toBe('initial')
  })

  it('reads stored value from localStorage', () => {
    window.localStorage.setItem('key', JSON.stringify('stored'))
    const { result } = renderHook(() => useLocalStorage('key', 'initial'))
    expect(result.current[0]).toBe('stored')
  })

  it('updates value', () => {
    const { result } = renderHook(() => useLocalStorage('key', 'initial'))
    act(() => {
      result.current[1]('updated')
    })
    expect(result.current[0]).toBe('updated')
  })

  it('supports updater function', () => {
    const { result } = renderHook(() => useLocalStorage('count', 0))
    act(() => {
      result.current[1]((prev) => prev + 1)
    })
    expect(result.current[0]).toBe(1)
  })

  it('handles complex objects', () => {
    const initial = { name: 'test', items: [1, 2, 3] }
    const { result } = renderHook(() => useLocalStorage('obj', initial))
    expect(result.current[0]).toEqual(initial)

    act(() => {
      result.current[1]({ name: 'updated', items: [4, 5] })
    })
    expect(result.current[0]).toEqual({ name: 'updated', items: [4, 5] })
  })

  it('falls back to initial value on malformed JSON', () => {
    window.localStorage.setItem('bad', 'not-valid-json{{{')
    const { result } = renderHook(() => useLocalStorage('bad', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  it('falls back to initial value when a stored value fails the validator', () => {
    // Valid JSON, wrong shape (a legacy/hand-edited entry) → must not be adopted.
    window.localStorage.setItem('shape', JSON.stringify('not-an-object'))
    const isObj = (v: unknown) => typeof v === 'object' && v !== null
    const { result } = renderHook(() => useLocalStorage('shape', { ok: true }, isObj))
    expect(result.current[0]).toEqual({ ok: true })
  })

  it('adopts a stored value that passes the validator', () => {
    window.localStorage.setItem('shape', JSON.stringify({ ok: false }))
    const isObj = (v: unknown) => typeof v === 'object' && v !== null
    const { result } = renderHook(() => useLocalStorage('shape', { ok: true }, isObj))
    expect(result.current[0]).toEqual({ ok: false })
  })
})
