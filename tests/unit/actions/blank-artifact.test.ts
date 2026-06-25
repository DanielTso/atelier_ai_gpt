import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

const mockUpload = vi.fn(async () => {})
const mockRemove = vi.fn(async () => {})
vi.mock('@/lib/storage', () => ({
  isStorageConfigured: () => true,
  uploadBuffer: (...a: unknown[]) => mockUpload(...a),
  removeObjects: (...a: unknown[]) => mockRemove(...a),
  signedArtifactUrl: vi.fn(async (p: string | null) => (p ? `signed:${p}` : null)),
  ARTIFACT_URL_TTL_SECONDS: 86400,
}))

describe('createBlankArtifact', () => {
  beforeEach(async () => { await createTestDb(); mockUpload.mockClear(); mockRemove.mockClear() })

  it('creates a host chat + a ready artifact (v1) for html', async () => {
    const a = await import('@/app/actions')
    const { artifactId, chatId } = await a.createBlankArtifact('html')
    expect(chatId).toBeGreaterThan(0)
    const art = await a.getArtifactById(artifactId)
    expect(art?.status).toBe('ready')
    expect(art?.type).toBe('html')
    expect(art?.currentVersion).toBe(1)
    expect(art?.chatId).toBe(chatId)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    // The host chat exists and is standalone.
    const standalone = await a.getStandaloneChats()
    expect(standalone.some(c => c.id === chatId)).toBe(true)
  })

  it('surfaces it in getAllArtifacts with editedAt + chatTitle', async () => {
    const a = await import('@/app/actions')
    const { artifactId } = await a.createBlankArtifact('docx')
    const all = await a.getAllArtifacts()
    const row = all.find(r => r.id === artifactId)
    expect(row).toBeTruthy()
    expect(row!.chatTitle).toContain('Untitled')
    expect(row!.editedAt).toBeTruthy()
  })
})
