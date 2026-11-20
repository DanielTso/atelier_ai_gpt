import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockIsStorageConfigured = vi.fn(() => true)
const mockListObjects = vi.fn<(prefix: string) => Promise<Array<{ name: string; createdAt: string | null }>>>(async () => [])
const mockRemoveObjects = vi.fn<(paths: string[]) => Promise<void>>(async () => {})

// Storage is always mocked — these tests never reach Supabase.
vi.mock('@/lib/storage', () => ({
  get isStorageConfigured() { return mockIsStorageConfigured },
  get listObjects() { return mockListObjects },
  get removeObjects() { return mockRemoveObjects },
}))

import { sweepPrefix, PENDING_ATTACHMENT_MAX_AGE_MS } from '@/lib/attachmentSweep'

const NOW = Date.parse('2026-11-20T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60 * 1000

describe('sweepPrefix', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockIsStorageConfigured.mockReset().mockReturnValue(true)
    mockListObjects.mockReset().mockResolvedValue([])
    mockRemoveObjects.mockReset().mockResolvedValue(undefined)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('pending uploads expire after one hour', () => {
    expect(PENDING_ATTACHMENT_MAX_AGE_MS).toBe(60 * 60 * 1000)
  })

  it('removes only the objects older than the age, under the given prefix', async () => {
    mockListObjects.mockResolvedValue([
      { name: 'old.txt', createdAt: ago(2 * 60 * MIN) },
      { name: 'fresh.txt', createdAt: ago(10 * MIN) },
      { name: 'unknown.txt', createdAt: null },
      { name: 'older.pdf', createdAt: ago(61 * MIN) },
    ])

    expect(await sweepPrefix('attachments/7/pending/', PENDING_ATTACHMENT_MAX_AGE_MS, NOW)).toBe(2)

    expect(mockListObjects).toHaveBeenCalledExactlyOnceWith('attachments/7/pending')
    expect(mockRemoveObjects).toHaveBeenCalledExactlyOnceWith(['attachments/7/pending/old.txt', 'attachments/7/pending/older.pdf'])
  })

  it('removes nothing (no remove call) when nothing is past the age', async () => {
    mockListObjects.mockResolvedValue([{ name: 'fresh.txt', createdAt: ago(MIN) }])

    expect(await sweepPrefix('attachments/7/pending', PENDING_ATTACHMENT_MAX_AGE_MS, NOW)).toBe(0)

    expect(mockListObjects).toHaveBeenCalledExactlyOnceWith('attachments/7/pending')
    expect(mockRemoveObjects).not.toHaveBeenCalled()
  })

  it('age 0 removes everything listed, including objects with no creation time', async () => {
    mockListObjects.mockResolvedValue([
      { name: 'a.png', createdAt: ago(MIN) },
      { name: 'b.png', createdAt: null },
      { name: 'c.png', createdAt: new Date(NOW + MIN).toISOString() },
    ])

    expect(await sweepPrefix('attachments/9/generated/', 0, NOW)).toBe(3)

    expect(mockRemoveObjects).toHaveBeenCalledExactlyOnceWith(['attachments/9/generated/a.png', 'attachments/9/generated/b.png', 'attachments/9/generated/c.png'])
  })

  it('a listObjects failure resolves to 0 and removes nothing', async () => {
    mockListObjects.mockRejectedValue(new Error('storage down'))

    await expect(sweepPrefix('attachments/7/pending/', 0, NOW)).resolves.toBe(0)

    expect(mockRemoveObjects).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('a removeObjects failure resolves to 0', async () => {
    mockListObjects.mockResolvedValue([{ name: 'old.txt', createdAt: ago(2 * 60 * MIN) }])
    mockRemoveObjects.mockRejectedValue(new Error('storage down'))

    await expect(sweepPrefix('attachments/7/pending/', PENDING_ATTACHMENT_MAX_AGE_MS, NOW)).resolves.toBe(0)

    expect(warn).toHaveBeenCalledOnce()
  })

  it('Storage not configured → no Storage calls', async () => {
    mockIsStorageConfigured.mockReturnValue(false)

    expect(await sweepPrefix('attachments/7/pending/', 0, NOW)).toBe(0)

    expect(mockListObjects).not.toHaveBeenCalled()
    expect(mockRemoveObjects).not.toHaveBeenCalled()
  })
})
