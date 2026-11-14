// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downscaleImage, DOWNSCALE_THRESHOLD_BYTES, MAX_IMAGE_EDGE } from '@/lib/imageDownscale'

// jsdom has neither createImageBitmap nor a canvas encoder: both are faked so the
// downscaler's own logic (threshold, scale, format fallback, keep-if-not-smaller)
// runs for real.

interface FakeCanvas {
  width: number
  height: number
  getContext: () => unknown
  toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => void
}

let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> }
let canvases: FakeCanvas[]
let toBlobCalls: string[]
/** What the fake encoder returns for each requested type (null = can't encode). */
let encoded: Record<string, Blob | null>
const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), globalCompositeOperation: '', fillStyle: '' }

const big = (type = 'image/png', size = DOWNSCALE_THRESHOLD_BYTES + 1, name = 'site.png') =>
  new File([new Uint8Array(size)], name, { type })

beforeEach(() => {
  bitmap = { width: 4000, height: 3000, close: vi.fn() }
  canvases = []
  toBlobCalls = []
  encoded = { 'image/webp': new Blob([new Uint8Array(1000)], { type: 'image/webp' }) }
  ctx.drawImage.mockClear()
  ctx.fillRect.mockClear()
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag)
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb, type) => {
        toBlobCalls.push(type)
        cb(encoded[type] ?? null)
      },
    }
    canvases.push(canvas)
    return canvas as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downscaleImage', () => {
  it('returns a file at or under the 1 MB threshold untouched, without decoding it', async () => {
    const file = big('image/png', DOWNSCALE_THRESHOLD_BYTES)
    expect(await downscaleImage(file)).toBe(file)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('re-encodes a larger image to WebP with its long edge capped at 2048 px', async () => {
    const out = await downscaleImage(big())
    expect(canvases[0].width).toBe(MAX_IMAGE_EDGE)
    expect(canvases[0].height).toBe(1536) // 3000 × 2048/4000
    expect(out.type).toBe('image/webp')
    expect(out.name).toBe('site.webp')
    expect(out.size).toBe(1000)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('never upscales an image already within the edge limit', async () => {
    bitmap = { width: 1200, height: 800, close: vi.fn() }
    await downscaleImage(big())
    expect([canvases[0].width, canvases[0].height]).toEqual([1200, 800])
  })

  it('falls back to JPEG, flattened onto white, where the browser cannot encode WebP', async () => {
    // A browser without a WebP encoder hands back PNG instead.
    encoded = {
      'image/webp': new Blob([new Uint8Array(900)], { type: 'image/png' }),
      'image/jpeg': new Blob([new Uint8Array(800)], { type: 'image/jpeg' }),
    }
    const out = await downscaleImage(big())
    expect(toBlobCalls).toEqual(['image/webp', 'image/jpeg'])
    expect(ctx.fillRect).toHaveBeenCalled()
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('site.jpg')
  })

  it('keeps the original when re-encoding does not make it smaller', async () => {
    const file = big()
    encoded = { 'image/webp': new Blob([new Uint8Array(file.size + 10)], { type: 'image/webp' }) }
    expect(await downscaleImage(file)).toBe(file)
  })

  it('leaves a GIF alone (a canvas would keep only its first frame)', async () => {
    const gif = big('image/gif', 3 * DOWNSCALE_THRESHOLD_BYTES, 'loop.gif')
    expect(await downscaleImage(gif)).toBe(gif)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('throws when the browser cannot decode the image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed') }))
    await expect(downscaleImage(big())).rejects.toThrow('decode failed')
  })
})
