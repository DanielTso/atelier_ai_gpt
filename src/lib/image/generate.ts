import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from '@/lib/settings'

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
 *
 * @param prompt      The user's image prompt.
 * @param aspectRatio Optional aspect-ratio hint (e.g. "16:9"). Appended to the
 *                    prompt as a concise text hint — Nano Banana has no explicit
 *                    aspect-ratio parameter.
 */
export async function generateImageBytes(
  prompt: string,
  aspectRatio?: string,
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

  const img = result.files.find(f => f.mediaType?.startsWith('image/'))
  if (!img) {
    throw new Error('No image was returned by the model — try rephrasing the prompt.')
  }

  const mediaType = img.mediaType
  const ext = extFromMediaType(mediaType)
  const bytes = Buffer.from(img.uint8Array)

  return { bytes, mediaType, ext }
}
