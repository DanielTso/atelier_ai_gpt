import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { artifacts, chats, messageAttachments } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockIsStorageConfigured = vi.fn(() => true)
const mockUploadBuffer = vi.fn(async () => {})
const mockCreateSignedDownloadUrl = vi.fn(async (p: string) => `signed:${p}`)
const mockCreateSignedDownloadUrls = vi.fn(async (paths: string[]) => new Map(paths.map((p: string) => [p, `signed:${p}`])))
const mockRemoveObjects = vi.fn<(paths: string[]) => Promise<void>>(async () => {})
const mockListObjects = vi.fn<(prefix: string) => Promise<Array<{ name: string; createdAt: string | null }>>>(async () => [])

vi.mock('@/lib/storage', () => ({
  get isStorageConfigured() { return mockIsStorageConfigured },
  get uploadBuffer() { return mockUploadBuffer },
  get createSignedDownloadUrl() { return mockCreateSignedDownloadUrl },
  get createSignedDownloadUrls() { return mockCreateSignedDownloadUrls },
  get removeObjects() { return mockRemoveObjects },
  get listObjects() { return mockListObjects },
}))

import {
  createProject,
  createChat,
  saveMessage,
  saveMessageAttachments,
  saveGeneratedImage,
  getChatAttachments,
  deleteChat,
  deleteMessage,
} from '@/app/actions'

