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

  it('syncs a set() to OTHER instances of the same key in the same tab', async () => {
    // Two mounted instances sharing one key (e.g. usePersonas' custom-personas in the
    // Settings tab AND the composer's PersonaSelector). Before the in-tab sync fix the
    // second instance stayed stale until reload — the `storage` event only fires in
    // OTHER tabs.
    const a = renderHook(() => useLocalStorage('shared', 'v0'))
    const b = renderHook(() => useLocalStorage('shared', 'v0'))

    await act(async () => {
      a.result.current[1]('v1')
    })

    expect(a.result.current[0]).toBe('v1')
    expect(b.result.current[0]).toBe('v1')
    expect(window.localStorage.getItem('shared')).toBe(JSON.stringify('v1'))
  })

  it('re-hydrates when the key changes to one with a stored value', () => {
    window.localStorage.setItem('k-b', JSON.stringify('bee'))
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useLocalStorage(k, 'init'),
      { initialProps: { k: 'k-a' } },
    )
    expect(result.current[0]).toBe('init')
    rerender({ k: 'k-b' })
    expect(result.current[0]).toBe('bee')
  })

  it('resets to the initial value on a key change to an empty bucket (no carry-over, no phantom write)', () => {
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useLocalStorage(k, 'init'),
      { initialProps: { k: 'k-a' } },
    )
    act(() => result.current[1]('touched'))
    expect(window.localStorage.getItem('k-a')).toBe(JSON.stringify('touched'))
    // 'k-b' has no entry: the previous key's value must NOT leak in, and the
    // reset must not be persisted as a phantom entry under the new key.
    rerender({ k: 'k-b' })
    expect(result.current[0]).toBe('init')
    expect(window.localStorage.getItem('k-b')).toBeNull()
  })

  it('in-tab sync respects the validator and does not echo-loop on objects', async () => {
    const isObj = (v: unknown) => typeof v === 'object' && v !== null
    const a = renderHook(() => useLocalStorage<{ n: number }>('obj-shared', { n: 0 }, isObj))
    const b = renderHook(() => useLocalStorage<{ n: number }>('obj-shared', { n: 0 }, isObj))

    await act(async () => {
      a.result.current[1]({ n: 1 })
    })
    // Both instances converge on the new object; a further tick must not thrash state.
    expect(a.result.current[0]).toEqual({ n: 1 })
    expect(b.result.current[0]).toEqual({ n: 1 })
    const settled = b.result.current[0]
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(b.result.current[0]).toBe(settled)
  })
})
