import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from '@/lib/settings'
import { recordUsage } from '@/lib/usage'

const IMAGE_MODEL = 'gemini-3.1-flash-image'

/** Derive a file extension from a MIME type for the image. */
function extFromMediaType(mediaType: string): string {
  if (mediaType.includes('jpeg')) return 'jpg'
  if (mediaType.includes('webp')) return 'webp'
  return 'png'
}

/**
 * Generate an image with Nano Banana 2 and return the raw bytes + metadata.
 *
 * Callers are responsible for uploading + persisting the result. Throws on
 * missing key, on generation failure, or when the model returns no image part.
 * Every completed generation (image or not) writes one best-effort usage row
 * (purpose 'image-generate'), so both callers — POST /api/images/generate and
 * the chat's generate_image tool — are recorded.
 *
 * @param prompt      The user's image prompt.
 * @param aspectRatio Optional aspect-ratio hint (e.g. "16:9"). Appended to the
 *                    prompt as a concise text hint — Nano Banana has no explicit
 *                    aspect-ratio parameter.
 * @param usageCtx    The chat/project the usage row is billed to.
 */
export async function generateImageBytes(
  prompt: string,
  aspectRatio?: string,
  usageCtx: { chatId?: number | null; projectId?: number | null } = {},
): Promise<{ bytes: Buffer; mediaType: string; ext: string }> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Image generation is unavailable — no Gemini API key configured.')
  }

  const fullPrompt = aspectRatio ? `${prompt}\n\nAspect ratio: ${aspectRatio}` : prompt

  const google = createGoogleGenerativeAI({ apiKey })
  const result = await generateText({
    model: google(IMAGE_MODEL),
    prompt: fullPrompt,
    providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
  })
  void recordUsage({
    chatId: usageCtx.chatId ?? null, projectId: usageCtx.projectId ?? null,
    purpose: 'image-generate', model: IMAGE_MODEL, usage: result.totalUsage,
  }).catch(() => {})

  const img = result.files.find(f => typeof f.mediaType === 'string' && f.mediaType.startsWith('image/'))
  if (!img) {
    throw new Error('No image was returned by the model — try rephrasing the prompt.')
  }

  const mediaType = img.mediaType as string
  const ext = extFromMediaType(mediaType)
  const bytes = Buffer.from(img.uint8Array)

  return { bytes, mediaType, ext }
}
