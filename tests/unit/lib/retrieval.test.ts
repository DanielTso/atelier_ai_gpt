import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  generateEmbedding: vi.fn(),
  findSimilarMessages: vi.fn(),
  findSimilarDocumentChunks: vi.fn(),
  rewriteQuery: vi.fn(),
  rerankCandidates: vi.fn(),
}
function setup(cfgOverrides: Record<string, unknown> = {}) {
  vi.resetModules()
  vi.doMock('@/lib/embeddings', () => ({
    generateEmbedding: (...a: unknown[]) => m.generateEmbedding(...a),
    findSimilarMessages: (...a: unknown[]) => m.findSimilarMessages(...a),
    findSimilarDocumentChunks: (...a: unknown[]) => m.findSimilarDocumentChunks(...a),
  }))
  vi.doMock('@/lib/queryRewrite', () => ({ rewriteQuery: (...a: unknown[]) => m.rewriteQuery(...a) }))
  vi.doMock('@/lib/rerank', () => ({ rerankCandidates: (...a: unknown[]) => m.rerankCandidates(...a) }))
  vi.doMock('@/lib/ragConfig', () => ({ getRagConfig: () => ({
    docThreshold: 0.5, msgThreshold: 0.7, topN: 20, docTopK: 3, msgTopK: 5, mmrLambda: 0.7,
    rewriteEnabled: true, rerankEnabled: true, mmrEnabled: true, ...cfgOverrides,
  }) }))
}

const msgs = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'foundation spec?' }] }]

describe('retrieveContext', () => {
  beforeEach(() => { for (const f of Object.values(m)) f.mockReset() })

  it('runs rewrite -> retrieve -> rerank and builds document context', async () => {
    setup()
    // Multi-turn: rewrite only runs when there's prior context to resolve.
    const multiTurn = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'tell me about the project' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'sure' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'foundation spec?' }] },
    ]
    m.rewriteQuery.mockResolvedValue('standalone foundation query')
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'foundation: 4000psi', similarity: 0.9, chunkId: 1, documentId: 1, filename: 'spec.pdf', embedding: [1,0,0] },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(multiTurn as never, { chatId: 1, projectId: 7 })
    expect(m.rewriteQuery).toHaveBeenCalled()
    expect(m.generateEmbedding).toHaveBeenCalledWith('standalone foundation query', 'query')
    expect(out.documentContext).toContain('spec.pdf')
    expect(out.documentContext).toContain('4000psi')
  })

  it('skips rewrite on the first turn (no prior context to resolve)', async () => {
    setup()
    m.rewriteQuery.mockResolvedValue('should not be used')
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const { retrieveContext } = await import('@/lib/retrieval')
    await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.rewriteQuery).not.toHaveBeenCalled()
    expect(m.generateEmbedding).toHaveBeenCalledWith('foundation spec?', 'query')
  })

  it('still returns (no throw) when embedding generation fails', async () => {
    setup()
    m.rewriteQuery.mockResolvedValue('q')
    m.generateEmbedding.mockRejectedValue(new Error('no embeddings'))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out).toEqual({ semanticContext: null, documentContext: null })
  })

  it('skips rewrite when disabled (uses last user text)', async () => {
    setup({ rewriteEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const { retrieveContext } = await import('@/lib/retrieval')
    await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.rewriteQuery).not.toHaveBeenCalled()
    expect(m.generateEmbedding).toHaveBeenCalledWith('foundation spec?', 'query')
  })
})
