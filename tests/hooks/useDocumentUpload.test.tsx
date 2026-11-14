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

  it('reports a platform 504 from process as a timeout, not a JSON parse error (U12)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('upload-url')) return new Response(JSON.stringify({ documentId: 5, path: 'p', token: 't', bucket: 'b' }), { status: 200 })
      return new Response('<html><body>An error occurred with your deployment</body></html>', { status: 504, headers: { 'content-type': 'text/html' } })
    }))
    const { useDocumentUpload } = await import('@/hooks/useDocumentUpload')
    const { result } = renderHook(() => useDocumentUpload())
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
    let message = ''
    await act(async () => { await result.current.upload(file, 1).catch((e: Error) => { message = e.message }) })
    expect(message).not.toMatch(/Unexpected token|JSON|SyntaxError/)
    expect(message).toBe("Processing timed out — refresh to see the document's status.")
  })

  it("passes the route's own error through when minting the upload URL fails", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Project is at capacity' }), { status: 400 })))
    const { useDocumentUpload } = await import('@/hooks/useDocumentUpload')
    const { result } = renderHook(() => useDocumentUpload())
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
    await expect(act(async () => { await result.current.replace(file, 3) })).rejects.toThrow('Project is at capacity')
  })
})
