import { randomUUID } from 'node:crypto'
import { imageGenerateRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'
import { generateImageBytes } from '@/lib/image/generate'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl } from '@/lib/storage'
import { getGeminiApiKey } from '@/lib/settings'
import { createGeneratedImage } from '@/app/actions'

const IMAGE_URL_TTL_SECONDS = 60 * 60 // 1h

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiError(null, 'Invalid JSON body', 400)
    }

    const parsed = imageGenerateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const { prompt, aspectRatio, projectId } = parsed.data

    const apiKey = await getGeminiApiKey()
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Set a Gemini API key in Settings.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (!isStorageConfigured()) {
      return new Response(
        JSON.stringify({ error: 'Image storage is not configured.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    }

    let bytes: Buffer, mediaType: string, ext: string
    try {
      ;({ bytes, mediaType, ext } = await generateImageBytes(prompt, aspectRatio))
    } catch (e) {
      return apiError(e, 'Image generation failed', 502)
    }

    const storagePath = `images/${projectId ?? 'standalone'}/${randomUUID()}.${ext}`
    await uploadBuffer(storagePath, bytes, mediaType)

    const row = await createGeneratedImage({
      projectId: projectId ?? null,
      prompt,
      aspectRatio: aspectRatio ?? null,
      mediaType,
      storagePath,
      fileSize: bytes.byteLength,
    })
    if (!row) return apiError(null, 'Failed to save image record', 500)

    const url = await createSignedDownloadUrl(storagePath, IMAGE_URL_TTL_SECONDS).catch(e => {
      console.warn('[images/generate] signed url failed:', e instanceof Error ? e.message : e)
      return null
    })

    return Response.json({
      image: {
        id: row.id,
        projectId: row.projectId,
        prompt: row.prompt,
        aspectRatio: row.aspectRatio,
        mediaType: row.mediaType,
        fileSize: row.fileSize,
        createdAt: row.createdAt,
        url,
      },
    })
  } catch (e) {
    return apiError(e, 'Unexpected error', 500)
  }
}
