import { tool } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, ARTIFACT_URL_TTL_SECONDS } from '@/lib/storage'
import { generateImageBytes } from '@/lib/image/generate'

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

        const { bytes, mediaType, ext } = await generateImageBytes(prompt, aspectRatio)

        const path = `attachments/${ctx.chatId}/generated/${randomUUID()}.${ext}`
        await uploadBuffer(path, bytes, mediaType)
        const url = await createSignedDownloadUrl(path, ARTIFACT_URL_TTL_SECONDS)
        return { storagePath: path, url, mediaType, filename: `generated-image.${ext}`, fileSize: bytes.byteLength }
      } catch (e) {
        console.warn('[generate_image] failed:', e instanceof Error ? e.message : e)
        return { error: 'Image generation failed.' }
      }
    },
  })
}
