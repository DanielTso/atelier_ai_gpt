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
})
