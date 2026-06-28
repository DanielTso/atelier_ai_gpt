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
const mockCreateSignedDownloadUrls = vi.fn(async (paths: string[]) => new Map(paths.map((p: string) => [p, `signed:${p}`])))
const mockRemoveObjects = vi.fn(async () => {})

vi.mock('@/lib/storage', () => ({
  get isStorageConfigured() { return mockIsStorageConfigured },
  get uploadBuffer() { return mockUploadBuffer },
  get createSignedDownloadUrl() { return mockCreateSignedDownloadUrl },
  get createSignedDownloadUrls() { return mockCreateSignedDownloadUrls },
  get removeObjects() { return mockRemoveObjects },
}))

import {
  createProject,
  createChat,
  saveMessage,
  saveMessageAttachments,
  saveGeneratedImage,
  getChatAttachments,
  deleteChat,
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
})
