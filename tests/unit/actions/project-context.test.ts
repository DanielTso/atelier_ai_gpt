import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

describe('project context actions', () => {
  beforeEach(async () => { await createTestDb() })

  it('updates and reads back memory + instructions', async () => {
    const { createProject, updateProjectContext, getProjectContext } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await updateProjectContext(p.id, { memory: 'Vernon, TX hub', instructions: 'Be terse.' })
    const ctx = await getProjectContext(p.id)
    expect(ctx).toEqual({ memory: 'Vernon, TX hub', instructions: 'Be terse.' })
  })

  it('updates only the provided field', async () => {
    const { createProject, updateProjectContext, getProjectContext } = await import('@/app/actions')
    const [p] = await createProject('Drover')
    await updateProjectContext(p.id, { memory: 'A' })
    await updateProjectContext(p.id, { instructions: 'B' })
    expect(await getProjectContext(p.id)).toEqual({ memory: 'A', instructions: 'B' })
  })

  it('returns null for a missing project', async () => {
    const { getProjectContext } = await import('@/app/actions')
    expect(await getProjectContext(9999)).toBeNull()
  })
})
