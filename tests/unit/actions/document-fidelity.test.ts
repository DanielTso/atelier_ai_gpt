import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

describe('document fidelity persistence', () => {
  beforeEach(async () => { await createTestDb() })

  it('updateDocumentStatus persists page_count, pages_extracted, extraction_partial', async () => {
    const a = await import('@/app/actions')
    const [p] = await a.createProject('Fidelity')
    const [doc] = await a.createUploadingDocument({ projectId: p.id, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 100 })
    await a.updateDocumentStatus(doc.id, 'ready', {
      chunkCount: 3, charCount: 5000, extractionMethod: 'vision',
      pageCount: 80, pagesExtracted: 60, extractionPartial: true,
    })
    const after = await a.getDocumentById(doc.id)
    expect(after!.pageCount).toBe(80)
    expect(after!.pagesExtracted).toBe(60)
    expect(after!.extractionPartial).toBe(true)
  })

  it('commitDocumentReplacement persists the fidelity fields on the swapped row', async () => {
    const a = await import('@/app/actions')
    const [p] = await a.createProject('FidelityR')
    const [doc] = await a.createUploadingDocument({ projectId: p.id, filename: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 })
    await a.commitDocumentReplacement(doc.id, p.id,
      [{ chunkIndex: 0, content: 'x', embedding: null }],
      {
        filename: 'b.pdf', mimeType: 'application/pdf', fileSize: 20, storagePath: 'documents/x/1/rev2/b.pdf',
        thumbnailPath: null, charCount: 30, chunkCount: 1, extractionMethod: 'text', revision: 2, status: 'ready',
        pageCount: 40, pagesExtracted: 25, extractionPartial: true,
      })
    const after = await a.getDocumentById(doc.id)
    expect(after!.pageCount).toBe(40)
    expect(after!.pagesExtracted).toBe(25)
    expect(after!.extractionPartial).toBe(true)
  })
})
