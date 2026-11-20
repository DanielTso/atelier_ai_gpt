import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { messages, messageAttachments, messageEmbeddings, artifacts, artifactVersions } from '@/db/schema'

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
import { replaceAssistantReply, updateAssistantReplyContent } from '@/lib/chatTurnDb'

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

describe('updateAssistantReplyContent (streaming checkpoints)', () => {
  let chatId: number

  beforeEach(async () => {
    await createTestDb()
    const [chat] = await createStandaloneChat('Chat')
    chatId = chat.id
  })

  const rows = () => testDb.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.id))

  it('rewrites the reply\'s content in place: same id, same created_at', async () => {
    await saveMessage(chatId, 'user', 'Question')
    const [reply] = await saveMessage(chatId, 'assistant', 'Partial')

    await updateAssistantReplyContent(chatId, reply.id, 'Partial, then more')

    const after = await rows()
    expect(after.map(r => [r.id, r.role, r.content])).toEqual([[after[0].id, 'user', 'Question'], [reply.id, 'assistant', 'Partial, then more']])
    expect(after[1].createdAt?.getTime()).toBe(reply.createdAt?.getTime())
  })

  it('never rewrites a user row or another chat\'s reply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [user] = await saveMessage(chatId, 'user', 'Question')
      const [other] = await createStandaloneChat('Other')
      const [foreign] = await saveMessage(other.id, 'assistant', 'Foreign answer')

      await updateAssistantReplyContent(chatId, user.id, 'X')
      await updateAssistantReplyContent(chatId, foreign.id, 'Y')

      expect((await rows()).map(r => [r.role, r.content])).toEqual([['user', 'Question']])
      const [stillForeign] = await testDb.select().from(messages).where(eq(messages.id, foreign.id))
      expect(stillForeign.content).toBe('Foreign answer')
    } finally {
      warn.mockRestore()
    }
  })

  it('caps the content at the same length saveMessage does', async () => {
    const [reply] = await saveMessage(chatId, 'assistant', 'Start')
    await updateAssistantReplyContent(chatId, reply.id, 'x'.repeat(200_005))
    const [row] = await testDb.select().from(messages).where(eq(messages.id, reply.id))
    expect(row.content).toHaveLength(200_000)
  })

  it('is a logged no-op when the row is gone — a deleted reply is never resurrected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await saveMessage(chatId, 'user', 'Question')
      const [reply] = await saveMessage(chatId, 'assistant', 'Partial')
      await testDb.delete(messages).where(eq(messages.id, reply.id))

      await expect(updateAssistantReplyContent(chatId, reply.id, 'More')).resolves.toBeUndefined()

      expect((await rows()).map(r => [r.role, r.content])).toEqual([['user', 'Question']])
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('replaceAssistantReply keeps generated images an artifact embeds (audit R4)', () => {
  let chatId: number
  let replyId: number
  let uploadPath: string
  let embeddedPath: string
  let otherPath: string

  // The permanent URL generate_image hands to an HTML artifact (src/lib/image/tool.ts).
  const embedUrl = (path: string) => `/api/files/raw?path=${encodeURIComponent(path)}&sig=deadbeef`
  const html = (path: string) => `<html><body><img src="${embedUrl(path)}" alt="hero"></body></html>`

  beforeEach(async () => {
    await createTestDb()
    mockIsStorageConfigured.mockReturnValue(true)
    mockRemoveObjects.mockReset()
    mockRemoveObjects.mockResolvedValue(undefined)
    const [chat] = await createStandaloneChat('Chat')
    chatId = chat.id
    await saveMessage(chatId, 'user', 'Make a landing page')
    const [reply] = await saveMessage(chatId, 'assistant', 'Here it is')
    replyId = reply.id
    uploadPath = `attachments/${chatId}/${replyId}/0-chart.png`
    embeddedPath = `attachments/${chatId}/generated/0b7f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.png`
    otherPath = `attachments/${chatId}/generated/9f8e7d6c-5b4a-4321-8fed-cba987654321.webp`
    await saveGeneratedImage(replyId, chatId, [
      { storagePath: uploadPath, mediaType: 'image/png', filename: 'chart.png' },
      { storagePath: embeddedPath, mediaType: 'image/png', filename: 'generated-image.png' },
      { storagePath: otherPath, mediaType: 'image/webp', filename: 'generated-image.webp' },
    ])
  })

  const insertArtifact = async (ownerChatId: number, content: string | null) => {
    const [row] = await testDb.insert(artifacts)
      .values({ chatId: ownerChatId, type: 'html', title: 'Page', storagePath: `artifacts/${ownerChatId}/page.html`, format: 'html', content })
      .returning()
    return row
  }
  const removed = () => (mockRemoveObjects.mock.calls[0]?.[0] ?? []).slice().sort()
  const attachmentRows = () => testDb.select().from(messageAttachments).where(eq(messageAttachments.messageId, replyId))

  it('keeps-generated-image-an-artifact-embeds', async () => {
    await insertArtifact(chatId, html(embeddedPath))

    await replaceAssistantReply(chatId, replyId, 'New answer')

    expect(mockRemoveObjects).toHaveBeenCalledOnce()
    expect(removed()).toEqual([otherPath, uploadPath].sort())
    expect(await attachmentRows()).toEqual([])
  })

  it('keeps-image-referenced-by-an-older-version', async () => {
    // The current version no longer shows the image, but version 1 can be restored.
    const artifact = await insertArtifact(chatId, '<html><body>No images now</body></html>')
    await testDb.insert(artifactVersions).values([
      { artifactId: artifact.id, version: 1, type: 'html', title: 'Page', format: 'html', content: html(embeddedPath), storagePath: `artifacts/${chatId}/page-v1.html` },
      { artifactId: artifact.id, version: 2, type: 'html', title: 'Page', format: 'html', content: '<html><body>No images now</body></html>', storagePath: `artifacts/${chatId}/page.html` },
    ])

    await replaceAssistantReply(chatId, replyId, 'New answer')

    expect(removed()).toEqual([otherPath, uploadPath].sort())
    expect(await attachmentRows()).toEqual([])
  })

  it('removes-unreferenced-generated-image', async () => {
    await insertArtifact(chatId, '<html><body>No images</body></html>')
    await insertArtifact(chatId, null)

    await replaceAssistantReply(chatId, replyId, 'New answer')

    expect(removed()).toEqual([embeddedPath, otherPath, uploadPath].sort())
    expect(await attachmentRows()).toEqual([])
  })

  it('ignores-artifacts-of-other-chats', async () => {
    const [other] = await createStandaloneChat('Other')
    const foreign = await insertArtifact(other.id, html(embeddedPath))
    await testDb.insert(artifactVersions).values({
      artifactId: foreign.id, version: 1, type: 'html', title: 'Page', format: 'html', content: html(embeddedPath), storagePath: `artifacts/${other.id}/page.html`,
    })

    await replaceAssistantReply(chatId, replyId, 'New answer')

    expect(removed()).toEqual([embeddedPath, otherPath, uploadPath].sort())
    expect(await attachmentRows()).toEqual([])
  })

  it('lookup-failure-keeps-generated-objects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const select = vi.spyOn(testDb, 'select').mockImplementationOnce(() => { throw new Error('db down') })
    try {
      await replaceAssistantReply(chatId, replyId, 'New answer')

      expect(select).toHaveBeenCalled()
      expect(mockRemoveObjects).toHaveBeenCalledExactlyOnceWith([uploadPath])
      expect(await attachmentRows()).toEqual([])
    } finally {
      select.mockRestore()
      warn.mockRestore()
    }
  })
})
