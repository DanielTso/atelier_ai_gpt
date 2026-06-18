import { describe, it, expect, beforeEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { projects, documents, documentChunks } from '@/db/schema'

describe('PGlite test harness', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates tables and round-trips a row (identity PK + timestamptz)', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'Site A' }).returning()
    expect(p.id).toBeGreaterThan(0)
    expect(p.createdAt).toBeInstanceOf(Date)
    const rows = await testDb.select().from(projects).where(eq(projects.id, p.id))
    expect(rows[0].name).toBe('Site A')
  })

  it('stores and orders by a pgvector column', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [d] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'f', mimeType: 't', fileSize: 1, charCount: 1,
    }).returning()
    const v = (base: number) => Array.from({ length: 768 }, (_, i) => (i === 0 ? base : 0))
    await testDb.insert(documentChunks).values([
      { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'near', embedding: v(1) },
      { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'far', embedding: v(-1) },
    ])
    const query = v(1)
    const rows = await testDb.select({
      content: documentChunks.content,
      dist: sql<number>`${documentChunks.embedding} <=> ${JSON.stringify(query)}::vector`,
    }).from(documentChunks).orderBy(sql`${documentChunks.embedding} <=> ${JSON.stringify(query)}::vector`)
    expect(rows[0].content).toBe('near')
  })
})
