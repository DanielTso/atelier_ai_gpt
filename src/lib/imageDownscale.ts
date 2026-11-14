'use client'

// Browser only (canvas + createImageBitmap). Chat images travel inline as base64
// in the /api/chat body, which Vercel caps at 4.5 MB, so a phone photo has to be
// shrunk before it is attached. 2048 px on the long edge is more detail than
// Claude uses (it downsizes larger images itself), and WebP at 0.85 keeps a
// typical photo well under 1 MB.

export const DOWNSCALE_THRESHOLD_BYTES = 1024 * 1024
export const MAX_IMAGE_EDGE = 2048
export const IMAGE_QUALITY = 0.85

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, IMAGE_QUALITY))
}

function renameExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`
}

/**
 * Returns the file unchanged when it is at most 1 MB; otherwise a re-encoded copy
 * whose long edge is at most 2048 px (WebP, or JPEG where the browser can't encode
 * WebP). If re-encoding doesn't make it smaller, the original is kept. Throws if
 * the browser can't decode the image.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (file.size <= DOWNSCALE_THRESHOLD_BYTES) return file

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    let blob = await toBlob(canvas, 'image/webp')
    // A browser that can't encode WebP silently returns PNG — fall back to JPEG,
    // flattened onto white so transparent areas don't turn black.
    if (!blob || blob.type !== 'image/webp') {
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      blob = await toBlob(canvas, 'image/jpeg')
    }
    if (!blob || blob.size >= file.size) return file

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], renameExtension(file.name, ext), { type: blob.type })
  } finally {
    bitmap.close()
  }
}
