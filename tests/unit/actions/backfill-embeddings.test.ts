import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { messageEmbeddings, messages } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

// The backfill embeds through the shared pool (embedChunks → generateEmbedding).
// No provider is ever called: this mock stands in for Gemini.
const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/embeddings', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))

import {
  createProject,
  createChat,
  createStandaloneChat,
  saveMessage,
  saveMessageEmbedding,
  backfillMissingEmbeddings,
} from '@/app/actions'

const vec = () => new Array(768).fill(0.1)

async function embeddingRows() {
  return testDb.select().from(messageEmbeddings).orderBy(asc(messageEmbeddings.messageId))
}

// Handoff 2026-11-12 item 4 / audit B13: messages written while Gemini was down
// have no message_embeddings row and nothing ever retried them.
describe('backfillMissingEmbeddings', () => {
  let projectId: number
  let chatId: number

  beforeEach(async () => {
    await createTestDb()
    mockGenerateEmbedding.mockReset()
    mockGenerateEmbedding.mockResolvedValue(vec())
    const [project] = await createProject('P')
    projectId = project.id
    const [chat] = await createChat(project.id, 'Chat')
    chatId = chat.id
  })

  it('embeds only the messages that have no embedding, and a second run embeds nothing', async () => {
    const [m1] = await saveMessage(chatId, 'user', 'first question')
    const [m2] = await saveMessage(chatId, 'assistant', 'first answer')
    const [m3] = await saveMessage(chatId, 'user', 'second question')
    await saveMessageEmbedding(m2.id, chatId, projectId, 'first answer', vec())

    const first = await backfillMissingEmbeddings({})
    expect(first).toEqual({ embedded: 2, failed: 0, remaining: 0 })
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(mockGenerateEmbedding.mock.calls.map(c => c[0])).toEqual(['first question', 'second question'])

    const rows = await embeddingRows()
    expect(rows.map(r => r.messageId)).toEqual([m1.id, m2.id, m3.id])
    // Filed under the chat's DB project, like /api/embed.
    expect(rows.every(r => r.projectId === projectId && r.chatId === chatId)).toBe(true)

    mockGenerateEmbedding.mockClear()
    const second = await backfillMissingEmbeddings({})
    expect(second).toEqual({ embedded: 0, failed: 0, remaining: 0 })
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('defaults the options argument', async () => {
    await saveMessage(chatId, 'user', 'q')
    expect(await backfillMissingEmbeddings()).toEqual({ embedded: 1, failed: 0, remaining: 0 })
  })

  it('works oldest first within the limit and reports what remains', async () => {
    for (let i = 1; i <= 5; i++) await saveMessage(chatId, 'user', `msg ${i}`)

    const res = await backfillMissingEmbeddings({ limit: 2 })
    expect(res).toEqual({ embedded: 2, failed: 0, remaining: 3 })
    expect(mockGenerateEmbedding.mock.calls.map(c => c[0])).toEqual(['msg 1', 'msg 2'])
  })

  it('counts a failed message as failed and leaves it for the next run', async () => {
    await saveMessage(chatId, 'user', 'ok one')
    await saveMessage(chatId, 'user', 'bad one')
    mockGenerateEmbedding.mockImplementation(async (text: string) => {
      if (text === 'bad one') throw new Error('400 invalid argument')
      return vec()
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await backfillMissingEmbeddings({})
      expect(res).toEqual({ embedded: 1, failed: 1, remaining: 1 })
    } finally {
      warn.mockRestore()
    }
  })

  it('only considers messages created at or after `since`', async () => {
    const [old] = await saveMessage(chatId, 'user', 'old message')
    await testDb.update(messages).set({ createdAt: new Date('2026-10-01T00:00:00Z') }).where(eq(messages.id, old.id))
    await saveMessage(chatId, 'user', 'new message')

    const res = await backfillMissingEmbeddings({ since: new Date('2026-10-16T00:00:00Z') })
    expect(res).toEqual({ embedded: 1, failed: 0, remaining: 0 })
    expect(mockGenerateEmbedding.mock.calls.map(c => c[0])).toEqual(['new message'])
  })

  it('skips blank messages and stores a standalone chat\'s rows with no project', async () => {
    const [standalone] = await createStandaloneChat('Quick')
    await saveMessage(standalone.id, 'assistant', '   ')
    const [m] = await saveMessage(standalone.id, 'user', 'standalone q')

    const res = await backfillMissingEmbeddings({})
    expect(res).toEqual({ embedded: 1, failed: 0, remaining: 0 })
    const rows = await embeddingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].messageId).toBe(m.id)
    expect(rows[0].projectId).toBeNull()
  })

  it('caps the embedded and stored text at 8000 characters', async () => {
    await saveMessage(chatId, 'assistant', 'y'.repeat(12_000))
    await backfillMissingEmbeddings({})
    expect(mockGenerateEmbedding.mock.calls[0][0]).toBe('y'.repeat(8000))
    const [row] = await embeddingRows()
    expect(row.content).toBe('y'.repeat(8000))
  })

  it('rejects an out-of-range limit', async () => {
    await expect(backfillMissingEmbeddings({ limit: 0 })).rejects.toThrow('Invalid backfill options')
    await expect(backfillMissingEmbeddings({ limit: 5000 })).rejects.toThrow('Invalid backfill options')
  })
})
