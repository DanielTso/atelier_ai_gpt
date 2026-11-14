// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import type { AttachedFile, AttachedImage } from '@/lib/fileAttachments'

// Toolbar children are out of scope here (PersonaSelector pulls in the persona store).
vi.mock('@/components/ui/PersonaSelector', () => ({ PersonaSelector: () => null }))
vi.mock('@/components/ui/EffortPill', () => ({ EffortPill: () => null }))
vi.mock('@/components/ui/ModelSelect', () => ({ ModelSelect: () => null }))

const mockToastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn() } }))

// Storage is always mocked — the signed upload never reaches Supabase.
const mockUploadToSignedUrl = vi.fn()
vi.mock('@/lib/storageClient', () => ({
  getBrowserSupabase: () => ({ storage: { from: () => ({ uploadToSignedUrl: mockUploadToSignedUrl }) } }),
}))

// jsdom has no canvas/createImageBitmap: downscaling is an identity here, and the
// spy proves it is applied to images over the 1 MB threshold.
const mockDownscale = vi.fn(async (f: File) => f)
vi.mock('@/lib/imageDownscale', () => ({ downscaleImage: (f: File) => mockDownscale(f) }))

import { ChatInputArea } from '@/components/chat/ChatInputArea'

afterEach(cleanup)

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>
let handler: FetchHandler
const fetchMock = vi.fn((url: string, init?: RequestInit) => handler(url, init))

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function extractOk(name: string, text = `text of ${name}`) {
  return json({ filename: name, mimeType: 'text/plain', textContent: text, charCount: text.length, truncated: false })
}

