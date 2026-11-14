import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'
import { documentChunks, documents } from '@/db/schema'
import { eq, asc } from 'drizzle-orm'

const mockCommitDocumentIngest = vi.fn()
const mockChunkText = vi.fn()
const mockEmbedContents = vi.fn()

const vec = () => new Array(768).fill(0.1)

async function load() {
  vi.resetModules()
  vi.doMock('@/app/actions', () => ({
    commitDocumentIngest: mockCommitDocumentIngest,
  }))
  vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: vi.fn() }))
  vi.doMock('@/lib/chunking', () => ({ chunkText: mockChunkText }))
  vi.doMock('@/lib/embedChunks', () => ({ embedContents: mockEmbedContents }))
  return await import('@/lib/ingest')
}

// embedContents result for three chunks where `ok` of them embedded.
function embedResult(ok: number, aborted = false) {
  const embeddings = [0, 1, 2].map(i => (i < ok ? vec() : null))
  return { embeddings, embedded: ok, failed: 3 - ok, skipped: 0, aborted }
}

describe('ingestText', () => {
  beforeEach(() => {
    [mockCommitDocumentIngest, mockChunkText, mockEmbedContents].forEach(f => f.mockReset())
    mockChunkText.mockReturnValue([{ index: 0, content: 'a' }, { index: 1, content: 'b' }, { index: 2, content: 'c' }])
    mockCommitDocumentIngest.mockResolvedValue(undefined)
  })

  // Audit D2: chunks used to be written first and embedded afterwards, so a
  // second ingest of the same document could add a second chunk set. Embedding
  // now happens before any write, and one commit swaps chunks + status.
  it('embeds before writing, then commits chunks and status in one call', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(3))
    const { ingestText } = await load()
    await ingestText({ id: 7, projectId: 1 }, 'text', { extractionMethod: 'text' })
    expect(mockEmbedContents).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(mockEmbedContents.mock.invocationCallOrder[0])
      .toBeLessThan(mockCommitDocumentIngest.mock.invocationCallOrder[0])
    expect(mockCommitDocumentIngest).toHaveBeenCalledTimes(1)
    const [docId, status, , chunks] = mockCommitDocumentIngest.mock.calls[0]
    expect(docId).toBe(7)
    expect(status).toBe('ready')
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toMatchObject({ projectId: 1, chunkIndex: 0, content: 'a', embedding: vec() })
  })

  it('flags extraction_partial when some embeds fail, and persists page fields', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(2))
    const { ingestText } = await load()
    const res = await ingestText({ id: 7, projectId: 1 }, 'text', { extractionMethod: 'text', pageCount: 10, pagesExtracted: 10, partial: false })
    expect(res.status).toBe('ready')
    expect(mockCommitDocumentIngest).toHaveBeenCalledWith(7, 'ready', expect.objectContaining({
      chunkCount: 3, extractionPartial: true, pageCount: 10, pagesExtracted: 10,
    }), expect.any(Array))
    // The chunk whose embed failed is still stored, without a vector.
    expect(mockCommitDocumentIngest.mock.calls[0][3][2].embedding).toBeNull()
  })

  it('propagates opts.partial even when all embeds succeed', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(3))
    const { ingestText } = await load()
    await ingestText({ id: 8, projectId: 1 }, 'text', { extractionMethod: 'vision', pageCount: 80, pagesExtracted: 60, partial: true })
    expect(mockCommitDocumentIngest).toHaveBeenCalledWith(8, 'ready', expect.objectContaining({ extractionPartial: true }), expect.any(Array))
  })

  it('status error when zero chunks embed', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(0))
    const { ingestText } = await load()
    const res = await ingestText({ id: 9, projectId: 1 }, 'text', { extractionMethod: 'text' })
    expect(res.status).toBe('error')
  })

  // Audit B21: the all-embeds-failed exit used to set status 'error' with no
  // errorMessage, so the card showed an error with no reason (or a stale one).
  it('sets an errorMessage when every embed fails', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(0))
    const { ingestText } = await load()
    await ingestText({ id: 9, projectId: 1 }, 'text', { extractionMethod: 'text' })
    expect(mockCommitDocumentIngest).toHaveBeenCalledWith(9, 'error', expect.objectContaining({
      errorMessage: expect.stringMatching(/embed/i),
    }), expect.any(Array))
  })

  it('says the provider was failing when the embed pool stopped early', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(0, true))
    const { ingestText } = await load()
    await ingestText({ id: 9, projectId: 1 }, 'text', { extractionMethod: 'text' })
    const [, , updates] = mockCommitDocumentIngest.mock.calls[0]
    expect(updates.errorMessage).toMatch(/embedding provider/i)
  })

  it('does not set an errorMessage on a ready document', async () => {
    mockEmbedContents.mockResolvedValue(embedResult(3))
    const { ingestText } = await load()
    await ingestText({ id: 9, projectId: 1 }, 'text', { extractionMethod: 'text' })
    const [, status, updates] = mockCommitDocumentIngest.mock.calls[0]
    expect(status).toBe('ready')
    expect(updates.errorMessage ?? null).toBeNull()
  })
})

