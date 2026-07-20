import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import { projects, documents, documentChunks } from '@/db/schema'

// Migration 0017: nullable page_start/page_end columns on document_chunks —
// the foundation for citation page-mapping (Grounded & Cited Answers, Task 1).
describe('migration 0017', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('document_chunks accepts and returns page_start/page_end (nullable)', async () => {
    const [project] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [doc] = await testDb.insert(documents).values({
      projectId: project.id,
      filename: 'plans.pdf',
      mimeType: 'application/pdf',
      fileSize: 1234,
      charCount: 5678,
    }).returning()

    await testDb.insert(documentChunks).values([
      {
        documentId: doc.id,
        projectId: project.id,
        chunkIndex: 0,
        content: 'chunk with page provenance',
        pageStart: 12,
        pageEnd: 14,
      },
      {
        documentId: doc.id,
        projectId: project.id,
        chunkIndex: 1,
        content: 'chunk without page provenance',
      },
    ])

    const rows = await testDb
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, doc.id))
      .orderBy(documentChunks.chunkIndex)

    expect(rows).toHaveLength(2)
    expect(rows[0].pageStart).toBe(12)
    expect(rows[0].pageEnd).toBe(14)
    expect(rows[1].pageStart).toBeNull()
    expect(rows[1].pageEnd).toBeNull()
  })
})
