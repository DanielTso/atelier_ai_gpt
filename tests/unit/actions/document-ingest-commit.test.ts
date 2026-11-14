import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { projects, documents, documentChunks } from '@/db/schema'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { claimDocumentForProcessing, commitDocumentIngest, getDocumentById } from '@/app/actions'

async function insertDoc(over: Partial<typeof documents.$inferInsert> = {}) {
  const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
  const [d] = await testDb.insert(documents).values({
    projectId: p.id, filename: 'f.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 0, ...over,
  }).returning()
  return d
}

const chunkRows = (projectId: number, n: number) => Array.from({ length: n }, (_, i) => ({
  projectId, chunkIndex: i, content: `chunk ${i}`, embedding: new Array(768).fill(0.1), pageStart: null, pageEnd: null,
}))

// Audit D2: /process claims the document before doing any work, so a second
// concurrent call (re-click, retry) is refused instead of ingesting twice. The
// claim is a compare-and-set against the row the route read: if the status or
// revision moved in between (another replace committed), the claim is refused.
describe('claimDocumentForProcessing', () => {
  beforeEach(async () => { await createTestDb() })

  it.each(['uploading', 'ready', 'error'])('claims a %s document and marks it processing', async (status) => {
    const d = await insertDoc({ status })
    expect(await claimDocumentForProcessing(d.id, { status, revision: 1 })).toBe(true)
    expect((await getDocumentById(d.id))?.status).toBe('processing')
  })

  it('refuses a document that is already processing', async () => {
    const d = await insertDoc({ status: 'processing' })
    expect(await claimDocumentForProcessing(d.id, { status: 'processing', revision: 1 })).toBe(false)
    expect(await claimDocumentForProcessing(d.id, { status: 'ready', revision: 1 })).toBe(false)
  })

  it('refuses when the revision moved since the route read the document', async () => {
    const d = await insertDoc({ status: 'ready', revision: 3 })
    expect(await claimDocumentForProcessing(d.id, { status: 'ready', revision: 2 })).toBe(false)
    const after = await getDocumentById(d.id)
    expect(after?.status).toBe('ready')
    expect(after?.revision).toBe(3)
  })

  it('refuses when the status moved since the route read the document', async () => {
    const d = await insertDoc({ status: 'ready' })
    expect(await claimDocumentForProcessing(d.id, { status: 'uploading', revision: 1 })).toBe(false)
    expect((await getDocumentById(d.id))?.status).toBe('ready')
  })

  it('lets exactly one of two concurrent claims win', async () => {
    const d = await insertDoc({ status: 'uploading' })
    const expected = { status: 'uploading', revision: 1 }
    const results = await Promise.all([claimDocumentForProcessing(d.id, expected), claimDocumentForProcessing(d.id, expected)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('refuses a document that does not exist', async () => {
    expect(await claimDocumentForProcessing(999, { status: 'ready', revision: 1 })).toBe(false)
  })
})

describe('commitDocumentIngest', () => {
  beforeEach(async () => { await createTestDb() })

  it('replaces the chunk set and writes the status in one step', async () => {
    const d = await insertDoc({ status: 'processing', errorMessage: 'Processing timed out' })
    await commitDocumentIngest(d.id, 'ready', { chunkCount: 4, charCount: 40 }, chunkRows(d.projectId, 4).map(r => ({ ...r, documentId: d.id })))
    await commitDocumentIngest(d.id, 'ready', { chunkCount: 2, charCount: 20 }, chunkRows(d.projectId, 2).map(r => ({ ...r, documentId: d.id })))
    const rows = await testDb.select().from(documentChunks).where(eq(documentChunks.documentId, d.id))
    const after = await getDocumentById(d.id)
    expect(rows).toHaveLength(2)
    expect(after?.chunkCount).toBe(2)
    expect(after?.status).toBe('ready')
    // A ready commit clears a stale error message, like updateDocumentStatus.
    expect(after?.errorMessage).toBeNull()
  })

  it('rolls back the chunk swap when the commit fails', async () => {
    const d = await insertDoc({ status: 'processing' })
    await commitDocumentIngest(d.id, 'ready', { chunkCount: 3 }, chunkRows(d.projectId, 3).map(r => ({ ...r, documentId: d.id })))
    // Two rows with the same chunk_index violate the unique index → the whole
    // transaction rolls back, and the first commit's chunks survive.
    const dup = [...chunkRows(d.projectId, 1), ...chunkRows(d.projectId, 1)].map(r => ({ ...r, documentId: d.id }))
    await expect(commitDocumentIngest(d.id, 'ready', { chunkCount: 2 }, dup)).rejects.toThrow()
    const rows = await testDb.select().from(documentChunks).where(eq(documentChunks.documentId, d.id))
    expect(rows).toHaveLength(3)
    expect((await getDocumentById(d.id))?.chunkCount).toBe(3)
  })
})