describe('attachment storage lifecycle', () => {
  let chatId: number
  let messageId: number

  beforeEach(async () => {
    await createTestDb()
    mockIsStorageConfigured.mockReturnValue(true)
    mockUploadBuffer.mockReset()
    mockUploadBuffer.mockResolvedValue(undefined)
    mockCreateSignedDownloadUrl.mockReset()
    mockCreateSignedDownloadUrl.mockImplementation(async (p: string) => `signed:${p}`)
    mockCreateSignedDownloadUrls.mockReset()
    mockCreateSignedDownloadUrls.mockImplementation(async (paths: string[]) => new Map(paths.map((p: string) => [p, `signed:${p}`])))
    mockRemoveObjects.mockReset()
    mockRemoveObjects.mockResolvedValue(undefined)
    mockListObjects.mockReset()
    mockListObjects.mockResolvedValue([])

    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    chatId = chat.id
    const [msg] = await saveMessage(chatId, 'user', 'Hello')
    messageId = msg.id
  })

  it('configured → saves storagePath and null dataUrl, calls uploadBuffer with decoded bytes', async () => {
    const dataUrl = 'data:image/png;base64,QUJD'
    const [row] = await saveMessageAttachments(messageId, chatId, [
      { filename: 'pic.png', mediaType: 'image/png', dataUrl, fileSize: 3 },
    ])

    expect(row.storagePath).toBe(`attachments/${chatId}/${messageId}/0-pic.png`)
    expect(row.dataUrl).toBeNull()

    expect(mockUploadBuffer).toHaveBeenCalledOnce()
    const [path, buf, mime] = mockUploadBuffer.mock.calls[0] as unknown as [string, Buffer, string]
    expect(path).toBe(`attachments/${chatId}/${messageId}/0-pic.png`)
    expect(buf).toEqual(Buffer.from('ABC'))
    expect(mime).toBe('image/png')
  })

  it('configured → returns each saved row with a signed url, in input order', async () => {
    const saved = await saveMessageAttachments(messageId, chatId, [
      { filename: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
      { filename: 'b.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])
    expect(saved.map(r => r.url)).toEqual([
      `signed:attachments/${chatId}/${messageId}/0-a.png`,
      `signed:attachments/${chatId}/${messageId}/1-b.png`,
    ])
  })

  it('configured → never returns fewer rows than it was given (the client pairs them by index)', async () => {
    // Simulate an insert whose RETURNING comes back short: silently dropping the
    // missing row would shift every later index onto the wrong image.
    const realInsert = testDb.insert.bind(testDb)
    const spy = vi.spyOn(testDb, 'insert').mockImplementationOnce(((table: Parameters<typeof realInsert>[0]) => {
      const builder = realInsert(table)
      return {
        values: (rows: Parameters<typeof builder.values>[0]) => {
          const query = builder.values(rows)
          return { returning: async () => (await query.returning()).slice(1) }
        },
      }
    }) as never)
    try {
      await expect(saveMessageAttachments(messageId, chatId, [
        { filename: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
        { filename: 'b.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
      ])).rejects.toThrow(/attachment/i)
    } finally {
      spy.mockRestore()
    }
  })

  it('configured → a signing failure still saves the rows, with a null url', async () => {
    mockCreateSignedDownloadUrls.mockRejectedValue(new Error('sign failed'))
    const saved = await saveMessageAttachments(messageId, chatId, [
      { filename: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])
    expect(saved).toHaveLength(1)
    expect(saved[0].url).toBeNull()
    expect(mockRemoveObjects).not.toHaveBeenCalled()
  })

  it('NOT configured → returns a null url (the data URL stays the source)', async () => {
    mockIsStorageConfigured.mockReturnValue(false)
    const [row] = await saveMessageAttachments(messageId, chatId, [
      { filename: 'pic.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])
    expect(row.url).toBeNull()
  })

  it('NOT configured → saves dataUrl, null storagePath, uploadBuffer NOT called', async () => {
    mockIsStorageConfigured.mockReturnValue(false)
    const dataUrl = 'data:image/png;base64,QUJD'
    const [row] = await saveMessageAttachments(messageId, chatId, [
      { filename: 'pic.png', mediaType: 'image/png', dataUrl, fileSize: 3 },
    ])

    expect(row.dataUrl).toBe(dataUrl)
    expect(row.storagePath).toBeNull()
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })

  it('configured → getChatAttachments returns signed url, correct mediaType and messageId', async () => {
    await saveMessageAttachments(messageId, chatId, [
      { filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])

    const rows = await getChatAttachments(chatId)
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBe(`signed:attachments/${chatId}/${messageId}/0-p.png`)
    expect(rows[0].mediaType).toBe('image/png')
    expect(rows[0].messageId).toBe(messageId)
  })

  it('legacy row (not configured) → getChatAttachments returns the dataUrl as url', async () => {
    mockIsStorageConfigured.mockReturnValue(false)
    const dataUrl = 'data:image/png;base64,QUJD'
    await saveMessageAttachments(messageId, chatId, [
      { filename: 'p.png', mediaType: 'image/png', dataUrl, fileSize: 3 },
    ])

    // Reset to "configured" so getChatAttachments would normally do storage lookups —
    // but this row has no storagePath so it should fall back to the dataUrl.
    mockIsStorageConfigured.mockReturnValue(true)

    const rows = await getChatAttachments(chatId)
    expect(rows[0].url).toBe(dataUrl)
  })

  it('mid-batch upload failure removes already-uploaded objects and throws (no orphans, no partial insert)', async () => {
    // First upload succeeds, second throws.
    mockUploadBuffer
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('storage 500'))

    await expect(saveMessageAttachments(messageId, chatId, [
      { filename: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
      { filename: 'b.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])).rejects.toThrow('storage 500')

    // The one object that did upload is cleaned up...
    expect(mockRemoveObjects).toHaveBeenCalledWith([`attachments/${chatId}/${messageId}/0-a.png`])
    // ...and nothing was inserted (all-or-nothing).
    const rows = await getChatAttachments(chatId)
    expect(rows).toHaveLength(0)
  })

  it('rejects an attachment whose decoded size exceeds the cap', async () => {
    const huge = 'A'.repeat(Math.ceil((20 * 1024 * 1024 * 4) / 3) + 8)
    await expect(saveMessageAttachments(messageId, chatId, [
      { filename: 'big.png', mediaType: 'image/png', dataUrl: `data:image/png;base64,${huge}`, fileSize: huge.length },
    ])).rejects.toThrow('Attachment too large')
  })

  it('saveGeneratedImage links an existing storage object (no upload) and renders inline', async () => {
    const path = `attachments/${chatId}/generated/abc.png`
    const [row] = await saveGeneratedImage(messageId, chatId, [
      { storagePath: path, mediaType: 'image/png', filename: 'generated-image.png' },
    ])
    // Inserts a row pointing at the already-uploaded object; no re-upload.
    expect(row.storagePath).toBe(path)
    expect(row.dataUrl).toBeNull()
    expect(mockUploadBuffer).not.toHaveBeenCalled()

    const rows = await getChatAttachments(chatId)
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBe(`signed:${path}`)
    expect(rows[0].mediaType).toBe('image/png')
    expect(rows[0].messageId).toBe(messageId)
  })

  it('configured → deleteChat calls removeObjects with the stored path', async () => {
    await saveMessageAttachments(messageId, chatId, [
      { filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])

    await deleteChat(chatId)

    expect(mockRemoveObjects).toHaveBeenCalledOnce()
    const [paths] = mockRemoveObjects.mock.calls[0] as unknown as [string[]]
    expect(paths).toEqual([`attachments/${chatId}/${messageId}/0-p.png`])
  })

  it('configured → deleteMessage removes that message\'s stored objects and its attachment rows', async () => {
    await saveMessageAttachments(messageId, chatId, [
      { filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])
    const [other] = await saveMessage(chatId, 'assistant', 'Kept')
    await saveMessageAttachments(other.id, chatId, [
      { filename: 'k.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])

    expect(await deleteMessage(messageId)).toBe(true)

    expect(mockRemoveObjects).toHaveBeenCalledExactlyOnceWith([`attachments/${chatId}/${messageId}/0-p.png`])
    expect((await getChatAttachments(chatId)).map(a => a.messageId)).toEqual([other.id])
  })

  it('configured → deleteMessage keeps a generated image an artifact of the chat embeds, removes an unreferenced one', async () => {
    const embedded = `attachments/${chatId}/generated/0b7f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.png`
    const unreferenced = `attachments/${chatId}/generated/9f8e7d6c-5b4a-4321-8fed-cba987654321.png`
    const [reply] = await saveMessage(chatId, 'assistant', 'Here is the page')
    await saveGeneratedImage(reply.id, chatId, [
      { storagePath: embedded, mediaType: 'image/png', filename: 'generated-image.png' },
      { storagePath: unreferenced, mediaType: 'image/png', filename: 'generated-image.png' },
    ])
    await testDb.insert(artifacts).values({
      chatId, type: 'html', title: 'Page', storagePath: `artifacts/${chatId}/page.html`, format: 'html',
      content: `<img src="/api/files/raw?path=${encodeURIComponent(embedded)}&sig=deadbeef">`,
    })

    expect(await deleteMessage(reply.id)).toBe(true)

    expect(mockRemoveObjects).toHaveBeenCalledExactlyOnceWith([unreferenced])
    expect(await testDb.select().from(messageAttachments).where(eq(messageAttachments.messageId, reply.id))).toEqual([])
  })

  it('configured → deleteChat sweeps the chat\'s pending/ and generated/ prefixes', async () => {
    mockListObjects.mockImplementation(async (prefix: string) => (
      prefix === `attachments/${chatId}/pending`
        ? [{ name: 'a1b2c3d4-0000-4000-8000-000000000000-notes.txt', createdAt: new Date().toISOString() }]
        : prefix === `attachments/${chatId}/generated`
          ? [{ name: 'kept.png', createdAt: null }]
          : []
    ))

    await deleteChat(chatId)

    expect(mockListObjects.mock.calls.map(c => c[0]).sort()).toEqual([`attachments/${chatId}/generated`, `attachments/${chatId}/pending`])
    expect(mockRemoveObjects.mock.calls.map(c => c[0]).sort()).toEqual([
      [`attachments/${chatId}/generated/kept.png`],
      [`attachments/${chatId}/pending/a1b2c3d4-0000-4000-8000-000000000000-notes.txt`],
    ])
    expect(await testDb.select().from(chats).where(eq(chats.id, chatId))).toEqual([])
  })

  it('configured → deleteChat still succeeds when the sweep fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockListObjects.mockRejectedValue(new Error('storage down'))

      await expect(deleteChat(chatId)).resolves.toBeUndefined()

      expect(await testDb.select().from(chats).where(eq(chats.id, chatId))).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})
