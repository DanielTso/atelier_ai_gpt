import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetChatArtifacts = vi.fn()
const mockGetArtifactById = vi.fn()
const mockDeleteArtifact = vi.fn()
const mockRemoveObjects = vi.fn()

async function importRoute() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({ getChatArtifacts: mockGetChatArtifacts, getArtifactById: mockGetArtifactById, deleteArtifact: mockDeleteArtifact }))
  vi.doMock('@/lib/storage', () => ({ removeObjects: mockRemoveObjects }))
  return await import('@/app/api/artifacts/route')
}

describe('artifacts route', () => {
  beforeEach(() => { [mockGetChatArtifacts, mockGetArtifactById, mockDeleteArtifact, mockRemoveObjects].forEach(f => f.mockReset()) })

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
})
