import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'
import { documentChunks } from '@/db/schema'
import { eq, asc } from 'drizzle-orm'

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
})
