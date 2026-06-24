import { tool, generateText } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from '@/lib/settings'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, ARTIFACT_URL_TTL_SECONDS } from '@/lib/storage'

// Nano Banana 2 — the same Gemini image model exposed in the model picker, here as a
// tool Claude can call mid-conversation. It returns an image as a `file` in the
// generateText result (the proven path, identical to selecting the image model directly).
const IMAGE_MODEL = 'gemini-3.1-flash-image'

/**
 * `generate_image` tool: generate an image from a prompt with Nano Banana, upload it to
 * storage, and return a small descriptor ({ storagePath, url, mediaType, filename }) — never
 * base64, so the tool result stays tiny in the conversation. The caller (onFinish) links the
 * stored image to the assistant message so it renders inline via the existing attachment path.
 */
export function createGenerateImageTool(ctx: { chatId: number; projectId: number | null }) {
  return tool({
    description:
      'Generate an image INLINE from a text prompt (Nano Banana / Gemini), shown directly in the conversation. ' +
      'Use when the user asks to create, generate, draw, design, or make an image, illustration, mockup, logo, icon, diagram, concept art, or picture. ' +
      'Write a vivid, detailed prompt. Do NOT use this for downloadable documents (use generate_artifact) or for plain text answers.',
    inputSchema: z.object({
      prompt: z.string().min(1).max(1500),
      aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
    }),
    execute: async ({ prompt, aspectRatio }) => {
      try {
        if (!isStorageConfigured()) return { error: 'Image storage is not configured.' }
        const apiKey = await getGeminiApiKey()
        if (!apiKey) return { error: 'Image generation is unavailable (no Gemini key configured).' }

        const google = createGoogleGenerativeAI({ apiKey })
        const fullPrompt = aspectRatio ? `${prompt}\n\n(Aspect ratio: ${aspectRatio})` : prompt
        const result = await generateText({
          model: google(IMAGE_MODEL),
          prompt: fullPrompt,
          providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
        })

        const img = result.files.find(f => f.mediaType?.startsWith('image/'))
        if (!img) return { error: 'No image was generated — try rephrasing the prompt.' }

        const ext = img.mediaType.includes('jpeg') ? 'jpg' : img.mediaType.includes('webp') ? 'webp' : 'png'
        const path = `attachments/${ctx.chatId}/generated/${randomUUID()}.${ext}`
        await uploadBuffer(path, Buffer.from(img.uint8Array), img.mediaType)
        const url = await createSignedDownloadUrl(path, ARTIFACT_URL_TTL_SECONDS)
        return { storagePath: path, url, mediaType: img.mediaType, filename: `generated-image.${ext}` }
      } catch (e) {
        console.warn('[generate_image] failed:', e instanceof Error ? e.message : e)
        return { error: 'Image generation failed.' }
      }
    },
  })
}
