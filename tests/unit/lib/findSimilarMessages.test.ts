import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() { return testDb },
}))

import { createProject, createChat, saveMessage, saveMessageEmbedding } from '@/app/actions'
import { findSimilarMessages } from '@/lib/embeddings'

const vec = new Array(768).fill(0.01)

// Audit B9: rows already in the prompt are excluded in SQL, before the LIMIT, so
// they cannot crowd other chats' turns out of the top-N either.
describe('findSimilarMessages exclusions', () => {
  beforeEach(async () => { await createTestDb() })

  async function seed() {
    const [project] = await createProject('P')
    const [current] = await createChat(project.id, 'Current')
    const [other] = await createChat(project.id, 'Other')
    const ids: Record<string, number> = {}
    for (const [key, chatId] of [['c1', current.id], ['c2', current.id], ['o1', other.id]] as const) {
      const [msg] = await saveMessage(chatId, 'user', key)
      await saveMessageEmbedding(msg.id, chatId, project.id, key, vec)
      ids[key] = msg.id
    }
    return { projectId: project.id, currentId: current.id, ids }
  }

  it('excludes every row of a chat', async () => {
    const { projectId, currentId } = await seed()
    const rows = await findSimilarMessages(vec, { projectId, excludeChatId: currentId }, 10, 0.5, false)
    expect(rows.map(r => r.content)).toEqual(['o1'])
  })

  it('excludes exactly the listed message ids', async () => {
    const { projectId, ids } = await seed()
    const rows = await findSimilarMessages(vec, { projectId, excludeMessageIds: [ids.c2] }, 10, 0.5, false)
    expect(rows.map(r => r.content).sort()).toEqual(['c1', 'o1'])
  })

  it('applies the exclusion before the limit', async () => {
    const { projectId, currentId } = await seed()
    const rows = await findSimilarMessages(vec, { projectId, excludeChatId: currentId }, 1, 0.5, false)
    expect(rows.map(r => r.content)).toEqual(['o1'])
  })
})
