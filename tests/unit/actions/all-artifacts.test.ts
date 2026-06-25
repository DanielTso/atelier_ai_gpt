import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))
vi.mock('@/lib/storage', () => ({
  createSignedDownloadUrl: vi.fn(async (p: string) => `signed:${p}`),
  signedArtifactUrl: vi.fn(async (p: string | null) => (p ? `signed:${p}` : null)),
  isStorageConfigured: () => true,
  ARTIFACT_URL_TTL_SECONDS: 86400,
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

  it('addArtifactVersion appends v2 and bumps the current pointer', async () => {
    const { createProject, createChat, createArtifact, addArtifactVersion, getChatArtifacts, getArtifactVersions } = await import('@/app/actions')
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    const [row] = await createArtifact({ chatId: c.id, projectId: p.id, type: 'docx', title: 'Doc', storagePath: 'a/1.docx', format: 'markdown', content: '# v1' })
    const res = await addArtifactVersion(row.id, { type: 'docx', title: 'Doc', format: 'markdown', content: '# v2', storagePath: 'a/2.docx' })
    expect(res.version).toBe(2)

    const [summary] = await getChatArtifacts(c.id)
    expect(summary.version).toBe(2)
    expect(summary.content).toBe('# v2')
    expect(summary.downloadUrl).toBe('signed:a/2.docx')
    expect((await getArtifactVersions(row.id)).map(v => v.version)).toEqual([2, 1])
  })

  it('restoreArtifactVersion re-points current to an older version', async () => {
    const { createProject, createChat, createArtifact, addArtifactVersion, restoreArtifactVersion, getChatArtifacts } = await import('@/app/actions')
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    const [row] = await createArtifact({ chatId: c.id, projectId: p.id, type: 'docx', title: 'Doc', storagePath: 'a/1.docx', format: 'markdown', content: '# v1' })
    await addArtifactVersion(row.id, { type: 'docx', title: 'Doc', format: 'markdown', content: '# v2', storagePath: 'a/2.docx' })
    const res = await restoreArtifactVersion(row.id, 1)
    expect(res?.version).toBe(1)

    const [summary] = await getChatArtifacts(c.id)
    expect(summary.version).toBe(1)
    expect(summary.content).toBe('# v1')
    expect(summary.downloadUrl).toBe('signed:a/1.docx')
  })
})
