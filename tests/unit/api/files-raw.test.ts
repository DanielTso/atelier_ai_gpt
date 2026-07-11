import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockIsConfigured = vi.fn(() => true)
const mockDownload = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/lib/storage', () => ({
    isStorageConfigured: mockIsConfigured,
    downloadToBuffer: mockDownload,
  }))
  const { GET } = await import('@/app/api/files/raw/route')
  return GET
}

const req = (path: string) => new NextRequest(`http://localhost/api/files/raw?path=${encodeURIComponent(path)}`)

describe('GET /api/files/raw', () => {
  beforeEach(() => {
    mockIsConfigured.mockReturnValue(true)
    mockDownload.mockReset()
    mockDownload.mockResolvedValue(Buffer.from('img-bytes'))
  })

  it('streams an allow-listed generated chat image with immutable caching', async () => {
    const GET = await importRoute()
    const res = await GET(req('attachments/7/generated/0b6cc1a2-1111-2222-3333-444455556666.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toContain('immutable')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('streams a standalone Images-studio path', async () => {
    const GET = await importRoute()
    expect((await GET(req('images/standalone/abc-def.webp'))).status).toBe(200)
    expect((await GET(req('images/12/abc-def.jpeg'))).status).toBe(200)
  })

  it('rejects anything outside the generated-image allow-list', async () => {
    const GET = await importRoute()
    for (const bad of [
      'documents/1/23/plan.pdf',                       // other storage areas
      'attachments/7/generated/../../secrets.png',     // traversal
      'attachments/7/generated/evil.html',             // non-image extension
      'artifacts/1/2/page.html',
      '',                                              // missing
    ]) {
      const res = await GET(req(bad))
      expect(res.status, `path: ${bad}`).toBe(400)
    }
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('503 when storage is not configured, 502 when the download fails', async () => {
    mockIsConfigured.mockReturnValue(false)
    let GET = await importRoute()
    expect((await GET(req('attachments/7/generated/a-b.png'))).status).toBe(503)

    mockIsConfigured.mockReturnValue(true)
    mockDownload.mockRejectedValue(new Error('boom'))
    GET = await importRoute()
    expect((await GET(req('attachments/7/generated/a-b.png'))).status).toBe(502)
  })
})
