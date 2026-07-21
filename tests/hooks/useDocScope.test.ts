// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { scopeProjectIdFor, useDocScope, type ScopeProjectId } from '@/hooks/useDocScope'

// Review F1 amendment (2026-07-21): source scoping persists per PROJECT
// ('project-doc-scope-<id>'), not per chat. The scope key derives from the
// chat's OWN projectId inside a chat (activeProjectId goes stale), the active
// project on the landing surface, and 'none' in a projectless context.

describe('scopeProjectIdFor', () => {
  it("uses the chat's own projectId inside a chat (stale activeProjectId ignored)", () => {
    expect(scopeProjectIdFor(5, 9)).toBe(5)
    expect(scopeProjectIdFor(5, null)).toBe(5)
  })

  it('falls back to the active project on the landing surface (no chat)', () => {
    expect(scopeProjectIdFor(undefined, 9)).toBe(9)
    expect(scopeProjectIdFor(null, 9)).toBe(9)
  })

  it("resolves 'none' when no project context exists", () => {
    expect(scopeProjectIdFor(null, null)).toBe('none')
    expect(scopeProjectIdFor(undefined, null)).toBe('none')
  })
})

describe('useDocScope', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('persists exclusions under the PROJECT key', async () => {
    const { result } = renderHook(() => useDocScope(7))
    await act(async () => {
      result.current.setExcludedDocIds([3, 4])
    })
    expect(result.current.excludedDocIds).toEqual([3, 4])
    expect(window.localStorage.getItem('project-doc-scope-7')).toBe(JSON.stringify([3, 4]))
  })

  it("a project's exclusions set on the landing rail apply inside a chat of that project", () => {
    // The landing rail (activeProjectId = 7, no chat) wrote project 7's exclusions;
    // a chat OF project 7 derives the SAME key from currentChat.projectId and
    // reads them back — the per-chat keying this replaces could never do this.
    window.localStorage.setItem('project-doc-scope-7', JSON.stringify([3]))
    const landingKey = scopeProjectIdFor(undefined, 7)
    const inChatKey = scopeProjectIdFor(7, null)
    expect(inChatKey).toBe(landingKey)
    const { result } = renderHook(() => useDocScope(inChatKey))
    expect(result.current.excludedDocIds).toEqual([3])
  })

  it('a projectless context reads [] and never writes', async () => {
    const { result } = renderHook(() => useDocScope('none'))
    expect(result.current.excludedDocIds).toEqual([])
    await act(async () => {
      result.current.setExcludedDocIds([1])
    })
    expect(result.current.excludedDocIds).toEqual([])
    expect(window.localStorage.getItem('project-doc-scope-none')).toBeNull()
  })

  it('ignores legacy chat-doc-scope entries', () => {
    window.localStorage.setItem('chat-doc-scope-null', JSON.stringify([9]))
    const { result } = renderHook(() => useDocScope(7))
    expect(result.current.excludedDocIds).toEqual([])
  })

  it('switching projects switches buckets with no carry-over', async () => {
    window.localStorage.setItem('project-doc-scope-1', JSON.stringify([2]))
    const { result, rerender } = renderHook(
      ({ id }: { id: ScopeProjectId }) => useDocScope(id),
      { initialProps: { id: 1 as ScopeProjectId } },
    )
    expect(result.current.excludedDocIds).toEqual([2])
    // Project 5 has no entry — project 1's exclusions must NOT leak into it.
    rerender({ id: 5 })
    expect(result.current.excludedDocIds).toEqual([])
    expect(window.localStorage.getItem('project-doc-scope-5')).toBeNull()
    // Back to project 1: its exclusions are still there.
    rerender({ id: 1 })
    expect(result.current.excludedDocIds).toEqual([2])
  })
})
