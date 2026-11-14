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

  it('updateDocumentStatus bumps updated_at', async () => {
    const { createUploadingDocument, updateDocumentStatus, getDocumentById } = await import('@/app/actions')
    const [project] = await createProject('Bump Project')
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'b.pdf', mimeType: 'application/pdf', fileSize: 10 })

    const before = Date.now()
    await updateDocumentStatus(doc.id, 'processing')
    const after = await getDocumentById(doc.id)

    expect(after?.updatedAt).toBeInstanceOf(Date)
    expect(after!.updatedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  // Audit B21: "Upload never completed" / "Processing timed out" used to stay on a
  // row that later became ready, because nothing could set error_message to null.
  it('a later ready clears a stale error_message', async () => {
    const { createUploadingDocument, updateDocumentStatus, getDocumentById } = await import('@/app/actions')
    const [project] = await createProject('Stale Error Project')
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 's.pdf', mimeType: 'application/pdf', fileSize: 10 })

    await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Processing timed out' })
    expect((await getDocumentById(doc.id))?.errorMessage).toBe('Processing timed out')

    await updateDocumentStatus(doc.id, 'processing')
    await updateDocumentStatus(doc.id, 'ready', { chunkCount: 2 })
    const after = await getDocumentById(doc.id)
    expect(after?.status).toBe('ready')
    expect(after?.errorMessage).toBeNull()
  })

  it('an explicit errorMessage: undefined does not stop ready from clearing a stale error', async () => {
    const { createUploadingDocument, updateDocumentStatus, getDocumentById } = await import('@/app/actions')
    const [project] = await createProject('Undefined Key Project')
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'u.pdf', mimeType: 'application/pdf', fileSize: 10 })

    await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Processing timed out' })
    await updateDocumentStatus(doc.id, 'ready', { errorMessage: undefined, chunkCount: 1 })
    const after = await getDocumentById(doc.id)
    expect(after?.errorMessage).toBeNull()
    expect(after?.chunkCount).toBe(1)
  })

  it('ready keeps an errorMessage the caller sets explicitly', async () => {
    const { createUploadingDocument, updateDocumentStatus, getDocumentById } = await import('@/app/actions')
    const [project] = await createProject('Explicit Message Project')
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'k.pdf', mimeType: 'application/pdf', fileSize: 10 })

    await updateDocumentStatus(doc.id, 'ready', { errorMessage: 'Some pages could not be read' })
    expect((await getDocumentById(doc.id))?.errorMessage).toBe('Some pages could not be read')
  })

  it('errorMessage can be cleared explicitly with null', async () => {
    const { createUploadingDocument, updateDocumentStatus, getDocumentById } = await import('@/app/actions')
    const [project] = await createProject('Explicit Clear Project')
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'e.pdf', mimeType: 'application/pdf', fileSize: 10 })

    await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Upload never completed' })
    await updateDocumentStatus(doc.id, 'processing', { errorMessage: null })
    expect((await getDocumentById(doc.id))?.errorMessage).toBeNull()
  })
})
