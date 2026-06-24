import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRender = vi.fn()
const mockUpload = vi.fn()
const mockCreate = vi.fn()
const mockSigned = vi.fn()
const mockRemove = vi.fn()

async function load() {
  vi.resetModules()
  vi.doMock('@/lib/artifacts/render', () => ({ renderArtifact: mockRender }))
  vi.doMock('@/lib/storage', () => ({ uploadBuffer: mockUpload, createSignedDownloadUrl: mockSigned, removeObjects: mockRemove, isStorageConfigured: () => true, ARTIFACT_URL_TTL_SECONDS: 86400 }))
  vi.doMock('@/app/actions', () => ({ createArtifact: mockCreate, updateArtifactStoragePath: vi.fn() }))
  return (await import('@/lib/artifacts/tool')).createGenerateArtifactTool
}

describe('generate_artifact tool', () => {
  beforeEach(() => {
    [mockRender, mockUpload, mockCreate, mockSigned, mockRemove].forEach(f => f.mockReset())
    mockRender.mockResolvedValue({ buffer: Buffer.from('PK..'), contentType: 'app/xlsx', ext: 'xlsx' })
    mockUpload.mockResolvedValue(undefined)
    mockCreate.mockResolvedValue([{ id: 9 }])
    mockSigned.mockResolvedValue('signed:url')
    mockRemove.mockResolvedValue(undefined)
  })

  it('renders, uploads, persists, returns a downloadable result', async () => {
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute!({ type: 'xlsx', title: 'Schedule', format: 'sheets', content: [{ name: 'T', rows: [['a']] }] }, {} as never)
    expect(mockRender).toHaveBeenCalledWith('xlsx', 'Schedule', [{ name: 'T', rows: [['a']] }])
    expect(mockUpload).toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ chatId: 3, projectId: 1, type: 'xlsx', title: 'Schedule' }))
    expect(out).toEqual({ artifactId: 9, title: 'Schedule', type: 'xlsx', downloadUrl: 'signed:url' })
  })

  it('supports html artifacts (string content, html path)', async () => {
    mockRender.mockResolvedValue({ buffer: Buffer.from('<html>'), contentType: 'text/html; charset=utf-8', ext: 'html' })
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute!({ type: 'html', title: 'Landing', format: 'html', content: '<!doctype html><h1>Hi</h1>' }, {} as never)
    expect(mockRender).toHaveBeenCalledWith('html', 'Landing', '<!doctype html><h1>Hi</h1>')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'html', format: 'html', content: '<!doctype html><h1>Hi</h1>' }))
    expect(out).toEqual({ artifactId: 9, title: 'Landing', type: 'html', downloadUrl: 'signed:url' })
    expect(mockUpload.mock.calls[0][0]).toMatch(/^artifacts\/1\/.+\/landing\.html$/)
  })

  it('persists only after a successful upload (real path, no pending sentinel)', async () => {
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    await tool.execute!({ type: 'xlsx', title: 'Schedule', format: 'sheets', content: [{ name: 'T', rows: [['a']] }] }, {} as never)
    // upload happens before the row is created, and the row gets the real (non-'pending') path
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0])
    const createdPath = mockCreate.mock.calls[0][0].storagePath as string
    expect(createdPath).not.toBe('pending')
    expect(createdPath).toMatch(/^artifacts\/1\/.+\/schedule\.xlsx$/)
    expect(mockUpload.mock.calls[0][0]).toBe(createdPath) // uploaded to the same path that was persisted
  })

  it('returns an error result when rendering throws (no upload, no row)', async () => {
    mockRender.mockRejectedValue(new Error('bad content'))
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute!({ type: 'pdf', title: 'R', format: 'markdown', content: 'x' }, {} as never)
    expect(out).toEqual({ error: expect.stringContaining('Failed') })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('removes the uploaded object if the DB insert fails (no orphan blob)', async () => {
    mockCreate.mockRejectedValue(new Error('db down'))
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute!({ type: 'xlsx', title: 'Schedule', format: 'sheets', content: [{ name: 'T', rows: [['a']] }] }, {} as never)
    expect(out).toEqual({ error: expect.stringContaining('Failed') })
    expect(mockUpload).toHaveBeenCalled()
    expect(mockRemove).toHaveBeenCalledWith([mockUpload.mock.calls[0][0]])
  })
})
