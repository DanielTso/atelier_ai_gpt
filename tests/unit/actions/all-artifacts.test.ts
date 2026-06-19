import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))
vi.mock('@/lib/storage', () => ({
  createSignedDownloadUrl: vi.fn(async (p: string) => `signed:${p}`),
  isStorageConfigured: () => true,
}))

describe('getAllArtifacts', () => {
  beforeEach(async () => { await createTestDb() })

  it('returns all artifacts newest-first with signed urls', async () => {
    const { createProject, createChat, createArtifact, getAllArtifacts } = await import('@/app/actions')
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    await createArtifact({ chatId: c.id, projectId: p.id, type: 'xlsx', title: 'First', storagePath: 'artifacts/a1.xlsx' })
    await createArtifact({ chatId: c.id, projectId: p.id, type: 'pdf', title: 'Second', storagePath: 'artifacts/a2.pdf' })

    const all = await getAllArtifacts()
    expect(all.map(a => a.title)).toContain('First')
    expect(all.map(a => a.title)).toContain('Second')
    const second = all.find(a => a.title === 'Second')!
    expect(second.downloadUrl).toBe('signed:artifacts/a2.pdf')
  })

  it('returns [] when there are no artifacts', async () => {
    const { getAllArtifacts } = await import('@/app/actions')
    expect(await getAllArtifacts()).toEqual([])
  })
})
