import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

const mockIsStorageConfigured = vi.fn(() => true)
const mockUploadBuffer = vi.fn(async () => {})
const mockCreateSignedDownloadUrl = vi.fn(async (p: string) => `signed:${p}`)
const mockRemoveObjects = vi.fn(async () => {})

vi.mock('@/lib/storage', () => ({
  get isStorageConfigured() { return mockIsStorageConfigured },
  get uploadBuffer() { return mockUploadBuffer },
  get createSignedDownloadUrl() { return mockCreateSignedDownloadUrl },
  get removeObjects() { return mockRemoveObjects },
}))

import {
  createProject,
  createChat,
  saveMessage,
  saveMessageAttachments,
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
    mockRemoveObjects.mockReset()
    mockRemoveObjects.mockResolvedValue(undefined)

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

  it('configured → deleteChat calls removeObjects with the stored path', async () => {
    await saveMessageAttachments(messageId, chatId, [
      { filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])

    await deleteChat(chatId)

    expect(mockRemoveObjects).toHaveBeenCalledOnce()
    const [paths] = mockRemoveObjects.mock.calls[0] as unknown as [string[]]
    expect(paths).toEqual([`attachments/${chatId}/${messageId}/0-p.png`])
  })
})