// Page stamping goes through the real chunker + real actions into PGlite — the
// mock-everything loader above can't see the pageStart/pageEnd columns land.
describe('ingestText page stamping (PGlite)', () => {
  async function loadReal() {
    vi.resetModules()
    // The mock-based describe above registers doMocks for these — undo them so the
    // real chunker/actions/embed pipeline runs against the in-process Postgres.
    vi.doUnmock('@/app/actions')
    vi.doUnmock('@/lib/chunking')
    vi.doUnmock('@/lib/embedChunks')
    vi.doMock('@/db', () => ({ get db() { return testDb } }))
    vi.doMock('@/lib/embeddings', () => ({ generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)) }))
    const { ingestText } = await import('@/lib/ingest')
    const actions = await import('@/app/actions')
    return { ingestText, actions }
  }

  beforeEach(async () => { await createTestDb() })

  async function seedDoc(actions: Awaited<ReturnType<typeof loadReal>>['actions']) {
    const [p] = await actions.createProject('Pages')
    const [doc] = await actions.createUploadingDocument({ projectId: p.id, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 10 })
    return { projectId: p.id, docId: doc.id }
  }

  it('stamps chunk page ranges from # Page anchors in the extracted text', async () => {
    const { ingestText, actions } = await loadReal()
    const { projectId, docId } = await seedDoc(actions)
    // Anchor 12 at offset 0; anchor 13 lands past the first chunk boundary (~2000),
    // so chunk 0 sits wholly in page 12 and the last chunk spans 12→13.
    const text = `# Page 12\n${'a'.repeat(2500)}\n# Page 13\n${'b'.repeat(500)}`
    await ingestText({ id: docId, projectId }, text, { extractionMethod: 'vision' })
    const rows = await testDb.select().from(documentChunks)
      .where(eq(documentChunks.documentId, docId)).orderBy(asc(documentChunks.chunkIndex))
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0].pageStart).toBe(12)
    expect(rows[0].pageEnd).toBe(12)
    const last = rows[rows.length - 1]
    expect(last.pageStart).toBe(12)
    expect(last.pageEnd).toBe(13)
  })

  it('leaves page fields null for anchor-less text', async () => {
    const { ingestText, actions } = await loadReal()
    const { projectId, docId } = await seedDoc(actions)
    await ingestText({ id: docId, projectId }, 'plain extracted text with no page anchors', { extractionMethod: 'text' })
    const rows = await testDb.select().from(documentChunks).where(eq(documentChunks.documentId, docId))
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.pageStart).toBeNull()
      expect(r.pageEnd).toBeNull()
    }
  })

  // Audit D2 (prior probe: two concurrent calls → 12 chunk rows, chunk_count 6).
  // Each ingest now embeds first and swaps the chunk set and the status in one
  // transaction that locks the document row, so the second call replaces the
  // first one's chunks instead of adding to them.
  it('two concurrent ingests of one document leave chunk_count equal to the row count', async () => {
    const { ingestText, actions } = await loadReal()
    const { projectId, docId } = await seedDoc(actions)
    const text = 'x'.repeat(9000)
    await Promise.all([
      ingestText({ id: docId, projectId }, text, { extractionMethod: 'text' }),
      ingestText({ id: docId, projectId }, text, { extractionMethod: 'text' }),
    ])
    const rows = await testDb.select().from(documentChunks).where(eq(documentChunks.documentId, docId))
    const [doc] = await testDb.select().from(documents).where(eq(documents.id, docId))
    expect(rows.length).toBeGreaterThan(1)
    expect(doc.chunkCount).toBe(rows.length)
    expect(new Set(rows.map(r => r.chunkIndex)).size).toBe(rows.length)
    expect(doc.status).toBe('ready')
  })
})
