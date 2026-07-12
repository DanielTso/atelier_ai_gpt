import { describe, it, expect, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() { return testDb },
}))

import { findChunksByKeyword, identifierTokens } from '@/lib/keywordSearch'

async function seed() {
  await createTestDb()
  const { projects, documents, documentChunks } = await import('@/db/schema')
  const [p] = await testDb.insert(projects).values({ name: 'p' }).returning()
  const [d] = await testDb.insert(documents).values({
    projectId: p.id, filename: 'plans.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
  }).returning()
  await testDb.insert(documentChunks).values([
    { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'Storm drain profile sheet SW-101 with general notes' },
    { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'Electrical single line diagram E-203 panel schedule' },
    { documentId: d.id, projectId: p.id, chunkIndex: 2, content: 'Landscape irrigation legend and plant schedule' },
  ])
  return { projectId: p.id }
}

describe('identifierTokens', () => {
  it('extracts sheet-number-like tokens only', () => {
    expect(identifierTokens('what does note 7 on SW-101 say about E-203?')).toEqual(['SW-101', 'E-203'])
    expect(identifierTokens('list every storm sheet')).toEqual([])
  })
})

describe('findChunksByKeyword', () => {
  it('finds chunks by FTS phrase', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('storm drain', projectId, 10)
    expect(r.length).toBe(1)
    expect(r[0].content).toContain('SW-101')
    expect(r[0].filename).toBe('plans.pdf')
    expect(r[0].embedding).toBeNull()
  })

  it('finds identifier chunks via ILIKE even when FTS misses', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('what is on SW-101', projectId, 10)
    expect(r.some(c => c.content.includes('SW-101'))).toBe(true)
  })

  it('scopes to the project', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('storm drain', projectId + 999, 10)
    expect(r).toEqual([])
  })
})
