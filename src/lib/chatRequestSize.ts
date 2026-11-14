import type { FileUIPart, UIMessage } from 'ai'
import { buildFileMessage, type AttachedFile, type AttachedImage } from '@/lib/fileAttachments'

// Every /api/chat request carries the chat session's WHOLE transcript, not just
// the new message: earlier turns' inline images (base64 data URLs), the text of
// every attached file, tool outputs. Vercel rejects a request body over 4.5 MB
// before the function runs, with an HTML 413 the chat UI can only show as a
// generic error — and every later turn in that session would fail the same way.
// So a send is measured as the real outgoing request and refused with a specific
// message instead (U4). 4 MB leaves headroom for the rest of the body.
export const CHAT_REQUEST_BUDGET_BYTES = 4 * 1024 * 1024

export const MESSAGE_TOO_LARGE_MESSAGE = 'This message is too large to send — remove some attachments'
export const CHAT_TOO_LARGE_MESSAGE = "This chat's attachments are too large to send in one request — start a new chat to continue"

export interface OutgoingChatMessage {
  text: string
  files?: FileUIPart[]
}

/** The user message a composer send posts: typed text, file text inlined, images as file parts. */
export function buildComposerMessage(input: string, files: AttachedFile[], images: AttachedImage[]): OutgoingChatMessage {
  const text = files.length > 0 ? buildFileMessage(input.trim(), files) : input.trim()
  if (images.length === 0) return { text }
  return { text, files: images.map(img => ({ type: 'file' as const, mediaType: img.mediaType, url: img.dataUrl })) }
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/**
 * Null when the request fits; otherwise the message to show. `history` is the
 * target chat session's transcript as it will be posted (empty for a chat that
 * doesn't exist yet).
 */
export function chatRequestSizeError(history: UIMessage[], next: OutgoingChatMessage): string | null {
  const nextBytes = utf8Bytes(next)
  if (nextBytes > CHAT_REQUEST_BUDGET_BYTES) return MESSAGE_TOO_LARGE_MESSAGE
  if (history.length === 0) return null
  if (nextBytes + utf8Bytes(history) > CHAT_REQUEST_BUDGET_BYTES) return CHAT_TOO_LARGE_MESSAGE
  return null
}

/**
 * Swap file parts' URLs (an inline data URL → its stored, signed URL) across a
 * transcript. Once a turn's images are saved to Storage they no longer need to
 * ride inline in every later request — the same shape loadMessages rebuilds
 * after a refresh. Messages without a matching part are returned as-is.
 */
export function replaceFilePartUrls(messages: UIMessage[], urls: Map<string, string>): UIMessage[] {
  if (urls.size === 0) return messages
  let changed = false
  const next = messages.map(message => {
    if (!message.parts.some(p => p.type === 'file' && urls.has(p.url))) return message
    changed = true
    return {
      ...message,
      parts: message.parts.map(p => (p.type === 'file' && urls.has(p.url) ? { ...p, url: urls.get(p.url) ?? p.url } : p)),
    }
  })
  return changed ? next : messages
}
