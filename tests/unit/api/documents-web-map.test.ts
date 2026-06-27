import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = { isTavilyConfigured: vi.fn(), mapSite: vi.fn() }

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/tavily', () => ({ isTavilyConfigured: m.isTavilyConfigured, mapSite: m.mapSite }))
  return (await import('@/app/api/documents/web-map/route')).POST
}

function req(body: unknown) {
  return new Request('http://localhost/api/documents/web-map', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/web-map', () => {
  beforeEach(() => { Object.values(m).forEach(f => f.mockReset()) })

  it('400 on an invalid URL', async () => {
    const POST = await importRoute()
    expect((await POST(req({ url: 'not-a-url' }) as never)).status).toBe(400)
  })

  it('returns configured:false with no key (no map call)', async () => {
    m.isTavilyConfigured.mockResolvedValue(false)
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://site.com' }) as never)
    const data = await res.json()
    expect(data).toEqual({ urls: [], configured: false })
    expect(m.mapSite).not.toHaveBeenCalled()
  })

  it('maps and returns urls', async () => {
    m.isTavilyConfigured.mockResolvedValue(true)
    m.mapSite.mockResolvedValue(['https://a', 'https://b'])
    const POST = await importRoute()
    const res = await POST(req({ url: 'https://site.com', limit: 10 }) as never)
    const data = await res.json()
    expect(data).toEqual({ urls: ['https://a', 'https://b'], configured: true })
  })

  it('502 when mapping throws', async () => {
    m.isTavilyConfigured.mockResolvedValue(true)
    m.mapSite.mockRejectedValue(new Error('tavily down'))
    const POST = await importRoute()
    expect((await POST(req({ url: 'https://site.com' }) as never)).status).toBe(502)
  })
})
