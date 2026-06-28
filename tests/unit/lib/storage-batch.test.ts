import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = {
  createSignedUrls: vi.fn(),
}
const mockStorage = { from: vi.fn(() => mockFrom) }

function setup(url = 'https://x.supabase.co', key = 'service-key') {
  vi.resetModules()
  process.env.SUPABASE_URL = url
  process.env.SUPABASE_SERVICE_ROLE_KEY = key
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: mockStorage }) }))
}

describe('createSignedDownloadUrls', () => {
  beforeEach(() => {
    mockFrom.createSignedUrls.mockReset()
    mockStorage.from.mockClear()
  })

  it('maps path→url correctly from a batch response', async () => {
    setup()
    mockFrom.createSignedUrls.mockResolvedValue({
      data: [
        { path: 'a/b.pdf', signedUrl: 'https://signed/a/b.pdf', error: null },
        { path: 'c/d.png', signedUrl: 'https://signed/c/d.png', error: null },
      ],
      error: null,
    })
    const { createSignedDownloadUrls } = await import('@/lib/storage')
    const result = await createSignedDownloadUrls(['a/b.pdf', 'c/d.png'])
    expect(result.get('a/b.pdf')).toBe('https://signed/a/b.pdf')
    expect(result.get('c/d.png')).toBe('https://signed/c/d.png')
    expect(result.size).toBe(2)
  })

  it('skips items with a non-null error field', async () => {
    setup()
    mockFrom.createSignedUrls.mockResolvedValue({
      data: [
        { path: 'ok.pdf', signedUrl: 'https://signed/ok.pdf', error: null },
        { path: 'bad.pdf', signedUrl: '', error: 'storage error' },
      ],
      error: null,
    })
    const { createSignedDownloadUrls } = await import('@/lib/storage')
    const result = await createSignedDownloadUrls(['ok.pdf', 'bad.pdf'])
    expect(result.get('ok.pdf')).toBe('https://signed/ok.pdf')
    expect(result.has('bad.pdf')).toBe(false)
    expect(result.size).toBe(1)
  })

  it('skips items with missing signedUrl', async () => {
    setup()
    mockFrom.createSignedUrls.mockResolvedValue({
      data: [
        { path: 'ok.pdf', signedUrl: 'https://signed/ok.pdf', error: null },
        { path: 'empty.pdf', signedUrl: '', error: null },
      ],
      error: null,
    })
    const { createSignedDownloadUrls } = await import('@/lib/storage')
    const result = await createSignedDownloadUrls(['ok.pdf', 'empty.pdf'])
    expect(result.size).toBe(1)
    expect(result.has('empty.pdf')).toBe(false)
  })

  it('returns empty Map for empty input WITHOUT calling the client', async () => {
    setup()
    const { createSignedDownloadUrls } = await import('@/lib/storage')
    const result = await createSignedDownloadUrls([])
    expect(result.size).toBe(0)
    expect(mockFrom.createSignedUrls).not.toHaveBeenCalled()
  })

  it('returns empty Map when the API returns an error', async () => {
    setup()
    mockFrom.createSignedUrls.mockResolvedValue({ data: null, error: new Error('api error') })
    const { createSignedDownloadUrls } = await import('@/lib/storage')
    const result = await createSignedDownloadUrls(['p/file.pdf'])
    expect(result.size).toBe(0)
  })
})

describe('signedArtifactUrls', () => {
  beforeEach(() => {
    mockFrom.createSignedUrls.mockReset()
    mockStorage.from.mockClear()
  })

  it('routes .html paths through a {download:true} batch and others through a plain batch', async () => {
    setup()
    mockFrom.createSignedUrls.mockImplementation(async (paths: string[], _ttl: number, opts?: { download?: boolean }) => ({
      data: paths.map((p: string) => ({ path: p, signedUrl: `https://signed/${p}${opts?.download ? '?dl=1' : ''}`, error: null })),
      error: null,
    }))

    const { signedArtifactUrls } = await import('@/lib/storage')
    const result = await signedArtifactUrls(['artifacts/report.xlsx', 'artifacts/page.html', null, undefined])

    // HTML gets download disposition
    expect(result.get('artifacts/page.html')).toContain('?dl=1')
    // Non-HTML does NOT get download disposition
    expect(result.get('artifacts/report.xlsx')).not.toContain('?dl=1')
    expect(result.get('artifacts/report.xlsx')).toBe('https://signed/artifacts/report.xlsx')

    // Two separate batch calls: one for html, one for others
    expect(mockFrom.createSignedUrls).toHaveBeenCalledTimes(2)
    const allCalls = mockFrom.createSignedUrls.mock.calls as Array<[string[], number, { download?: boolean } | undefined]>
    const htmlCall = allCalls.find(([, , opts]) => opts?.download === true)
    const otherCall = allCalls.find(([, , opts]) => !opts?.download)
    expect(htmlCall?.[0]).toEqual(['artifacts/page.html'])
    expect(otherCall?.[0]).toEqual(['artifacts/report.xlsx'])

    // null/undefined inputs are filtered out (Map only has the two valid paths)
    expect(result.size).toBe(2)
  })

  it('short-circuits empty html or other set without a network call for that batch', async () => {
    setup()
    mockFrom.createSignedUrls.mockResolvedValue({ data: [], error: null })
    const { signedArtifactUrls } = await import('@/lib/storage')
    // Only non-HTML paths → html batch is empty → only one network call
    await signedArtifactUrls(['artifacts/doc.pdf'])
    // html batch is empty → short-circuits; only the "other" batch fires
    expect(mockFrom.createSignedUrls).toHaveBeenCalledTimes(1)
  })
})
