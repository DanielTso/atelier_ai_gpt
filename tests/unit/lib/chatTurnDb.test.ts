import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { messages, messageAttachments, messageEmbeddings } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockIsStorageConfigured = vi.fn(() => true)
const mockRemoveObjects = vi.fn<(paths: string[]) => Promise<void>>(async () => {})
vi.mock('@/lib/storage', () => ({
  get isStorageConfigured() { return mockIsStorageConfigured },
  get removeObjects() { return mockRemoveObjects },
}))

import { createStandaloneChat, saveMessage, saveGeneratedImage, saveMessageEmbedding } from '@/app/actions'
import { replaceAssistantReply } from '@/lib/chatTurnDb'

describe('replaceAssistantReply (regenerate, audit D2)', () => {
  let chatId: number

  beforeEach(async () => {
    await createTestDb()
    mockIsStorageConfigured.mockReturnValue(true)
    mockRemoveObjects.mockReset()
    mockRemoveObjects.mockResolvedValue(undefined)
    const [chat] = await createStandaloneChat('Chat')
    chatId = chat.id
  })

  const rows = () => testDb.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.id))

  it('rewrites the reply in place: same id, same created_at, new content', async () => {
    await saveMessage(chatId, 'user', 'Question')
    const [reply] = await saveMessage(chatId, 'assistant', 'Old answer')

    expect(await replaceAssistantReply(chatId, reply.id, 'New answer')).toBe(reply.id)

    const after = await rows()
    expect(after.map(r => [r.role, r.content])).toEqual([['user', 'Question'], ['assistant', 'New answer']])
    expect(after[1].id).toBe(reply.id)
    expect(after[1].createdAt?.getTime()).toBe(reply.createdAt?.getTime())
  })

  it('drops the old reply\'s attachments and embedding, then removes their Storage objects', async () => {
    await saveMessage(chatId, 'user', 'Question')
    const [reply] = await saveMessage(chatId, 'assistant', 'Old answer')
    await saveGeneratedImage(reply.id, chatId, [{ storagePath: 'images/old.png', mediaType: 'image/png', filename: 'old.png' }])
    await saveMessageEmbedding(reply.id, chatId, null, 'Old answer', Array(768).fill(0.01))

    await replaceAssistantReply(chatId, reply.id, 'New answer')

    expect(await testDb.select().from(messageAttachments).where(eq(messageAttachments.messageId, reply.id))).toEqual([])
    expect(await testDb.select().from(messageEmbeddings).where(eq(messageEmbeddings.messageId, reply.id))).toEqual([])
    expect(mockRemoveObjects).toHaveBeenCalledExactlyOnceWith(['images/old.png'])
  })

  it('still returns the id when the Storage cleanup fails (best-effort, logged)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await saveMessage(chatId, 'user', 'Question')
      const [reply] = await saveMessage(chatId, 'assistant', 'Old answer')
      await saveGeneratedImage(reply.id, chatId, [{ storagePath: 'images/old.png', mediaType: 'image/png', filename: 'old.png' }])
      mockRemoveObjects.mockRejectedValueOnce(new Error('storage down'))

      expect(await replaceAssistantReply(chatId, reply.id, 'New answer')).toBe(reply.id)
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/storage cleanup failed/)
    } finally {
      warn.mockRestore()
    }
  })

  it('inserts a new assistant row when the reply is gone (deleted meanwhile)', async () => {
    await saveMessage(chatId, 'user', 'Question')
    const [reply] = await saveMessage(chatId, 'assistant', 'Old answer')
    await testDb.delete(messages).where(eq(messages.id, reply.id))

    const id = await replaceAssistantReply(chatId, reply.id, 'New answer')

    const after = await rows()
    expect(after.map(r => [r.role, r.content])).toEqual([['user', 'Question'], ['assistant', 'New answer']])
    expect(id).toBe(after[1].id)
    expect(id).not.toBe(reply.id)
  })

  it('never rewrites a row of another chat or a user row, nor touches their children — it inserts instead', async () => {
    const [user] = await saveMessage(chatId, 'user', 'Question')
    const [other] = await createStandaloneChat('Other')
    const [foreign] = await saveMessage(other.id, 'assistant', 'Foreign answer')
    // Both rows carry attachments and an embedding that must survive.
    await saveGeneratedImage(user.id, chatId, [{ storagePath: 'images/user.png', mediaType: 'image/png', filename: 'user.png' }])
    await saveMessageEmbedding(user.id, chatId, null, 'Question', Array(768).fill(0.01))
    await saveGeneratedImage(foreign.id, other.id, [{ storagePath: 'images/foreign.png', mediaType: 'image/png', filename: 'foreign.png' }])
    await saveMessageEmbedding(foreign.id, other.id, null, 'Foreign answer', Array(768).fill(0.02))

    await replaceAssistantReply(chatId, user.id, 'X')
    await replaceAssistantReply(chatId, foreign.id, 'Y')

    expect((await rows()).map(r => [r.role, r.content])).toEqual([['user', 'Question'], ['assistant', 'X'], ['assistant', 'Y']])
    const [stillForeign] = await testDb.select().from(messages).where(eq(messages.id, foreign.id))
    expect(stillForeign.content).toBe('Foreign answer')
    for (const [id, path] of [[user.id, 'images/user.png'], [foreign.id, 'images/foreign.png']] as const) {
      expect((await testDb.select().from(messageAttachments).where(eq(messageAttachments.messageId, id))).map(a => a.storagePath)).toEqual([path])
      expect(await testDb.select().from(messageEmbeddings).where(eq(messageEmbeddings.messageId, id))).toHaveLength(1)
    }
    expect(mockRemoveObjects).not.toHaveBeenCalled()
  })
})
