// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUrlNavSync, type UseUrlNavSyncOpts } from '@/hooks/useUrlNavSync'

type NavProps = Pick<UseUrlNavSyncOpts, 'activeView' | 'activeProjectId' | 'activeChatId' | 'currentChatProjectId'>

const home: NavProps = { activeView: 'home', activeProjectId: null, activeChatId: null, currentChatProjectId: undefined }

function setup(initial: NavProps, search = '') {
  window.history.replaceState(null, '', `/${search}`)
  const setActiveView = vi.fn()
  const setActiveProjectId = vi.fn()
  const setActiveChatId = vi.fn()
  const pushSpy = vi.spyOn(window.history, 'pushState')
  const replaceSpy = vi.spyOn(window.history, 'replaceState')
  const hook = renderHook(
    (props: NavProps) => useUrlNavSync({ ...props, setActiveView, setActiveProjectId, setActiveChatId }),
    { initialProps: initial },
  )
  return { ...hook, setActiveView, setActiveProjectId, setActiveChatId, pushSpy, replaceSpy }
}

beforeEach(() => { window.history.replaceState(null, '', '/') })
afterEach(() => { vi.restoreAllMocks() })

describe('useUrlNavSync', () => {
  it('restores state from the initial URL on mount', () => {
    const { setActiveView, setActiveProjectId, setActiveChatId } = setup(home, '?project=3&chat=12')
    expect(setActiveView).toHaveBeenCalledWith('home')
    expect(setActiveProjectId).toHaveBeenCalledWith(3)
    expect(setActiveChatId).toHaveBeenCalledWith(12)
  })

  it('does not touch state when mounting at a bare URL', () => {
    const { setActiveView, setActiveProjectId, setActiveChatId } = setup(home)
    expect(setActiveView).not.toHaveBeenCalled()
    expect(setActiveProjectId).not.toHaveBeenCalled()
    expect(setActiveChatId).not.toHaveBeenCalled()
  })

  it('pushes a new URL when nav state changes', () => {
    const { rerender, pushSpy } = setup(home)
    rerender({ ...home, activeProjectId: 3 })
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenLastCalledWith(null, '', '/?project=3')
  })

  it('dedupes renders that do not change the canonical URL', () => {
    const { rerender, pushSpy } = setup(home)
    rerender({ ...home, activeProjectId: 3 })
    rerender({ ...home, activeProjectId: 3 })
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('applies popstate to state without echoing a push', () => {
    const { rerender, setActiveChatId, setActiveProjectId, setActiveView, pushSpy } = setup(home)
    act(() => {
      window.history.replaceState(null, '', '/?chat=7')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(setActiveView).toHaveBeenCalledWith('home')
    expect(setActiveProjectId).toHaveBeenCalledWith(null)
    expect(setActiveChatId).toHaveBeenCalledWith(7)
    pushSpy.mockClear()
    // page.tsx applies the setters; simulate the resulting rerender
    rerender({ ...home, activeChatId: 7, currentChatProjectId: null })
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('suppressNextPush turns the next URL change into replaceState', () => {
    const { result, rerender, pushSpy, replaceSpy } = setup({ ...home, activeChatId: 99 }, '?chat=99')
    replaceSpy.mockClear()
    act(() => { result.current.suppressNextPush() })
    rerender({ ...home, activeChatId: null })
    expect(pushSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/')
  })

  it("uses the chat's own project over a stale activeProjectId", () => {
    const { rerender, pushSpy } = setup(home)
    rerender({ activeView: 'home', activeProjectId: 3, activeChatId: 9, currentChatProjectId: null })
    expect(pushSpy).toHaveBeenLastCalledWith(null, '', '/?chat=9')
  })

  it('falls back to activeProjectId while the chat record has not loaded', () => {
    const { rerender, pushSpy } = setup(home)
    rerender({ activeView: 'home', activeProjectId: 3, activeChatId: 9, currentChatProjectId: undefined })
    expect(pushSpy).toHaveBeenLastCalledWith(null, '', '/?project=3&chat=9')
  })

  it('tab views win over a stale project id', () => {
    const { rerender, pushSpy } = setup(home)
    rerender({ activeView: 'artifacts', activeProjectId: 3, activeChatId: null, currentChatProjectId: undefined })
    expect(pushSpy).toHaveBeenLastCalledWith(null, '', '/?view=artifacts')
  })
})
