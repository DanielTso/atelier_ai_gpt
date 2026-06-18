// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockUploadToSignedUrl = vi.fn()
vi.mock('@/lib/storageClient', () => ({
  getBrowserSupabase: () => ({ storage: { from: () => ({ uploadToSignedUrl: mockUploadToSignedUrl }) } }),
}))

describe('useDocumentUpload', () => {
  beforeEach(() => {
    mockUploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('upload-url')) return new Response(JSON.stringify({ documentId: 5, path: 'documents/1/5/a.txt', token: 'tok', bucket: 'atelier-files' }), { status: 200 })
      if (url.includes('process')) return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      return new Response('{}', { status: 200 })
    }))
  })

  it('runs the 3-step flow and toggles uploading', async () => {
    const { useDocumentUpload } = await import('@/hooks/useDocumentUpload')
    const { result } = renderHook(() => useDocumentUpload())
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
    await act(async () => { await result.current.upload(file, 1) })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('upload-url'))).toBe(true)
    expect(mockUploadToSignedUrl).toHaveBeenCalledWith('documents/1/5/a.txt', 'tok', file)
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('process'))).toBe(true)
    expect(result.current.uploading).toBe(false)
  })

  it('throws and resets uploading when the signed upload fails', async () => {
    mockUploadToSignedUrl.mockResolvedValue({ error: new Error('storage boom') })
    const { useDocumentUpload } = await import('@/hooks/useDocumentUpload')
    const { result } = renderHook(() => useDocumentUpload())
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
    await expect(act(async () => { await result.current.upload(file, 1) })).rejects.toThrow('storage boom')
    expect(result.current.uploading).toBe(false)
  })
})
