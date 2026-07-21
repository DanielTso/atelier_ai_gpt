import { describe, it, expect, vi, beforeEach } from 'vitest'

const downloadMock = vi.fn()
const getDocMock = vi.fn()
vi.mock('@/lib/storage', () => ({ downloadToBuffer: (...a: unknown[]) => downloadMock(...a) }))
vi.mock('@/app/actions', () => ({ getDocumentById: (...a: unknown[]) => getDocMock(...a) }))

import { createReadDocumentTool } from '@/lib/documents/tool'

const doc = {
  id: 7, projectId: 3, filename: 'plans.pdf', revision: 1,
  status: 'ready', failedPages: [12, 13], charCount: 60,
}

describe('read_document tool', () => {
  beforeEach(() => { downloadMock.mockReset(); getDocMock.mockReset() })

  it('returns a window with continuation metadata', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockResolvedValue(Buffer.from('# Page 1\nhello world\n# Page 2\nmore text'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(downloadMock).toHaveBeenCalledWith('documents/3/7/extracted.txt')
    expect(r.text).toContain('# Page 1')
    expect(r.unavailablePages).toEqual([12, 13])
    expect(r.nextOffset).toBeNull()
  })

  it('uses the revision-scoped path for replaced documents', async () => {
    getDocMock.mockResolvedValue({ ...doc, revision: 3 })
    downloadMock.mockResolvedValue(Buffer.from('text'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(downloadMock).toHaveBeenCalledWith('documents/3/7/rev3/extracted.txt')
  })

  it('refuses documents outside the chat project', async () => {
    getDocMock.mockResolvedValue({ ...doc, projectId: 99 })
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.error).toMatch(/not found/i)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('degrades gracefully when extracted.txt is missing', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockRejectedValue(new Error('Object not found'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.error).toMatch(/re-upload/i)
  })

  it('returns an error mentioning the anchor count when fromPage is beyond the document', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockResolvedValue(Buffer.from('# Page 1\nhello world\n# Page 2\nmore text'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7, fromPage: 99 }, {} as never)
    expect(r.error).toMatch(/no page 99/i)
    expect(r.error).toMatch(/2 page anchors/i)
  })

  it('returns an in-band error for excluded documents without touching storage', async () => {
    getDocMock.mockResolvedValue(doc)
    const tool = createReadDocumentTool({ projectId: 3, excludeDocumentIds: [7, 9] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.error).toBe("Document 7 is excluded from this chat's sources.")
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('reads normally when the document is not in the exclusion list', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockResolvedValue(Buffer.from('# Page 1\nhello world'))
    const tool = createReadDocumentTool({ projectId: 3, excludeDocumentIds: [9] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.error).toBeUndefined()
    expect(r.text).toContain('hello world')
  })

  it('prepends the cite-hint header to window text', async () => {
    getDocMock.mockResolvedValue(doc)
    downloadMock.mockResolvedValue(Buffer.from('# Page 1\nhello world'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.text.startsWith(
      'Cite as [cite:7 p<N>] using the # Page N markers in this text; if no page markers, cite [cite:7].\n'
    )).toBe(true)
    expect(r.text).toContain('# Page 1')
  })

  it('yields an empty unavailablePages array when failedPages is null', async () => {
    getDocMock.mockResolvedValue({ ...doc, failedPages: null })
    downloadMock.mockResolvedValue(Buffer.from('# Page 1\nhello world'))
    const tool = createReadDocumentTool({ projectId: 3 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (tool as any).execute({ documentId: 7 }, {} as never)
    expect(r.unavailablePages).toEqual([])
  })
})
