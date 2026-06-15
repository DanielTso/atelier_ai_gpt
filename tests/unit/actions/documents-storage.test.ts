import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import { createProject } from '@/app/actions'

describe('document storage actions', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('creates an uploading doc, sets storage path, reads it back, updates status with thumbnail', async () => {
    const { createUploadingDocument, updateDocumentStoragePath, getDocumentById, updateDocumentStatus } = await import('@/app/actions')
    const [project] = await createProject('Test Project')
    const projectId = project.id

    const [doc] = await createUploadingDocument({ projectId, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 1234 })
    expect(doc.status).toBe('uploading')
    expect(doc.charCount).toBe(0)

    await updateDocumentStoragePath(doc.id, `documents/${projectId}/${doc.id}/plan.pdf`)
    const loaded = await getDocumentById(doc.id)
    expect(loaded?.storagePath).toBe(`documents/${projectId}/${doc.id}/plan.pdf`)

    await updateDocumentStatus(doc.id, 'ready', { chunkCount: 3, charCount: 500, thumbnailPath: 'documents/x/thumb.webp' })
    const after = await getDocumentById(doc.id)
    expect(after?.status).toBe('ready')
    expect(after?.chunkCount).toBe(3)
    expect(after?.thumbnailPath).toBe('documents/x/thumb.webp')
  })

  it('deleteDocument returns the deleted row (for storage cleanup)', async () => {
    const { createUploadingDocument, deleteDocument } = await import('@/app/actions')
    const [project] = await createProject('Test Project 2')
    const projectId = project.id

    const [doc] = await createUploadingDocument({ projectId, filename: 'a.pdf', mimeType: 'application/pdf', fileSize: 1 })
    const [deleted] = await deleteDocument(doc.id)
    expect(deleted.id).toBe(doc.id)
  })
})
