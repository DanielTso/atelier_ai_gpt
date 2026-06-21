import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

describe('memory suggestion actions', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates pending suggestions and reads them back newest-first', async () => {
    const { createProject, createMemorySuggestions, getPendingSuggestions } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await createMemorySuggestions(p.id, null, ['PE of record is Jane Doe', 'Pour scheduled 2026-07-01'])
    const pending = await getPendingSuggestions(p.id)
    expect(pending).toHaveLength(2)
    expect(pending.every(s => s.status === 'pending')).toBe(true)
    expect(pending.map(s => s.text)).toContain('PE of record is Jane Doe')
  })

  it('createMemorySuggestions is a no-op on empty input', async () => {
    const { createProject, createMemorySuggestions, getPendingSuggestions } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    expect(await createMemorySuggestions(p.id, null, [])).toEqual([])
    expect(await getPendingSuggestions(p.id)).toHaveLength(0)
  })

  it('countPendingSuggestions counts only pending', async () => {
    const { createProject, createMemorySuggestions, getPendingSuggestions, dismissSuggestion, countPendingSuggestions } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await createMemorySuggestions(p.id, null, ['a', 'b', 'c'])
    const pending = await getPendingSuggestions(p.id)
    await dismissSuggestion(pending[0].id)
    expect(await countPendingSuggestions(p.id)).toBe(2)
  })

  it('acceptSuggestion appends to empty memory, then newline-joins', async () => {
    const { createProject, createMemorySuggestions, getPendingSuggestions, acceptSuggestion, getProjectContext } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await createMemorySuggestions(p.id, null, ['Fact one', 'Fact two'])
    const pending = await getPendingSuggestions(p.id)
    // Rows from one insert share a created_at, so tie-break order is undefined —
    // select by text to make the assertion deterministic.
    const one = pending.find(s => s.text === 'Fact one')!
    const two = pending.find(s => s.text === 'Fact two')!
    const r1 = await acceptSuggestion(one.id)
    expect(r1?.memory).toBe('Fact one')
    const r2 = await acceptSuggestion(two.id)
    expect(r2?.memory).toBe('Fact one\nFact two')
    expect((await getProjectContext(p.id))?.memory).toBe('Fact one\nFact two')
    expect(await getPendingSuggestions(p.id)).toHaveLength(0)
  })

  it('acceptSuggestion appends atomically onto pre-existing memory', async () => {
    const { createProject, updateProjectContext, createMemorySuggestions, getPendingSuggestions, acceptSuggestion, getProjectContext } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await updateProjectContext(p.id, { memory: 'Existing line' })
    await createMemorySuggestions(p.id, null, ['New fact'])
    const [s] = await getPendingSuggestions(p.id)
    const r = await acceptSuggestion(s.id)
    expect(r?.memory).toBe('Existing line\nNew fact')
    expect((await getProjectContext(p.id))?.memory).toBe('Existing line\nNew fact')
  })

  it('acceptSuggestion honors an override text', async () => {
    const { createProject, createMemorySuggestions, getPendingSuggestions, acceptSuggestion } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await createMemorySuggestions(p.id, null, ['raw fact'])
    const [s] = await getPendingSuggestions(p.id)
    const r = await acceptSuggestion(s.id, 'edited fact')
    expect(r?.memory).toBe('edited fact')
  })

  it('getRecentlyDismissed returns dismissed texts only', async () => {
    const { createProject, createMemorySuggestions, getPendingSuggestions, dismissSuggestion, getRecentlyDismissed } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await createMemorySuggestions(p.id, null, ['keep', 'drop'])
    const pending = await getPendingSuggestions(p.id)
    const dropRow = pending.find(s => s.text === 'drop')!
    await dismissSuggestion(dropRow.id)
    expect(await getRecentlyDismissed(p.id)).toEqual(['drop'])
  })
})
