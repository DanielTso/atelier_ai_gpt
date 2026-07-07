import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'
import { projects, documents } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import { reapStaleProcessing, getDocumentById } from '@/app/actions'

const OLD = new Date(Date.now() - 30 * 60 * 1000)  // 30 min ago (stale)
const FRESH = new Date(Date.now() - 2 * 60 * 1000)  // 2 min ago (still running)

async function insertDoc(projectId: number, over: Partial<typeof documents.$inferInsert>) {
  const [d] = await testDb.insert(documents).values({
    projectId, filename: 'f.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 0,
    ...over,
  }).returning()
  return d
}

describe('reapStaleProcessing', () => {
  beforeEach(async () => { await createTestDb() })

  it('flips a stale processing row to error and leaves fresh/ready rows untouched', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const stale = await insertDoc(p.id, { status: 'processing', updatedAt: OLD })
    const fresh = await insertDoc(p.id, { status: 'processing', updatedAt: FRESH })
    const ready = await insertDoc(p.id, { status: 'ready', updatedAt: OLD })

    await reapStaleProcessing()

    const staleAfter = await getDocumentById(stale.id)
    expect(staleAfter?.status).toBe('error')
    expect(staleAfter?.errorMessage).toBe('Processing timed out')
    expect((await getDocumentById(fresh.id))?.status).toBe('processing')
    expect((await getDocumentById(ready.id))?.status).toBe('ready')
  })

  it('reaps a legacy row with null updated_at via the created_at fallback', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const legacy = await insertDoc(p.id, { status: 'processing', updatedAt: null, createdAt: OLD })

    await reapStaleProcessing()

    expect((await getDocumentById(legacy.id))?.status).toBe('error')
  })

  it('respects the projectId filter', async () => {
    const [a] = await testDb.insert(projects).values({ name: 'A' }).returning()
    const [b] = await testDb.insert(projects).values({ name: 'B' }).returning()
    const inA = await insertDoc(a.id, { status: 'processing', updatedAt: OLD })
    const inB = await insertDoc(b.id, { status: 'processing', updatedAt: OLD })

    await reapStaleProcessing(a.id)

    expect((await getDocumentById(inA.id))?.status).toBe('error')
    expect((await getDocumentById(inB.id))?.status).toBe('processing')
  })
})
