import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { messageEmbeddings, messages } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

// The backfill embeds through the shared pool (embedContents → generateEmbedding).
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
} from '@/app/actions'
import { backfillMissingEmbeddings, countMissingEmbeddings } from '@/lib/embeddingBackfill'

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
    expect(first).toEqual({ embedded: 2, failed: 0, skipped: 0, remaining: 0 })
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(mockGenerateEmbedding.mock.calls.map(c => c[0])).toEqual(['first question', 'second question'])

    const rows = await embeddingRows()
    expect(rows.map(r => r.messageId)).toEqual([m1.id, m2.id, m3.id])
    // Filed under the chat's DB project, like /api/embed.
    expect(rows.every(r => r.projectId === projectId && r.chatId === chatId)).toBe(true)

    mockGenerateEmbedding.mockClear()
    const second = await backfillMissingEmbeddings({})
    expect(second).toEqual({ embedded: 0, failed: 0, skipped: 0, remaining: 0 })
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('defaults the options argument', async () => {
    await saveMessage(chatId, 'user', 'q')
    expect(await backfillMissingEmbeddings()).toEqual({ embedded: 1, failed: 0, skipped: 0, remaining: 0 })
  })

  it('works oldest first within the limit and reports what remains', async () => {
    for (let i = 1; i <= 5; i++) await saveMessage(chatId, 'user', `msg ${i}`)

    const res = await backfillMissingEmbeddings({ limit: 2 })
    expect(res).toEqual({ embedded: 2, failed: 0, skipped: 0, remaining: 3 })
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
      expect(res).toEqual({ embedded: 1, failed: 1, skipped: 0, remaining: 1 })
    } finally {
      warn.mockRestore()
    }
  })

  // Review finding: with the provider down, `failed` used to lump the five tried
  // rows with the rest of the batch. `skipped` now says "not attempted".
  it('stops once the breaker trips and reports the untried rows as skipped', async () => {
    for (let i = 1; i <= 10; i++) await saveMessage(chatId, 'user', `msg ${i}`)
    mockGenerateEmbedding.mockRejectedValue(new Error('503 unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await backfillMissingEmbeddings({})
      // The pool runs 5 at a time, so a few rows start before the fifth failure
      // trips the breaker: they count as failed, the rest as skipped.
      expect(res.embedded).toBe(0)
      expect(res.remaining).toBe(10)
      expect(res.failed + res.skipped).toBe(10)
      expect(res.failed).toBeGreaterThanOrEqual(5)
      expect(res.skipped).toBeGreaterThanOrEqual(1)
      const tried = new Set(mockGenerateEmbedding.mock.calls.map(c => c[0]))
      expect(tried.size).toBe(res.failed)
      // Rows already in flight drop their remaining retries once it trips: at most
      // 5 full ladders (1 + 3 retries each) plus one attempt per other started row.
      expect(mockGenerateEmbedding.mock.calls.length).toBeLessThanOrEqual(5 * 4 + (res.failed - 5))
    } finally {
      warn.mockRestore()
    }
  })

  it('only considers messages created at or after `since`', async () => {
    const [old] = await saveMessage(chatId, 'user', 'old message')
    await testDb.update(messages).set({ createdAt: new Date('2026-10-01T00:00:00Z') }).where(eq(messages.id, old.id))
    await saveMessage(chatId, 'user', 'new message')

    const res = await backfillMissingEmbeddings({ since: new Date('2026-10-16T00:00:00Z') })
    expect(res).toEqual({ embedded: 1, failed: 0, skipped: 0, remaining: 0 })
    expect(mockGenerateEmbedding.mock.calls.map(c => c[0])).toEqual(['new message'])
  })

  it('skips blank messages and stores a standalone chat\'s rows with no project', async () => {
    const [standalone] = await createStandaloneChat('Quick')
    await saveMessage(standalone.id, 'assistant', '   ')
    const [m] = await saveMessage(standalone.id, 'user', 'standalone q')

    const res = await backfillMissingEmbeddings({})
    expect(res).toEqual({ embedded: 1, failed: 0, skipped: 0, remaining: 0 })
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

  it('caps on UTF-16 units even when the SQL prefix is counted in code points', async () => {
    // 8,001 emoji = 16,002 UTF-16 units; the capped text must still be 8,000 units
    // and must not end on half a pair.
    await saveMessage(chatId, 'user', '\u{1F600}'.repeat(8001))
    await backfillMissingEmbeddings({})
    const sent = mockGenerateEmbedding.mock.calls[0][0] as string
    expect(sent.length).toBe(8000)
    expect(sent).toBe('\u{1F600}'.repeat(4000))
  })

  it('rejects an out-of-range limit', async () => {
    await expect(backfillMissingEmbeddings({ limit: 0 })).rejects.toThrow('Invalid backfill options')
    await expect(backfillMissingEmbeddings({ limit: 5000 })).rejects.toThrow('Invalid backfill options')
  })
})

describe('countMissingEmbeddings', () => {
  beforeEach(async () => {
    await createTestDb()
    mockGenerateEmbedding.mockReset()
  })

  it('counts missing rows without calling the provider (the --dry-run path)', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    const [m1] = await saveMessage(chat.id, 'user', 'a')
    await saveMessage(chat.id, 'assistant', 'b')
    await saveMessage(chat.id, 'assistant', '  ')
    await saveMessageEmbedding(m1.id, chat.id, project.id, 'a', vec())

    expect(await countMissingEmbeddings()).toBe(1)
    expect(await countMissingEmbeddings(new Date(Date.now() + 60_000))).toBe(0)
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })
})
