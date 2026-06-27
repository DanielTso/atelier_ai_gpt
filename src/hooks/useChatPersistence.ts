import { useCallback, type RefObject } from 'react'
import type { UIMessage } from 'ai'
import {
  saveMessage,
  saveGeneratedImage,
  saveMessageAttachments,
  incrementUsageMessageCount,
  getMessageCount,
  getChatMessages,
} from '@/app/actions'
import { extractText } from '@/lib/messageParts'
import { extractGeneratedImageOutputs } from '@/lib/generatedImages'
import { SUMMARIZATION_THRESHOLD } from '@/hooks/useSummarization'
import type { ArtifactSummary } from '@/types'

// How many new messages must accumulate in a project chat before triggering
// an auto-memory suggestion pass. Monotonic gate: fires once per MEMORY_SUGGEST_EVERY
// new messages, robust to count jumps and overlapping onFinish calls.
export const MEMORY_SUGGEST_EVERY = 6

export interface UseChatPersistenceOpts {
  activeChatIdRef: RefObject<number | null>
  activeProjectIdRef: RefObject<number | null>
  lastSavedAssistantIdRef: RefObject<string | null>
  lastSuggestedAtRef: RefObject<Map<number, number>>
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>
  setArtifacts: React.Dispatch<React.SetStateAction<ArtifactSummary[]>>
  triggerSummarization: (chatId: number, messageCount: number) => Promise<void>
  maybeGenerateTitle: (chatId: number) => void
}

/**
 * Returns the `onFinish` handler for `useChat`. Extracted from page.tsx so that
 * the full message-persistence pipeline (save → embed → summarize → memory-suggest
 * → title → artifact-refetch) can be tested in isolation.
 *
 * All server actions and utility imports live INSIDE this module (not injected);
 * only the runtime state refs / callbacks are injected via opts so the hook is
 * decoupled from page state.
 */
export function useChatPersistence(opts: UseChatPersistenceOpts) {
  const {
    activeChatIdRef,
    activeProjectIdRef,
    lastSavedAssistantIdRef,
    lastSuggestedAtRef,
    setMessages,
    setArtifacts,
    triggerSummarization,
    maybeGenerateTitle,
  } = opts

  return useCallback(
    async ({ message }: { message: UIMessage }) => {
      const currentChatId = activeChatIdRef.current
      const currentProjectId = activeProjectIdRef.current

      // Extract text content from message parts
      const textContent = extractText(message.parts)
      // Images produced by the generate_image tool (surfaced as tool-result parts).
      const imageOutputs = extractGeneratedImageOutputs(message.parts)
      // Artifacts produced by the generate_artifact tool surface as tool-result parts
      // (not file parts). Detect them so an artifact-only turn (no prose) is still saved.
      const hasArtifactOutput = message.parts.some(
        p => typeof p.type === 'string' && p.type.startsWith('tool-generate_artifact')
      )

      if (currentChatId && (textContent.trim() || message.parts.some(p => p.type === 'file') || imageOutputs.length > 0 || hasArtifactOutput)) {
        // Dedup: if onFinish double-fires for the same assistant message (error+retry or
        // a remount), don't persist/embed/render it twice (mirrors the user-save guard).
        if (lastSavedAssistantIdRef.current === message.id) return
        lastSavedAssistantIdRef.current = message.id
        // Persist empty content (not an '(image)' placeholder) for media-only turns:
        // loadMessages reconstructs the image/artifact, and an empty string renders no
        // stray text bubble on reload (the old placeholder leaked the literal "(image)").
        const result = await saveMessage(currentChatId, 'assistant', textContent)

        // Persist + inline-render images from the generate_image tool. The bytes are
        // already in storage (uploaded by the tool); link them to this message, then
        // optimistically append file parts so they show without a reload.
        if (result?.[0]?.id && imageOutputs.length > 0) {
          try {
            await saveGeneratedImage(result[0].id, currentChatId, imageOutputs.map(o => ({
              storagePath: o.storagePath, mediaType: o.mediaType, filename: o.filename ?? 'generated-image.png', fileSize: o.fileSize ?? 0,
            })))
          } catch (err) {
            console.error('[onFinish] Failed to save generated image:', err)
          }
          setMessages(prev => prev.map(m => m.id === message.id
            ? { ...m, parts: [...m.parts, ...imageOutputs.map(o => ({ type: 'file' as const, mediaType: o.mediaType, url: o.url }))] }
            : m))
        }

        // Save AI-generated images (file parts) to messageAttachments
        if (result?.[0]?.id) {
          const fileParts = message.parts.filter(
            (p): p is { type: 'file'; mediaType: string; url: string } =>
              p.type === 'file' && typeof (p as Record<string, unknown>).mediaType === 'string'
          )
          if (fileParts.length > 0) {
            try {
              await saveMessageAttachments(
                result[0].id,
                currentChatId,
                fileParts.map((p, i) => ({
                  filename: `generated-image-${i + 1}.png`,
                  mediaType: p.mediaType,
                  dataUrl: p.url,
                  fileSize: p.url.length,
                }))
              )
            } catch (err) {
              console.error('[onFinish] Failed to save image attachments:', err)
            }
          }
        }

        // Async embed the assistant message (best-effort)
        if (result?.[0]?.id && textContent.trim()) {
          fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: result[0].id,
              chatId: currentChatId,
              projectId: currentProjectId,
              content: textContent,
            }),
          }).catch(() => {}) // Embedding is best-effort
        }

        // Increment persona usage message count (best-effort)
        incrementUsageMessageCount(currentChatId).catch(() => {})

        // Check if summarization is needed
        const messageCount = await getMessageCount(currentChatId)
        if (messageCount > SUMMARIZATION_THRESHOLD) {
          triggerSummarization(currentChatId, messageCount).catch(() => {})
        }

        // Best-effort: throttled auto-memory suggestion pass (project chats only).
        // Monotonic gate — fire once per ~6 new messages, robust to count jumps.
        const lastSuggested = lastSuggestedAtRef.current.get(currentChatId) ?? 0
        if (currentProjectId && messageCount - lastSuggested >= MEMORY_SUGGEST_EVERY) {
          lastSuggestedAtRef.current.set(currentChatId, messageCount)
          getChatMessages(currentChatId, 12)
            .then(dbMessages =>
              fetch('/api/memory/suggest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectId: currentProjectId,
                  chatId: currentChatId,
                  messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
                }),
              })
            )
            .catch(() => {}) // suggestion pass is best-effort
        }

        // Auto-generate the chat title once there's a full exchange (best-effort).
        maybeGenerateTitle(currentChatId)

        // Best-effort: re-fetch artifacts so a freshly-generated one appears
        fetch(`/api/artifacts?chatId=${currentChatId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.artifacts) setArtifacts(data.artifacts) })
          .catch(() => {})
      }
    },
    // Refs and stable callbacks don't change identity — list them so React can
    // verify the deps array is exhaustive. The returned handler is recreated each
    // render (fine; it closes over current refs).
    [activeChatIdRef, activeProjectIdRef, lastSavedAssistantIdRef, lastSuggestedAtRef, setMessages, setArtifacts, triggerSummarization, maybeGenerateTitle]
  )
}
