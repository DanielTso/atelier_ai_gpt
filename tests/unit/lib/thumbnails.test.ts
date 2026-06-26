import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRender = vi.fn()
const mockEncode = vi.fn()
const mockDrawImage = vi.fn()
const mockLoadImage = vi.fn()

function setup() {
  vi.resetModules()
  vi.doMock('unpdf', () => ({
    definePDFJSModule: () => Promise.resolve(),
    renderPageAsImage: (...a: unknown[]) => mockRender(...a),
  }))
  vi.doMock('@napi-rs/canvas', () => ({
    loadImage: (...a: unknown[]) => mockLoadImage(...a),
    createCanvas: () => ({
      getContext: () => ({ drawImage: mockDrawImage }),
      encode: (...a: unknown[]) => mockEncode(...a),
    }),
  }))
}

describe('thumbnails', () => {
  beforeEach(() => {
    [mockRender, mockEncode, mockDrawImage, mockLoadImage].forEach(f => f.mockReset())
    mockLoadImage.mockResolvedValue({ width: 1200, height: 900 })
    mockEncode.mockResolvedValue(Buffer.from('webp'))
  })

  it('generatePdfThumbnail renders page 1 and encodes webp', async () => {
    setup()
    mockRender.mockResolvedValue(new ArrayBuffer(8))
    const { generatePdfThumbnail } = await import('@/lib/thumbnails')
    const out = await generatePdfThumbnail(Buffer.from('pdf'))
    expect(mockRender).toHaveBeenCalledTimes(1)
    expect(mockRender.mock.calls[0][1]).toBe(1) // page 1
    expect(mockEncode).toHaveBeenCalledWith('webp', expect.any(Number))
    expect(Buffer.isBuffer(out)).toBe(true)
  })

  it('generateImageThumbnail downscales and encodes webp', async () => {
    setup()
    const { generateImageThumbnail } = await import('@/lib/thumbnails')
    const out = await generateImageThumbnail(Buffer.from('img'))
    expect(mockLoadImage).toHaveBeenCalledTimes(1)
    expect(mockDrawImage).toHaveBeenCalledTimes(1)
    expect(Buffer.isBuffer(out)).toBe(true)
  })

  it('rejects a pathological source raster above the pixel budget (no further work)', async () => {
    setup()
    mockLoadImage.mockResolvedValue({ width: 100_000, height: 100_000 }) // 10 GP
    const { generateImageThumbnail } = await import('@/lib/thumbnails')
    await expect(generateImageThumbnail(Buffer.from('img'))).rejects.toThrow(/too large/i)
    expect(mockDrawImage).not.toHaveBeenCalled()
  })
})
