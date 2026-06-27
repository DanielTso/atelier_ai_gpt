import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/settings')
vi.mock('@tavily/core')

import { isTavilyConfigured, mapSite, extractUrl } from '@/lib/tavily'
import * as settingsModule from '@/lib/settings'
import * as tavilyModule from '@tavily/core'

const settings = vi.mocked(settingsModule)
const tavily = vi.mocked(tavilyModule)

const getKey = vi.fn()
const mapMock = vi.fn()
const extractMock = vi.fn()

settings.getTavilyApiKey.mockImplementation(getKey)
tavily.tavily.mockImplementation(
  () =>
    ({
      map: mapMock,
      extract: extractMock,
      search: vi.fn(),
      searchQNA: vi.fn(),
      searchContext: vi.fn(),
      crawl: vi.fn(),
      news: vi.fn(),
    }) as any
)

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
