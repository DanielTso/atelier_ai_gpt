import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockIsStorageConfigured = vi.fn(() => true)
const mockUploadBuffer = vi.fn(async () => {})
const mockCreateSignedDownloadUrl = vi.fn(async (p: string) => `signed:${p}`)
const mockRemoveObjects = vi.fn(async () => {})

vi.mock('@/lib/storage', () => ({
  get isStorageConfigured() { return mockIsStorageConfigured },
  get uploadBuffer() { return mockUploadBuffer },
  get createSignedDownloadUrl() { return mockCreateSignedDownloadUrl },
  get removeObjects() { return mockRemoveObjects },
}))

import {
  createProject,
  createChat,
  createArtifact,
  getChatArtifacts,
  deleteArtifact,
} from '@/app/actions'

describe('artifact persistence actions', () => {
  beforeEach(async () => {
    await createTestDb()
    mockIsStorageConfigured.mockReturnValue(true)
    mockCreateSignedDownloadUrl.mockReset()
    mockCreateSignedDownloadUrl.mockImplementation(async (p: string) => `signed:${p}`)
    mockRemoveObjects.mockReset()
    mockRemoveObjects.mockResolvedValue(undefined)
  })

  it('creates an artifact and reads it back with a signed downloadUrl', async () => {
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    await createArtifact({ chatId: c.id, projectId: p.id, type: 'xlsx', title: 'Schedule', storagePath: `artifacts/${p.id}/1/schedule.xlsx` })
    const rows = await getChatArtifacts(c.id)
    expect(rows[0].title).toBe('Schedule')
    expect(rows[0].type).toBe('xlsx')
    expect(rows[0].downloadUrl).toBe(`signed:artifacts/${p.id}/1/schedule.xlsx`)
  })

  it('deleteArtifact returns the row (for storage cleanup)', async () => {
    const [p] = await createProject('P')
    const [c] = await createChat(p.id, 'C')
    const [a] = await createArtifact({ chatId: c.id, projectId: p.id, type: 'pdf', title: 'R', storagePath: 'artifacts/x.pdf' })
    const [d] = await deleteArtifact(a.id)
    expect(d.id).toBe(a.id)
  })
})
