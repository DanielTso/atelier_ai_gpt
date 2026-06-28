import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

// @/db mock must come before any import of actions
vi.mock('@/db', () => ({ get db() { return testDb } }))

// Storage mocks — use vi.hoisted so they're available when vi.mock factory runs
const { mockRemoveObjects, mockCreateSignedDownloadUrl, mockCreateSignedDownloadUrls, mockIsStorageConfigured } = vi.hoisted(() => ({
  mockRemoveObjects: vi.fn(),
  mockCreateSignedDownloadUrl: vi.fn(),
  mockCreateSignedDownloadUrls: vi.fn(),
  mockIsStorageConfigured: vi.fn(),
}))

vi.mock('@/lib/storage', () => ({
  removeObjects: mockRemoveObjects,
  createSignedDownloadUrl: mockCreateSignedDownloadUrl,
  createSignedDownloadUrls: mockCreateSignedDownloadUrls,
  isStorageConfigured: mockIsStorageConfigured,
  // actions.ts also imports these from storage; provide stubs so module loads
  uploadBuffer: vi.fn(),
  signedArtifactUrl: vi.fn().mockResolvedValue(null),
  signedArtifactUrls: vi.fn(async (paths: (string | null | undefined)[]) => new Map(paths.filter(Boolean).map((p) => [p as string, `signed:${p}`]))),
  ARTIFACT_URL_TTL_SECONDS: 86400,
  DOCUMENT_URL_TTL_SECONDS: 3600,
}))

import { createGeneratedImage, getGeneratedImages, deleteGeneratedImage, createProject } from '@/app/actions'

const BASE_IMAGE = {
  projectId: null,
  prompt: 'a blue mountain at dawn',
  aspectRatio: '16:9' as const,
  mediaType: 'image/png',
  storagePath: 'images/standalone/abc.png',
  fileSize: 2048,
}

describe('generated images actions (PGlite)', () => {
  beforeEach(async () => {
    await createTestDb()
    mockRemoveObjects.mockReset()
    mockCreateSignedDownloadUrl.mockReset()
    mockCreateSignedDownloadUrls.mockReset()
    mockIsStorageConfigured.mockReset()
    // Default: storage configured, signs urls
    mockIsStorageConfigured.mockReturnValue(true)
    mockCreateSignedDownloadUrl.mockResolvedValue('https://storage.example.com/signed')
    mockCreateSignedDownloadUrls.mockImplementation(async (paths: string[]) =>
      new Map(paths.map((p: string) => [p, 'https://storage.example.com/signed']))
    )
    mockRemoveObjects.mockResolvedValue(undefined)
  })

  // ── createGeneratedImage ──

  it('inserts a row and returns it', async () => {
    const row = await createGeneratedImage(BASE_IMAGE)
    expect(row).not.toBeNull()
    expect(row!.id).toBeGreaterThan(0)
    expect(row!.prompt).toBe(BASE_IMAGE.prompt)
    expect(row!.aspectRatio).toBe('16:9')
    expect(row!.projectId).toBeNull()
    expect(row!.fileSize).toBe(2048)
  })

  it('stores a project-scoped image', async () => {
    const [proj] = await createProject('Test Project')
    const row = await createGeneratedImage({ ...BASE_IMAGE, projectId: proj!.id, storagePath: 'images/1/abc.png' })
    expect(row!.projectId).toBe(proj!.id)
  })

  // ── getGeneratedImages ──

  it('returns all images when called with no argument', async () => {
    await createGeneratedImage(BASE_IMAGE)
    await createGeneratedImage({ ...BASE_IMAGE, prompt: 'second', storagePath: 'images/standalone/def.png' })
    const imgs = await getGeneratedImages()
    expect(imgs.length).toBe(2)
  })

  it('returns only standalone images when called with null', async () => {
    const [proj] = await createProject('Proj')
    await createGeneratedImage(BASE_IMAGE) // standalone
    await createGeneratedImage({ ...BASE_IMAGE, projectId: proj!.id, storagePath: 'images/p/1.png' }) // project
    const imgs = await getGeneratedImages(null)
    expect(imgs.length).toBe(1)
    expect(imgs[0]!.projectId).toBeNull()
  })

  it('returns only project images when called with a projectId', async () => {
    const [proj] = await createProject('Proj')
    await createGeneratedImage(BASE_IMAGE) // standalone
    await createGeneratedImage({ ...BASE_IMAGE, projectId: proj!.id, storagePath: 'images/p/1.png' })
    const imgs = await getGeneratedImages(proj!.id)
    expect(imgs.length).toBe(1)
    expect(imgs[0]!.projectId).toBe(proj!.id)
  })

  it('returns images with both ids present (ordering)', async () => {
    const r1 = await createGeneratedImage(BASE_IMAGE)
    const r2 = await createGeneratedImage({ ...BASE_IMAGE, storagePath: 'images/standalone/def.png' })
    const imgs = await getGeneratedImages()
    expect(imgs[0]!.id).toBe(r2!.id)
    const ids = imgs.map(i => i.id)
    expect(ids).toContain(r1!.id)
    expect(ids).toContain(r2!.id)
  })

  it('adds a signed url when storage is configured', async () => {
    await createGeneratedImage(BASE_IMAGE)
    const imgs = await getGeneratedImages()
    expect(mockCreateSignedDownloadUrls).toHaveBeenCalled()
    expect(imgs[0]!.url).toBe('https://storage.example.com/signed')
  })

  it('returns url null when storage is not configured', async () => {
    mockIsStorageConfigured.mockReturnValue(false)
    await createGeneratedImage(BASE_IMAGE)
    const imgs = await getGeneratedImages()
    expect(imgs[0]!.url).toBeNull()
  })

  // ── deleteGeneratedImage ──

  it('removes the storage object and deletes the row', async () => {
    const row = await createGeneratedImage(BASE_IMAGE)
    await deleteGeneratedImage(row!.id)

    expect(mockRemoveObjects).toHaveBeenCalledWith([BASE_IMAGE.storagePath])
    const remaining = await getGeneratedImages()
    expect(remaining.length).toBe(0)
  })

  it('is a no-op when the id does not exist', async () => {
    await expect(deleteGeneratedImage(99999)).resolves.not.toThrow()
    expect(mockRemoveObjects).not.toHaveBeenCalled()
  })
})
