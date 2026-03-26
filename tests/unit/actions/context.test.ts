import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import {
  createProject,
  createChat,
  saveMessage,
  getChatWithContext,
  updateChatSystemPrompt,
  updateChatSummary,
  getMessageCount,
  getMessagesForSummarization,
} from '@/app/actions'

describe('context actions', () => {
  let chatId: number

  beforeEach(async () => {
    await createTestDb()
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    chatId = chat.id
  })

  it('getChatWithContext returns chat data', async () => {
    const chat = await getChatWithContext(chatId)
    expect(chat).toBeDefined()
    expect(chat!.title).toBe('Chat')
    expect(chat!.summary).toBeNull()
    expect(chat!.systemPrompt).toBeNull()
  })

  it('returns undefined for non-existent chat', async () => {
    const chat = await getChatWithContext(99999)
    expect(chat).toBeUndefined()
  })

  it('updates system prompt', async () => {
    const [updated] = await updateChatSystemPrompt(chatId, 'You are helpful')
    expect(updated.systemPrompt).toBe('You are helpful')
  })

  it('clears system prompt with null', async () => {
    await updateChatSystemPrompt(chatId, 'Prompt')
    const [cleared] = await updateChatSystemPrompt(chatId, null)
    expect(cleared.systemPrompt).toBeNull()
  })

  it('updates chat summary', async () => {
    const [updated] = await updateChatSummary(chatId, 'A summary', 5)
    expect(updated.summary).toBe('A summary')
    expect(updated.summaryUpToMessageId).toBe(5)
  })

  it('getMessageCount returns correct count', async () => {
    await saveMessage(chatId, 'user', 'One')
    await saveMessage(chatId, 'assistant', 'Two')
    await saveMessage(chatId, 'user', 'Three')

    const count = await getMessageCount(chatId)
    expect(count).toBe(3)
  })

  it('getMessageCount returns 0 for empty chat', async () => {
    const count = await getMessageCount(chatId)
    expect(count).toBe(0)
  })

  it('getMessagesForSummarization returns messages up to cutoff', async () => {
    const [m1] = await saveMessage(chatId, 'user', 'First')
    const [m2] = await saveMessage(chatId, 'assistant', 'Second')
    await saveMessage(chatId, 'user', 'Third')

    const msgs = await getMessagesForSummarization(chatId, m2.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('First')
    expect(msgs[1].content).toBe('Second')
  })

})