/** A promise the test resolves by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  mockToastError.mockReset()
  mockDownscale.mockClear()
  mockUploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
  fetchMock.mockClear()
  // Default: no Storage (upload-url 503) → multipart extraction.
  handler = async (url, init) => {
    if (url.startsWith('/api/embed')) return json({ available: false, provider: null, embeddingCount: 0 })
    if (url === '/api/attachments/upload-url') return json({ error: 'File storage is not configured.' }, 503)
    if (url === '/api/extract') {
      const file = (init?.body as FormData).get('file') as File
      return extractOk(file.name)
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  vi.stubGlobal('fetch', fetchMock)
})

function Harness({ onKeyDown = vi.fn(), initialInput = '' }: { onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void; initialInput?: string }) {
  const [input, setInput] = useState(initialInput)
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [images, setImages] = useState<AttachedImage[]>([])
  return (
    <ChatInputArea
      input={input}
      onInputChange={setInput}
      onFormSubmit={e => e.preventDefault()}
      onKeyDown={onKeyDown}
      isLoading={false}
      activeChatId={7}
      activeProjectId={null}
      systemPrompt={null}
      onSystemPromptChange={vi.fn()}
      onSystemPromptClick={vi.fn()}
      attachedFiles={files}
      onFilesChange={setFiles}
      attachedImages={images}
      onImagesChange={setImages}
    />
  )
}

function attach(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

const bytes = (n: number) => new Uint8Array(n)
const urlsCalled = () => fetchMock.mock.calls.map(c => String(c[0]))

describe('ChatInputArea attachments', () => {
  it('rejects-svg-heic-avif: unsupported image types are refused with a message and never sent', async () => {
    const { container } = render(<Harness />)
    attach(container, [
      new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
      new File([bytes(10)], 'IMG_1.heic', { type: 'image/heic' }),
      new File([bytes(10)], 'pic.avif', { type: 'image/avif' }),
    ])
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(3))
    for (const call of mockToastError.mock.calls) expect(String(call[0])).toContain('Unsupported image type')
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(urlsCalled().some(u => u.includes('/api/extract') || u.includes('upload-url'))).toBe(false)
  })

  it('the file picker offers only the four supported image types', () => {
    const { container } = render(<Harness />)
    const accept = (container.querySelector('input[type="file"]') as HTMLInputElement).accept
    expect(accept).not.toContain('image/*')
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(accept).toContain(t)
  })

  it('rejects-over-combined-image-budget-with-message: an image that would push the payload past 3 MB is refused', async () => {
    const { container } = render(<Harness />)
    // 1.5 MB raw ≈ 2 MB of base64 each: one fits, two do not.
    attach(container, [new File([bytes(1.5 * 1024 * 1024)], 'site-1.png', { type: 'image/png' })])
    await screen.findByAltText('site-1.png')
    attach(container, [new File([bytes(1.5 * 1024 * 1024)], 'site-2.png', { type: 'image/png' })])
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Images too large to send together (max 3 MB)'))
    expect(screen.queryByAltText('site-2.png')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('downscales images over 1 MB before attaching them', async () => {
    const { container } = render(<Harness />)
    attach(container, [
      new File([bytes(512)], 'small.png', { type: 'image/png' }),
      new File([bytes(1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }),
    ])
    await screen.findByAltText('big.jpg')
    expect(mockDownscale).toHaveBeenCalledTimes(2)
  })

  it('send-disabled-while-extracting: the send button and Enter are both blocked until extraction finishes', async () => {
    const pending = deferred<Response>()
    handler = async (url) => {
      if (url.startsWith('/api/embed')) return json({ available: false, provider: null, embeddingCount: 0 })
      if (url === '/api/attachments/upload-url') return json({ error: 'not configured' }, 503)
      if (url === '/api/extract') return pending.promise
      throw new Error(`unexpected fetch ${url}`)
    }
    const onKeyDown = vi.fn()
    const { container } = render(<Harness onKeyDown={onKeyDown} initialInput="summarize the attachment" />)
    const send = screen.getByRole('button', { name: 'Send message' })
    expect((send as HTMLButtonElement).disabled).toBe(false)

    attach(container, [new File(['a'], 'a.txt', { type: 'text/plain' })])
    await screen.findByText('Extracting...')
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onKeyDown).not.toHaveBeenCalled()

    await act(async () => { pending.resolve(extractOk('a.txt')) })
    await screen.findByText('a.txt')
    expect((send as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('concurrent-drops-keep-all-files: a slow extraction does not drop a file attached meanwhile', async () => {
    const byName = new Map<string, ReturnType<typeof deferred<Response>>>()
    handler = async (url, init) => {
      if (url.startsWith('/api/embed')) return json({ available: false, provider: null, embeddingCount: 0 })
      if (url === '/api/attachments/upload-url') return json({ error: 'not configured' }, 503)
      if (url === '/api/extract') {
        const name = ((init?.body as FormData).get('file') as File).name
        const d = deferred<Response>()
        byName.set(name, d)
        return d.promise
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const { container } = render(<Harness />)
    attach(container, [new File(['a'], 'a.txt', { type: 'text/plain' })])
    attach(container, [new File(['b'], 'b.txt', { type: 'text/plain' })])
    await waitFor(() => expect(byName.size).toBe(2))

    await act(async () => { byName.get('a.txt')!.resolve(extractOk('a.txt')) })
    await screen.findByText('a.txt')
    // Still extracting b → the indicator stays and send stays blocked.
    expect(screen.getByText('Extracting...')).toBeTruthy()

    await act(async () => { byName.get('b.txt')!.resolve(extractOk('b.txt')) })
    await screen.findByText('b.txt')
    expect(screen.getByText('a.txt')).toBeTruthy()
    expect(screen.queryByText('Extracting...')).toBeNull()
  })

  it('routes a non-image file through a signed Storage upload, then extracts by storage path', async () => {
    const path = 'attachments/7/pending/0b8f6a52-3c1e-4d7a-9f10-2a6b5c4d3e21-geotech.pdf'
    let extractBody: unknown = null
    handler = async (url, init) => {
      if (url.startsWith('/api/embed')) return json({ available: false, provider: null, embeddingCount: 0 })
      if (url === '/api/attachments/upload-url') return json({ path, token: 'tok', bucket: 'atelier-files' })
      if (url === '/api/extract') {
        extractBody = JSON.parse(String(init?.body))
        return extractOk('geotech.pdf', 'Boring log B-3')
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const file = new File([bytes(20 * 1024 * 1024)], 'Geotech Report.pdf', { type: 'application/pdf' })
    const { container } = render(<Harness />)
    attach(container, [file])
    await screen.findByText('Geotech Report.pdf')

    const urlCall = fetchMock.mock.calls.find(c => c[0] === '/api/attachments/upload-url')!
    expect(JSON.parse(String(urlCall[1]?.body))).toEqual({
      chatId: 7, filename: 'Geotech Report.pdf', mediaType: 'application/pdf', size: file.size,
    })
    expect(mockUploadToSignedUrl).toHaveBeenCalledWith(path, 'tok', file)
    expect(extractBody).toEqual({ chatId: 7, storagePath: path, mediaType: 'application/pdf' })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('a file over 4 MB without Storage gets a size-specific message, not a doomed multipart request', async () => {
    const { container } = render(<Harness />)
    attach(container, [new File([bytes(5 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })])
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(String(mockToastError.mock.calls[0][0])).toMatch(/too large/i)
    expect(urlsCalled()).not.toContain('/api/extract')
  })

  it('an upload-url validation error is reported as-is (no multipart retry)', async () => {
    handler = async (url) => {
      if (url.startsWith('/api/embed')) return json({ available: false, provider: null, embeddingCount: 0 })
      if (url === '/api/attachments/upload-url') return json({ error: 'Unsupported file type: tool.exe.' }, 400)
      throw new Error(`unexpected fetch ${url}`)
    }
    const { container } = render(<Harness />)
    attach(container, [new File(['x'], 'tool.exe', { type: 'application/octet-stream' })])
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Unsupported file type: tool.exe.'))
    expect(urlsCalled()).not.toContain('/api/extract')
  })

  it('a platform 413 on the multipart fallback reads as a size problem', async () => {
    handler = async (url) => {
      if (url.startsWith('/api/embed')) return json({ available: false, provider: null, embeddingCount: 0 })
      if (url === '/api/attachments/upload-url') return json({ error: 'not configured' }, 503)
      if (url === '/api/extract') return new Response('<html>Request Entity Too Large</html>', { status: 413 })
      throw new Error(`unexpected fetch ${url}`)
    }
    const { container } = render(<Harness />)
    attach(container, [new File(['x'], 'notes.txt', { type: 'text/plain' })])
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('File too large for upload'))
  })
})
