const THUMB_WIDTH = Number(process.env.THUMBNAIL_WIDTH) || 600

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
  const scale = Math.min(1, THUMB_WIDTH / img.width)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return await canvas.encode('webp', 80)
}
