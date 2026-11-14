import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() { return testDb },
}))

import { findChunksByKeyword, ftsOrQuery, identifierTokens } from '@/lib/keywordSearch'

async function seed() {
  const { projects, documents, documentChunks } = await import('@/db/schema')
  const [p] = await testDb.insert(projects).values({ name: 'p' }).returning()
  const [d] = await testDb.insert(documents).values({
    projectId: p.id, filename: 'plans.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
  }).returning()
  await testDb.insert(documentChunks).values([
    { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'Storm drain profile sheet SW-101 with general notes', pageStart: 2, pageEnd: 4 },
    { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'Electrical single line diagram E-203 panel schedule' },
    { documentId: d.id, projectId: p.id, chunkIndex: 2, content: 'Landscape irrigation legend and plant schedule' },
  ])
  return { projectId: p.id }
}

async function seedTwoDocs() {
  const { projects, documents, documentChunks } = await import('@/db/schema')
  const [p] = await testDb.insert(projects).values({ name: 'p' }).returning()
  const [d1] = await testDb.insert(documents).values({
    projectId: p.id, filename: 'keep.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
  }).returning()
  const [d2] = await testDb.insert(documents).values({
    projectId: p.id, filename: 'skip.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
  }).returning()
  await testDb.insert(documentChunks).values([
    { documentId: d1.id, projectId: p.id, chunkIndex: 0, content: 'Storm drain profile sheet SW-101 kept' },
    { documentId: d2.id, projectId: p.id, chunkIndex: 0, content: 'Storm drain outfall sheet SW-101 skipped' },
  ])
  return { projectId: p.id, keepId: d1.id, skipId: d2.id }
}

describe('identifierTokens', () => {
  it('extracts sheet-number-like tokens only', () => {
    expect(identifierTokens('what does note 7 on SW-101 say about E-203?')).toEqual(['SW-101', 'E-203'])
    expect(identifierTokens('list every storm sheet')).toEqual([])
  })
})

describe('ftsOrQuery', () => {
  it('OR-joins the distinct words, dropping operator syntax and the word or', () => {
    expect(ftsOrQuery('What does SW-101 show, or not?')).toBe('what or does or sw or 101 or show or not')
    expect(ftsOrQuery('"-storm" storm OR drain')).toBe('storm or drain')
    expect(ftsOrQuery('?! --')).toBe('')
  })

  it('caps the number of terms', () => {
    const many = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ')
    expect(ftsOrQuery(many).split(' or ')).toHaveLength(32)
  })
})

describe('findChunksByKeyword', () => {
  beforeEach(async () => { await createTestDb() })

  it('finds chunks by FTS phrase', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('storm drain', projectId, 10)
    expect(r.length).toBe(1)
    expect(r[0].content).toContain('SW-101')
    expect(r[0].filename).toBe('plans.pdf')
    expect(r[0].embedding).toBeNull()
  })

  // Prior audit D1: websearch_to_tsquery ANDs every term, so a natural question
  // matched nothing as soon as one of its words was missing from the chunk.
  it('fts-or-matches-partial-question', async () => {
    const { projectId } = await seed()
    const r = await findChunksByKeyword('what does the storm drain profile show about outfalls', projectId, 10)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].content).toContain('Storm drain profile')
  })

  it('ranks the chunk matching more of the question first', async () => {
    const { projectId } = await seed()
    // Electrical chunk matches panel + schedule + single + line + diagram; Landscape only schedule.
    const r = await findChunksByKeyword('which panel schedule is on the single line diagram', projectId, 10)
    expect(r.map(c => c.content.split(' ')[0])).toEqual(['Electrical', 'Landscape'])
  })

  it('treats operator syntax in the question as plain words', async () => {
    const { projectId } = await seed()
    // A leading "-" would negate a term and a stray quote would open a phrase;
    // both are just words here, so the storm-drain chunk still matches.
    const r = await findChunksByKeyword('"storm -drain or OR ( ) : & | ! <-> \\', projectId, 10)
    expect(r.map(c => c.content)).toEqual(['Storm drain profile sheet SW-101 with general notes'])
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

  it('returns pageStart/pageEnd (stamped and null) on hits', async () => {
    const { projectId } = await seed()
    const paged = await findChunksByKeyword('storm drain', projectId, 10)
    expect(paged[0].pageStart).toBe(2)
    expect(paged[0].pageEnd).toBe(4)
    const unpaged = await findChunksByKeyword('irrigation legend', projectId, 10)
    expect(unpaged[0].pageStart).toBeNull()
    expect(unpaged[0].pageEnd).toBeNull()
  })

  it('excludes chunks from excluded documents (FTS leg)', async () => {
    const { projectId, skipId } = await seedTwoDocs()
    const all = await findChunksByKeyword('storm drain', projectId, 10)
    expect(all.length).toBe(2)
    const filtered = await findChunksByKeyword('storm drain', projectId, 10, [skipId])
    expect(filtered.length).toBe(1)
    expect(filtered[0].filename).toBe('keep.pdf')
  })

  it('excludes chunks from excluded documents (identifier ILIKE leg)', async () => {
    const { projectId, skipId } = await seedTwoDocs()
    const filtered = await findChunksByKeyword('what is on SW-101', projectId, 10, [skipId])
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(c => c.filename === 'keep.pdf')).toBe(true)
  })
})

describe('findChunksByKeyword oversized queries', () => {
  beforeEach(async () => { await createTestDb() })

  it('caps a giant query (inline file attachment) instead of failing FTS', async () => {
    const { projectId } = await seed()
    // Seen live: a message carrying an attached contract arrives as 600k+ chars.
    // websearch_to_tsquery rejects inputs that large — the cap must prevent the
    // throw. Matching is not asserted: the terms are OR-joined, but a junk-heavy
    // head can still match nothing, and the vector leg carries it then.
    const giant = 'abstract this contract ' + 'lorem ipsum '.repeat(60_000)
    await expect(findChunksByKeyword(giant, projectId, 10)).resolves.toBeInstanceOf(Array)
  })
})
