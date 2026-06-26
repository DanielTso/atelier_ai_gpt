import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetChatArtifacts = vi.fn()
const mockGetArtifactById = vi.fn()
const mockGetArtifactVersionPaths = vi.fn()
const mockDeleteArtifact = vi.fn()
const mockRemoveObjects = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    getChatArtifacts: mockGetChatArtifacts, getArtifactById: mockGetArtifactById,
    getArtifactVersionPaths: mockGetArtifactVersionPaths, deleteArtifact: mockDeleteArtifact,
  }))
  vi.doMock('@/lib/storage', () => ({ removeObjects: mockRemoveObjects }))
  return await import('@/app/api/artifacts/route')
}

describe('artifacts route', () => {
  beforeEach(() => {
    [mockGetChatArtifacts, mockGetArtifactById, mockGetArtifactVersionPaths, mockDeleteArtifact, mockRemoveObjects].forEach(f => f.mockReset())
    mockGetArtifactVersionPaths.mockResolvedValue([])
  })

  it('GET returns chat artifacts', async () => {
    mockGetChatArtifacts.mockResolvedValue([{ id: 1, title: 'R', type: 'pdf', downloadUrl: 'signed:x' }])
    const { GET } = await importRoute()
    const res = await GET(new Request('http://localhost/api/artifacts?chatId=3') as never)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.artifacts[0].downloadUrl).toBe('signed:x')
  })

  it('DELETE removes the storage object then the row', async () => {
    mockGetArtifactById.mockResolvedValue({ id: 5, storagePath: 'artifacts/5/r.pdf' })
    mockRemoveObjects.mockResolvedValue(undefined); mockDeleteArtifact.mockResolvedValue([{ id: 5 }])
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request('http://localhost/api/artifacts?id=5', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    expect(mockRemoveObjects).toHaveBeenCalledWith(['artifacts/5/r.pdf'])
    expect(mockDeleteArtifact).toHaveBeenCalledWith(5)
  })

  it('DELETE sweeps the current file AND every superseded version file (deduped)', async () => {
    mockGetArtifactById.mockResolvedValue({ id: 5, storagePath: 'artifacts/5/cur.pdf' })
    // cur.pdf is also the latest version's path → must be deduped, not removed twice.
    mockGetArtifactVersionPaths.mockResolvedValue(['artifacts/5/cur.pdf', 'artifacts/5/v1.pdf', 'artifacts/5/v2.pdf'])
    mockRemoveObjects.mockResolvedValue(undefined); mockDeleteArtifact.mockResolvedValue([{ id: 5 }])
    const { DELETE } = await importRoute()
    const res = await DELETE(new Request('http://localhost/api/artifacts?id=5', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    const swept = mockRemoveObjects.mock.calls[0]![0] as string[]
    expect(new Set(swept)).toEqual(new Set(['artifacts/5/cur.pdf', 'artifacts/5/v1.pdf', 'artifacts/5/v2.pdf']))
    expect(swept).toHaveLength(3) // deduped
    expect(mockDeleteArtifact).toHaveBeenCalledWith(5)
  })
})
