// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebIngest } from '@/hooks/useWebIngest'

describe('useWebIngest', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('mapSite posts to web-map and returns the payload', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ urls: ['https://a'], configured: true }) })
    const { result } = renderHook(() => useWebIngest())
    let out!: { urls: string[]; configured: boolean }
    await act(async () => { out = await result.current.mapSite('https://site.com') })
    expect(out).toEqual({ urls: ['https://a'], configured: true })
    expect(fetch).toHaveBeenCalledWith('/api/documents/web-map', expect.objectContaining({ method: 'POST' }))
  })

  it('ingestUrls fires onResult per url (success and error)', async () => {
    ;(fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ document: { id: 1, filename: 'A' } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) })
    const { result } = renderHook(() => useWebIngest())
    const seen: Array<{ url: string; ok: boolean }> = []
    await act(async () => {
      await result.current.ingestUrls(['https://a', 'https://b'], 1, (r) => seen.push({ url: r.url, ok: !!r.document }), 1)
    })
    expect(seen).toContainEqual({ url: 'https://a', ok: true })
    expect(seen).toContainEqual({ url: 'https://b', ok: false })
  })
})
