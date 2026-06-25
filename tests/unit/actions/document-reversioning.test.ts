import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

describe('document re-versioning actions', () => {
  beforeEach(async () => { await createTestDb() })

  it('snapshots the old revision, clears old chunks, and bumps the revision in place', async () => {
    const a = await import('@/app/actions')
    const [p] = await a.createProject('Drover')

    // Rev 1: a "ready" document with chunks.
    const [doc] = await a.createUploadingDocument({ projectId: p.id, filename: 'grading-revA.pdf', mimeType: 'application/pdf', fileSize: 1000 })
    await a.updateDocumentStoragePath(doc.id, 'documents/x/1/grading-revA.pdf')
    await a.saveDocumentChunks([
      { documentId: doc.id, projectId: p.id, chunkIndex: 0, content: 'rev A chunk 0' },
      { documentId: doc.id, projectId: p.id, chunkIndex: 1, content: 'rev A chunk 1' },
    ])
    await a.updateDocumentStatus(doc.id, 'ready', { chunkCount: 2, charCount: 50, extractionMethod: 'text' })

    const before = await a.getDocumentById(doc.id)
    expect(before!.revision).toBe(1)

    // Replace → Rev 2: snapshot old, clear old chunks, save new, apply.
    await a.createDocumentRevision({
      documentId: doc.id, projectId: p.id, revision: before!.revision,
      filename: before!.filename, mimeType: before!.mimeType, fileSize: before!.fileSize,
      storagePath: before!.storagePath, thumbnailPath: before!.thumbnailPath,
      charCount: before!.charCount, chunkCount: before!.chunkCount, extractionMethod: before!.extractionMethod,
    })
    // Live flow: one transactional commit swaps chunks + metadata + revision in place.
    await a.commitDocumentReplacement(doc.id, p.id,
      [{ chunkIndex: 0, content: 'rev B chunk 0', embedding: null }],
      {
        filename: 'grading-revB.pdf', mimeType: 'application/pdf', fileSize: 1200,
        storagePath: 'documents/x/1/rev2/grading-revB.pdf', thumbnailPath: null,
        charCount: 30, chunkCount: 1, extractionMethod: 'text', revision: 2, status: 'ready',
      })

    const after = await a.getDocumentById(doc.id)
    expect(after!.id).toBe(doc.id)            // same document identity
    expect(after!.revision).toBe(2)
    expect(after!.filename).toBe('grading-revB.pdf')
    expect(after!.status).toBe('ready')
    expect(after!.updatedAt).not.toBeNull()

    // Old chunks gone, new chunk present.
    const chunks = await a.getDocumentChunks(doc.id)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe('rev B chunk 0')

    // The superseded revision is retained as history.
    const revisions = await a.getDocumentRevisions(doc.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0].revision).toBe(1)
    expect(revisions[0].filename).toBe('grading-revA.pdf')
    expect(revisions[0].storagePath).toBe('documents/x/1/grading-revA.pdf')
  })
})
