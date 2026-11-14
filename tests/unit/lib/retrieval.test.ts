import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  generateEmbedding: vi.fn(),
  findSimilarMessages: vi.fn(),
  findSimilarDocumentChunks: vi.fn(),
  rewriteQuery: vi.fn(),
  rerankCandidates: vi.fn(),
  findChunksByKeyword: vi.fn(),
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
  // retrieval.ts now imports keywordSearch directly (the RRF keyword leg) — mock it
  // so the real module (which imports @/db) never loads in this unit test.
  vi.doMock('@/lib/keywordSearch', () => ({ findChunksByKeyword: (...a: unknown[]) => m.findChunksByKeyword(...a) }))
  vi.doMock('@/lib/ragConfig', () => ({ getRagConfig: () => ({
    docThreshold: 0.5, msgThreshold: 0.7, topN: 20, docTopK: 3, msgTopK: 5, mmrLambda: 0.7,
    rewriteEnabled: true, rerankEnabled: true, mmrEnabled: true,
    hybridEnabled: true, rrfK: 60, keywordTopN: 20, stageTimeoutMs: 4000, ...cfgOverrides,
  }) }))
  // Default: no keyword hits, so existing vector-only test expectations hold unchanged.
  m.findChunksByKeyword.mockResolvedValue([])
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
    expect(m.generateEmbedding).toHaveBeenCalledWith('standalone foundation query', 'query', expect.objectContaining({ maxRetries: 0 }))
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
    expect(m.generateEmbedding).toHaveBeenCalledWith('foundation spec?', 'query', expect.objectContaining({ maxRetries: 0 }))
  })

  it('still returns (no throw) when embedding generation fails', async () => {
    setup()
    m.rewriteQuery.mockResolvedValue('q')
    m.generateEmbedding.mockRejectedValue(new Error('no embeddings'))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out).toEqual({ semanticContext: null, documentContext: null })
  })

  it('returns document context even when the message path throws (independent guard)', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockRejectedValue(new Error('msg path down'))
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'doc body', similarity: 0.9, chunkId: 1, documentId: 1, filename: 'spec.pdf', embedding: [1, 0, 0] },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    // The message failure must NOT also null out the document context.
    expect(out.semanticContext).toBeNull()
    expect(out.documentContext).toContain('spec.pdf')
  })

  it('skips rewrite when disabled (uses last user text)', async () => {
    setup({ rewriteEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const { retrieveContext } = await import('@/lib/retrieval')
    await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.rewriteQuery).not.toHaveBeenCalled()
    expect(m.generateEmbedding).toHaveBeenCalledWith('foundation spec?', 'query', expect.objectContaining({ maxRetries: 0 }))
  })

  it('RRF-fuses vector + keyword hits and surfaces a keyword-only hit through MMR', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'vector hit', similarity: 0.9, chunkId: 1, documentId: 1, filename: 'a.pdf', embedding: [1, 0, 0] },
    ])
    // Keyword-only exact match (e.g. sheet number "SW-101") — no embedding, so it
    // can never come back from the vector leg, but it's a genuine hit by construction.
    m.findChunksByKeyword.mockResolvedValue([
      { content: 'SW-101 keyword hit', chunkId: 2, documentId: 2, filename: 'b.pdf', embedding: null },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.findChunksByKeyword).toHaveBeenCalledWith('foundation spec?', 7, 20, undefined)
    expect(out.documentContext).toContain('vector hit')
    expect(out.documentContext).toContain('SW-101 keyword hit')
  })

  it('skips the keyword leg entirely when hybridEnabled is false', async () => {
    setup({ hybridEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'vector only', similarity: 0.9, chunkId: 1, documentId: 1, filename: 'a.pdf', embedding: [1, 0, 0] },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.findChunksByKeyword).not.toHaveBeenCalled()
    expect(out.documentContext).toContain('vector only')
  })

  it('keyword-only hit survives the final slice when rerank is disabled', async () => {
    setup({ rerankEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    // Enough embedded candidates that MMR's picks alone would fill a plain
    // head-slice of docTopK (3) — the keyword-only tail must still get a slot.
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'vec A', similarity: 0.95, chunkId: 1, documentId: 1, filename: 'a.pdf', embedding: [1, 0, 0] },
      { content: 'vec B', similarity: 0.9, chunkId: 2, documentId: 1, filename: 'a.pdf', embedding: [0, 1, 0] },
      { content: 'vec C', similarity: 0.85, chunkId: 3, documentId: 1, filename: 'a.pdf', embedding: [0, 0, 1] },
      { content: 'vec D', similarity: 0.8, chunkId: 4, documentId: 1, filename: 'a.pdf', embedding: [1, 1, 0] },
    ])
    m.findChunksByKeyword.mockResolvedValue([
      { content: 'SW-101 keyword-only', chunkId: 9, documentId: 2, filename: 'b.pdf', embedding: null },
    ])
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.rerankCandidates).not.toHaveBeenCalled()
    expect(out.documentContext).toContain('SW-101 keyword-only')
    // Reserving a slot must not push out the top vector pick.
    expect(out.documentContext).toContain('vec A')
  })

  it('renders a source header with a page range and §c anchor', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'foundation: 4000psi', similarity: 0.9, chunkId: 12, documentId: 4, filename: 'spec.pdf', embedding: [1, 0, 0], pageStart: 3, pageEnd: 5 },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toContain('[Source: doc 4 "spec.pdf" p.3–5 §c12]\nfoundation: 4000psi')
  })

  it('renders a single-page header without a range dash', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'note 7', similarity: 0.9, chunkId: 8, documentId: 2, filename: 'notes.pdf', embedding: [1, 0, 0], pageStart: 4, pageEnd: 4 },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toContain('[Source: doc 2 "notes.pdf" p.4 §c8]\nnote 7')
  })

  it('renders a header without pages (null pageStart) but always with the §c anchor', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'legacy chunk', similarity: 0.9, chunkId: 3, documentId: 1, filename: 'old.pdf', embedding: [1, 0, 0], pageStart: null, pageEnd: null },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toContain('[Source: doc 1 "old.pdf" §c3]\nlegacy chunk')
  })

  it('renders the source header with a sanitized filename (no quote/bracket/newline breakout)', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'body', similarity: 0.9, chunkId: 5, documentId: 3, filename: 'Spec" p.1 §c1]\n[Source: doc 9 "x"', embedding: [1, 0, 0], pageStart: 2, pageEnd: 2 },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toBe('[Source: doc 3 "Spec p.1 §c1 Source: doc 9 x" p.2 §c5]\nbody')
  })

  it('threads excludeDocumentIds to both document finders', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    await retrieveContext(msgs as never, { chatId: 1, projectId: 7, excludeDocumentIds: [5, 9] })
    expect(m.findSimilarDocumentChunks).toHaveBeenCalledWith([1, 0, 0], 7, 20, 0.5, true, [5, 9])
    expect(m.findChunksByKeyword).toHaveBeenCalledWith('foundation spec?', 7, 20, [5, 9])
  })

  it('degrades to vector-only when the keyword leg throws', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'vector hit', similarity: 0.9, chunkId: 1, documentId: 1, filename: 'a.pdf', embedding: [1, 0, 0] },
    ])
    m.findChunksByKeyword.mockRejectedValue(new Error('fts index down'))
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toContain('vector hit')
  })
  // Audit B5: the chunk found by BOTH legs (keyword rank 1, vector rank 15) tops the
  // fused list. MMR used to re-rank every embedded candidate by raw similarity and
  // keep only docTopK*2 of them, so it dropped chunk 15 while keyword-only chunk 99
  // survived. Being found by both legs must never be worse than keyword alone.
  it('fused-chunk-survives-mmr', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    const oneHot = (i: number) => Array.from({ length: 24 }, (_, j) => (j === i ? 1 : 0))
    // Vector leg: chunks 1..20 by descending similarity, so chunk 15 is rank 15.
    m.findSimilarDocumentChunks.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({
      content: `vec ${i + 1}`, similarity: 0.95 - i * 0.01, chunkId: i + 1, documentId: 1,
      filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: oneHot(i),
    })))
    // Keyword leg: chunk 15 first, then keyword-only chunk 99. RRF top 5 = [15, 1, 2, 99, 3].
    m.findChunksByKeyword.mockResolvedValue([
      { content: 'vec 15', chunkId: 15, documentId: 1, filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: null },
      { content: 'kw 99', chunkId: 99, documentId: 1, filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: null },
    ])
    // A rerank that keeps the incoming order (its fallback on failure or timeout).
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown[], k: number) => Promise.resolve(c.slice(0, k)))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toContain('§c15]')
    // The candidates handed to rerank arrive in fused order, so its fallback is sane.
    const docCall = m.rerankCandidates.mock.calls.find(c => (c[1] as { chunkId?: number }[])[0]?.chunkId != null)!
    const handed = (docCall[1] as { chunkId: number }[]).map(c => c.chunkId)
    expect(handed[0]).toBe(15)
  })

  it('fused chunk also survives the no-rerank slice', async () => {
    setup({ rerankEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    const oneHot = (i: number) => Array.from({ length: 24 }, (_, j) => (j === i ? 1 : 0))
    m.findSimilarDocumentChunks.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({
      content: `vec ${i + 1}`, similarity: 0.95 - i * 0.01, chunkId: i + 1, documentId: 1,
      filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: oneHot(i),
    })))
    m.findChunksByKeyword.mockResolvedValue([
      { content: 'vec 15', chunkId: 15, documentId: 1, filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: null },
    ])
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext?.startsWith('[Source: doc 1 "a.pdf" §c15]')).toBe(true)
  })

  // Audit B10: the keyword leg is pure Postgres and must not die with the embedding.
  it('keyword-leg-survives-embedding-failure', async () => {
    setup()
    m.generateEmbedding.mockRejectedValue(new Error('429 quota exhausted'))
    m.findChunksByKeyword.mockResolvedValue([
      { content: 'SW-101 storm drain', chunkId: 4, documentId: 2, filename: 'plans.pdf', pageStart: 3, pageEnd: 3, embedding: null },
    ])
    m.rerankCandidates.mockImplementation((_q: unknown, c: unknown) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out.documentContext).toContain('SW-101 storm drain')
    expect(out.semanticContext).toBeNull()
    expect(m.findSimilarDocumentChunks).not.toHaveBeenCalled()
    expect(m.findSimilarMessages).not.toHaveBeenCalled()
  })

  // Audit B9: messages already in the prompt must not come back as "previous
  // conversations" context.
  it('excludes-current-chat-messages', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const { retrieveContext } = await import('@/lib/retrieval')
    await retrieveContext(msgs as never, { chatId: 3, projectId: 7, excludeChatId: 3 })
    expect(m.findSimilarMessages).toHaveBeenCalledWith(
      [1, 0, 0], expect.objectContaining({ projectId: 7, excludeChatId: 3 }), 20, 0.7, true,
    )
  })

  it('skips message retrieval for a standalone chat whose whole history is in the prompt', async () => {
    setup()
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([
      { content: 'a turn of this same chat', similarity: 0.9, chatId: 3, messageId: 5, embedding: [1, 0, 0] },
    ])
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 3, projectId: null, excludeChatId: 3 })
    expect(m.findSimilarMessages).not.toHaveBeenCalled()
    expect(out.semanticContext).toBeNull()
  })

  // Phase B follow-up: the exclusion set is the ids actually SENT (the route's
  // recentTail), not every id in the posted history. A loaded message the route
  // trimmed (id 10 here) is in no other layer, so semantic retrieval must keep it.
  it('excludes exactly the sent message ids, not the whole posted history', async () => {
    setup({ rerankEnabled: false, mmrEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([
      { content: 'trimmed older turn', similarity: 0.9, chatId: 3, messageId: 10, embedding: null },
    ])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const posted = [
      { id: '10', role: 'user', parts: [{ type: 'text', text: 'older question' }] },
      { id: '11', role: 'user', parts: [{ type: 'text', text: 'foundation spec?' }] },
    ]
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(posted as never, { chatId: 3, projectId: 7, excludeMessageIds: [11] })
    expect(m.findSimilarMessages).toHaveBeenCalledWith(
      [1, 0, 0], expect.objectContaining({ excludeMessageIds: [11] }), 20, 0.7, false,
    )
    expect(m.findSimilarMessages.mock.calls[0]![1]).not.toHaveProperty('excludeChatId')
    expect(out.semanticContext).toBe('trimmed older turn')
  })

  // Audit B11: a stalled Gemini call is bounded by RAG_STAGE_TIMEOUT_MS and degrades.
  it('best-effort-calls-time-out', async () => {
    setup({ stageTimeoutMs: 200 })
    const multiTurn = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'tell me about the project' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'sure' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'foundation spec?' }] },
    ]
    m.rewriteQuery.mockReturnValue(new Promise(() => {}))
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const { retrieveContext } = await import('@/lib/retrieval')
    const t0 = Date.now()
    await retrieveContext(multiTurn as never, { chatId: 1, projectId: 7 })
    expect(Date.now() - t0).toBeLessThan(200 + 500)
    expect(m.generateEmbedding).toHaveBeenCalledWith('foundation spec?', 'query', expect.objectContaining({ maxRetries: 0 }))
    const rewriteOpts = m.rewriteQuery.mock.calls[0]![1] as { abortSignal?: AbortSignal }
    expect(rewriteOpts.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('a stalled embedding and a stalled rerank both degrade within the stage timeout', async () => {
    setup({ stageTimeoutMs: 200 })
    m.generateEmbedding.mockReturnValue(new Promise(() => {}))
    m.findChunksByKeyword.mockResolvedValue([
      { content: 'kw A', chunkId: 1, documentId: 1, filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: null },
      { content: 'kw B', chunkId: 2, documentId: 1, filename: 'a.pdf', pageStart: null, pageEnd: null, embedding: null },
    ])
    m.rerankCandidates.mockReturnValue(new Promise(() => {}))
    const { retrieveContext } = await import('@/lib/retrieval')
    const t0 = Date.now()
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(Date.now() - t0).toBeLessThan(2 * 200 + 500)
    expect(out.documentContext).toContain('kw A')
    expect(out.documentContext).toContain('kw B')
  })
})
