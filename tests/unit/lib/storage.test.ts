import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = {
  createSignedUploadUrl: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
}
const mockStorage = { from: vi.fn(() => mockFrom) }

function setup(url: string | undefined = 'https://x.supabase.co', key: string | undefined = 'service-key') {
  vi.resetModules()
  if (url) process.env.SUPABASE_URL = url; else delete process.env.SUPABASE_URL
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key; else delete process.env.SUPABASE_SERVICE_ROLE_KEY
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: mockStorage }) }))
}

describe('storage', () => {
  beforeEach(() => {
    Object.values(mockFrom).forEach(fn => fn.mockReset())
    mockStorage.from.mockClear()
  })

  it('isStorageConfigured reflects env', async () => {
    setup(undefined, undefined)
    const a = await import('@/lib/storage')
    expect(a.isStorageConfigured()).toBe(false)
    setup('https://x.supabase.co', 'k')
    const b = await import('@/lib/storage')
    expect(b.isStorageConfigured()).toBe(true)
  })

  it('createSignedUploadUrl returns path + token', async () => {
    setup()
    mockFrom.createSignedUploadUrl.mockResolvedValue({ data: { path: 'documents/1/2/f.pdf', token: 'tok' }, error: null })
    const { createSignedUploadUrl } = await import('@/lib/storage')
    const out = await createSignedUploadUrl('documents/1/2/f.pdf')
    expect(out).toEqual({ path: 'documents/1/2/f.pdf', token: 'tok' })
  })

  it('downloadToBuffer unwraps the Blob', async () => {
    setup()
    mockFrom.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
    const { downloadToBuffer } = await import('@/lib/storage')
    const buf = await downloadToBuffer('p')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBe(3)
  })

  it('createSignedDownloadUrl returns the url', async () => {
    setup()
    mockFrom.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    const { createSignedDownloadUrl } = await import('@/lib/storage')
    expect(await createSignedDownloadUrl('p', 60)).toBe('https://signed')
  })

  it('removeObjects skips empty input and forwards valid paths', async () => {
    setup()
    mockFrom.remove.mockResolvedValue({ data: [], error: null })
    const { removeObjects } = await import('@/lib/storage')
    await removeObjects([])
    expect(mockFrom.remove).not.toHaveBeenCalled()
    await removeObjects(['a', '', 'b'])
    expect(mockFrom.remove).toHaveBeenCalledWith(['a', 'b'])
  })

  it('throws a clear error when an op fails', async () => {
    setup()
    mockFrom.createSignedUrl.mockResolvedValue({ data: null, error: new Error('boom') })
    const { createSignedDownloadUrl } = await import('@/lib/storage')
    await expect(createSignedDownloadUrl('p')).rejects.toThrow('boom')
  })
})
