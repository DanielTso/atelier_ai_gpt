import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRender = vi.fn()
const mockUpload = vi.fn()
const mockCreate = vi.fn()
const mockSigned = vi.fn()

async function load() {
  vi.resetModules()
  vi.doMock('@/lib/artifacts/render', () => ({ renderArtifact: mockRender }))
  vi.doMock('@/lib/storage', () => ({ uploadBuffer: mockUpload, createSignedDownloadUrl: mockSigned, isStorageConfigured: () => true }))
  vi.doMock('@/app/actions', () => ({ createArtifact: mockCreate, updateArtifactStoragePath: vi.fn() }))
  return (await import('@/lib/artifacts/tool')).createGenerateArtifactTool
}

describe('generate_artifact tool', () => {
  beforeEach(() => {
    [mockRender, mockUpload, mockCreate, mockSigned].forEach(f => f.mockReset())
    mockRender.mockResolvedValue({ buffer: Buffer.from('PK..'), contentType: 'app/xlsx', ext: 'xlsx' })
    mockUpload.mockResolvedValue(undefined)
    mockCreate.mockResolvedValue([{ id: 9 }])
    mockSigned.mockResolvedValue('signed:url')
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

  it('returns an error result when rendering throws', async () => {
    mockRender.mockRejectedValue(new Error('bad content'))
    const make = await load()
    const tool = make({ chatId: 3, projectId: 1 })
    const out = await tool.execute!({ type: 'pdf', title: 'R', format: 'markdown', content: 'x' }, {} as never)
    expect(out).toEqual({ error: expect.stringContaining('Failed') })
  })
})
