import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAllAnthropicModels } from '@/lib/models/fetch'

describe('fetchAllAnthropicModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('paginates via has_more/last_id across two pages and returns all rows', async () => {
    const page1 = {
      data: [{ id: 'claude-a', display_name: 'A', created_at: '2026-01-01' }],
      has_more: true, first_id: 'claude-a', last_id: 'claude-a',
    }
    const page2 = {
      data: [{ id: 'claude-b', display_name: 'B', created_at: '2026-01-02' }],
      has_more: false, first_id: 'claude-b', last_id: 'claude-b',
    }
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 })

    const result = await fetchAllAnthropicModels('test-key')

    expect(result.map(m => m.id)).toEqual(['claude-a', 'claude-b'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl] = fetchMock.mock.calls[0]
    const [secondUrl] = fetchMock.mock.calls[1]
    expect(String(firstUrl)).not.toContain('after_id')
    expect(String(secondUrl)).toContain('after_id=claude-a')
  })

  it('throws with the status on a non-2xx response', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    await expect(fetchAllAnthropicModels('test-key')).rejects.toThrow(/500/)
  })

  it('caps pagination at MAX_PAGES rather than looping forever', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    let calls = 0
    fetchMock.mockImplementation(async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => ({ data: [], has_more: true, first_id: `p${calls}`, last_id: `p${calls}` }) }
    })

    await expect(fetchAllAnthropicModels('test-key')).rejects.toThrow(/MAX_PAGES/i)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it('aborts and propagates when the request exceeds the timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))

    const pending = expect(fetchAllAnthropicModels('test-key')).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    await pending
  })
})
