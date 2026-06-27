import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  saveDocumentChunks: vi.fn(), updateChunkEmbedding: vi.fn(), updateDocumentStatus: vi.fn(),
  generateEmbedding: vi.fn(), chunkText: vi.fn(),
}

async function importIngest() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    saveDocumentChunks: m.saveDocumentChunks, updateChunkEmbedding: m.updateChunkEmbedding, updateDocumentStatus: m.updateDocumentStatus,
  }))
  vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: m.generateEmbedding }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: m.chunkText }))
  return (await import('@/lib/ingest')).ingestText
}

describe('ingestText', () => {
  beforeEach(() => {
    Object.values(m).forEach(f => f.mockReset())
    m.chunkText.mockReturnValue([{ index: 0, content: 'chunk' }])
    m.saveDocumentChunks.mockResolvedValue([{ id: 11, content: 'chunk' }])
    m.generateEmbedding.mockResolvedValue(new Array(768).fill(0.1))
    m.updateChunkEmbedding.mockResolvedValue(undefined)
    m.updateDocumentStatus.mockResolvedValue(undefined)
  })

  it('chunks, saves, embeds, sets status ready', async () => {
    const ingestText = await importIngest()
    const res = await ingestText({ id: 7, projectId: 1 }, 'hello body', { extractionMethod: 'text' })
    expect(res).toEqual({ status: 'ready', chunkCount: 1 })
    expect(m.chunkText).toHaveBeenCalledWith('hello body')
    expect(m.saveDocumentChunks).toHaveBeenCalledWith([{ documentId: 7, projectId: 1, chunkIndex: 0, content: 'chunk' }])
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({ chunkCount: 1, charCount: 10, extractionMethod: 'text' }))
  })

  it('all embeddings failing → status error', async () => {
    m.generateEmbedding.mockRejectedValue(new Error('embed down'))
    const ingestText = await importIngest()
    const res = await ingestText({ id: 8, projectId: 1 }, 'body', { extractionMethod: 'text' })
    expect(res.status).toBe('error')
    expect(m.updateDocumentStatus).toHaveBeenCalledWith(8, 'error', expect.objectContaining({ chunkCount: 1 }))
  })
})
