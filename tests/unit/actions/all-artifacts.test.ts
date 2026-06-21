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

  it('stores source content + format + version, and seeds version 1', async () => {
    const { createProject, createChat, createArtifact, getChatArtifacts, getArtifactVersions } = await import('@/app/actions')
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    const [row] = await createArtifact({
      chatId: c.id, projectId: p.id, type: 'pptx', title: 'Deck',
      storagePath: 'artifacts/deck.pptx', format: 'markdown', content: '# Slide One',
    })
    expect(row.currentVersion).toBe(1)

    const [summary] = await getChatArtifacts(c.id)
    expect(summary.format).toBe('markdown')
    expect(summary.content).toBe('# Slide One')
    expect(summary.version).toBe(1)

    const versions = await getArtifactVersions(row.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, type: 'pptx', title: 'Deck', format: 'markdown', content: '# Slide One' })
    expect(versions[0].downloadUrl).toBe('signed:artifacts/deck.pptx')
  })
})
