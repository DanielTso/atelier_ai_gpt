import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSaveDocumentChunks = vi.fn()
const mockDeleteDocumentChunks = vi.fn()
const mockUpdateDocumentStatus = vi.fn()
const mockChunkText = vi.fn()
const mockEmbedChunks = vi.fn()

async function load() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    saveDocumentChunks: mockSaveDocumentChunks,
    deleteDocumentChunks: mockDeleteDocumentChunks,
    updateChunkEmbedding: vi.fn(),
    updateDocumentStatus: mockUpdateDocumentStatus,
  }))
  vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: vi.fn() }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: mockChunkText }))
  vi.doMock('@/lib/embedChunks', () => ({ embedChunks: mockEmbedChunks }))
  return await import('@/lib/ingest')
}

describe('ingestText', () => {
  beforeEach(() => {
    [mockSaveDocumentChunks, mockDeleteDocumentChunks, mockUpdateDocumentStatus, mockChunkText, mockEmbedChunks].forEach(f => f.mockReset())
    mockChunkText.mockReturnValue([{ index: 0, content: 'a' }, { index: 1, content: 'b' }, { index: 2, content: 'c' }])
    mockSaveDocumentChunks.mockResolvedValue([{ id: 1, content: 'a' }, { id: 2, content: 'b' }, { id: 3, content: 'c' }])
    mockDeleteDocumentChunks.mockResolvedValue([])
    mockUpdateDocumentStatus.mockResolvedValue(undefined)
  })

  it('clears any existing chunks for the document before saving (idempotent re-process)', async () => {
    mockEmbedChunks.mockResolvedValue({ embedded: 3, failed: 0 })
    const { ingestText } = await load()
    await ingestText({ id: 7, projectId: 1 }, 'text', { extractionMethod: 'text' })
    expect(mockDeleteDocumentChunks).toHaveBeenCalledWith(7)
    // Delete must run before the new chunks are written, or a re-process wipes them.
    expect(mockDeleteDocumentChunks.mock.invocationCallOrder[0])
      .toBeLessThan(mockSaveDocumentChunks.mock.invocationCallOrder[0])
  })

  it('flags extraction_partial when some embeds fail, and persists page fields', async () => {
    mockEmbedChunks.mockResolvedValue({ embedded: 2, failed: 1 })
    const { ingestText } = await load()
    const res = await ingestText({ id: 7, projectId: 1 }, 'text', { extractionMethod: 'text', pageCount: 10, pagesExtracted: 10, partial: false })
    expect(res.status).toBe('ready')
    expect(mockUpdateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({
      chunkCount: 3, extractionPartial: true, pageCount: 10, pagesExtracted: 10,
    }))
  })

  it('propagates opts.partial even when all embeds succeed', async () => {
    mockEmbedChunks.mockResolvedValue({ embedded: 3, failed: 0 })
    const { ingestText } = await load()
    await ingestText({ id: 8, projectId: 1 }, 'text', { extractionMethod: 'vision', pageCount: 80, pagesExtracted: 60, partial: true })
    expect(mockUpdateDocumentStatus).toHaveBeenCalledWith(8, 'ready', expect.objectContaining({ extractionPartial: true }))
  })

  it('status error when zero chunks embed', async () => {
    mockEmbedChunks.mockResolvedValue({ embedded: 0, failed: 3 })
    const { ingestText } = await load()
    const res = await ingestText({ id: 9, projectId: 1 }, 'text', { extractionMethod: 'text' })
    expect(res.status).toBe('error')
  })
})
