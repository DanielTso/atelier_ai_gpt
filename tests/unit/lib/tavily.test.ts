import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above the module, so the mock fns must be
// created via vi.hoisted to be referencable inside them (and to avoid an
// `as any` cast on a partial Tavily client).
const { getKey, mapMock, extractMock } = vi.hoisted(() => ({
  getKey: vi.fn(),
  mapMock: vi.fn(),
  extractMock: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({ getTavilyApiKey: getKey }))
vi.mock('@tavily/core', () => ({ tavily: () => ({ map: mapMock, extract: extractMock }) }))

import { isTavilyConfigured, mapSite, extractUrl } from '@/lib/tavily'

describe('tavily wrapper', () => {
  beforeEach(() => {
    getKey.mockReset()
    mapMock.mockReset()
    extractMock.mockReset()
    getKey.mockResolvedValue('tvly-test')
  })

  it('isTavilyConfigured reflects the key presence', async () => {
    getKey.mockResolvedValueOnce('tvly-test')
    expect(await isTavilyConfigured()).toBe(true)
    getKey.mockResolvedValueOnce(null)
    expect(await isTavilyConfigured()).toBe(false)
  })

  it('mapSite returns results and clamps the limit', async () => {
    mapMock.mockResolvedValue({ results: ['https://a', 'https://b'] })
    const urls = await mapSite('https://site', { limit: 9999 })
    expect(urls).toEqual(['https://a', 'https://b'])
    expect(mapMock).toHaveBeenCalledWith('https://site', expect.objectContaining({ limit: 100 }))
  })

  it('extractUrl derives the title from the first heading', async () => {
    extractMock.mockResolvedValue({ results: [{ url: 'https://x', rawContent: '# Hello World\n\nbody' }] })
    const r = await extractUrl('https://x')
    expect(r.title).toBe('Hello World')
    expect(r.markdown).toContain('body')
  })

  it('extractUrl falls back to host+path when there is no heading', async () => {
    extractMock.mockResolvedValue({ results: [{ url: 'https://x.com/a', rawContent: 'plain text' }] })
    const r = await extractUrl('https://x.com/a')
    expect(r.title).toBe('x.com/a')
  })

  it('extractUrl throws on empty content', async () => {
    extractMock.mockResolvedValue({ results: [{ url: 'https://x', rawContent: '   ' }] })
    await expect(extractUrl('https://x')).rejects.toThrow('No content extracted')
  })

  it('throws when no key is configured', async () => {
    getKey.mockResolvedValue(null)
    await expect(mapSite('https://site')).rejects.toThrow('Tavily API key not configured')
  })
})
