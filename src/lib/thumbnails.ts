const THUMB_WIDTH = Number(process.env.THUMBNAIL_WIDTH) || 600

// Refuse to thumbnail a pathological (decompression-bomb-style) source raster. The
// decode in loadImage() is the inherent native-memory cost — @napi-rs/canvas can't
// report dimensions without decoding — but once decoded we bail on an absurd raster
// instead of doing further work; the best-effort caller skips the thumbnail on throw.
// (THUMB_WIDTH already bounds the OUTPUT canvas regardless of source size.)
const MAX_SOURCE_PIXELS = 100_000_000 // 100 MP

/** Render page 1 of a PDF to a small WebP thumbnail. Throws on failure (best-effort caller). */
export async function generatePdfThumbnail(buffer: Buffer): Promise<Buffer> {
  const { definePDFJSModule, renderPageAsImage } = await import('unpdf')
  await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
  const png = await renderPageAsImage(new Uint8Array(buffer), 1, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: 1,
  })
  return downscaleToWebp(Buffer.from(png))
}

/** Downscale an uploaded image to a small WebP thumbnail. */
export async function generateImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return downscaleToWebp(buffer)
}

async function downscaleToWebp(input: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const img = await loadImage(input)
  if (img.width * img.height > MAX_SOURCE_PIXELS) {
    throw new Error(`Image too large to thumbnail (${img.width}x${img.height})`)
  }
  const scale = Math.min(1, THUMB_WIDTH / img.width)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return await canvas.encode('webp', 80)
}
