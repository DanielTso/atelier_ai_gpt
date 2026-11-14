// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockGetChatMessages = vi.fn()
vi.mock('@/app/actions', () => ({
  getChatMessages: (...args: unknown[]) => mockGetChatMessages(...args),
}))

import { useSummarization, SUMMARIZATION_THRESHOLD, MESSAGES_TO_KEEP } from '@/hooks/useSummarization'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, role: i % 2 ? 'assistant' : 'user', content: `m${i + 1}` }))

function trigger() {
  const { result } = renderHook(() => useSummarization())
  return result.current
}

// Audit B4 (client side): the caller advances its delta gate before the fold
// runs. The hook now reports whether the fold succeeded, so a failed fold (a
// non-2xx or a network error) re-arms the gate instead of opening a context gap.
describe('useSummarization', () => {
  const count = SUMMARIZATION_THRESHOLD + 1

  beforeEach(() => {
    mockGetChatMessages.mockReset()
    mockGetChatMessages.mockResolvedValue(rows(count))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves true on a 2xx and posts the cutoff that keeps the last MESSAGES_TO_KEEP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await trigger()(7, count)
    expect(ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ chatId: 7, cutoffMessageId: count - MESSAGES_TO_KEEP })
  })

  it('resolves false on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await trigger()(7, count)).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('resolves false when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await trigger()(7, count)).toBe(false)
    } finally {
      err.mockRestore()
    }
  })

  it('resolves true without a request when there is nothing to fold', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await trigger()(7, SUMMARIZATION_THRESHOLD)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
