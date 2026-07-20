import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { findSimilarDocumentChunks } from '@/lib/embeddings'
import { projects, documents, documentChunks } from '@/db/schema'

const vec = (base: number) => Array.from({ length: 768 }, (_, i) => (i === 0 ? base : 0))

describe('findSimilarDocumentChunks (pgvector)', () => {
  beforeEach(async () => { await createTestDb() })

  it('returns the nearest chunk above threshold, scoped to project', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [d] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'spec.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
    }).returning()
    await testDb.insert(documentChunks).values([
      { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'near', embedding: vec(1) },
      { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'opposite', embedding: vec(-1) },
    ])
    const results = await findSimilarDocumentChunks(vec(1), p.id, 3, 0.5)
    expect(results[0].content).toBe('near')
    expect(results[0].filename).toBe('spec.pdf')
    expect(results.find(r => r.content === 'opposite')).toBeUndefined()
  })

  it('returns nothing for an unrelated project scope', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const results = await findSimilarDocumentChunks(vec(1), p.id + 999, 3, 0.5)
    expect(results).toHaveLength(0)
  })

  it('returns pageStart/pageEnd (stamped and null) on results', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [d] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'spec.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
    }).returning()
    await testDb.insert(documentChunks).values([
      { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'paged', embedding: vec(1), pageStart: 3, pageEnd: 5 },
      { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'unpaged', embedding: vec(1) },
    ])
    const results = await findSimilarDocumentChunks(vec(1), p.id, 3, 0.5)
    const paged = results.find(r => r.content === 'paged')
    const unpaged = results.find(r => r.content === 'unpaged')
    expect(paged?.pageStart).toBe(3)
    expect(paged?.pageEnd).toBe(5)
    expect(unpaged?.pageStart).toBeNull()
    expect(unpaged?.pageEnd).toBeNull()
  })

  it('excludes chunks from excluded documents', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [d1] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'keep.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
    }).returning()
    const [d2] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'skip.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
    }).returning()
    await testDb.insert(documentChunks).values([
      { documentId: d1.id, projectId: p.id, chunkIndex: 0, content: 'kept chunk', embedding: vec(1) },
      { documentId: d2.id, projectId: p.id, chunkIndex: 0, content: 'excluded chunk', embedding: vec(1) },
    ])
    const all = await findSimilarDocumentChunks(vec(1), p.id, 10, 0.5)
    expect(all).toHaveLength(2)
    const filtered = await findSimilarDocumentChunks(vec(1), p.id, 10, 0.5, true, [d2.id])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].content).toBe('kept chunk')
  })
})
