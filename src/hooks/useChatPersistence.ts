import { useCallback, useMemo, useRef, type RefObject } from 'react'
import type { UIMessage } from 'ai'
import { toast } from 'sonner'
import {
  saveGeneratedImage,
  saveMessageAttachments,
  incrementUsageMessageCount,
  getMessageCount,
  getChatMessages,
  getAssistantReplyId,
} from '@/app/actions'
import { extractText } from '@/lib/messageParts'
import { extractGeneratedImageOutputs } from '@/lib/generatedImages'
import { readTurnMetadata, type TurnMetadata } from '@/lib/chatTurn'
import { SUMMARIZATION_THRESHOLD, SUMMARIZE_EVERY } from '@/hooks/useSummarization'
import type { AttachedImage } from '@/lib/fileAttachments'
import type { ArtifactSummary } from '@/types'

// How many new messages must accumulate in a project chat before triggering
// an auto-memory suggestion pass. Monotonic gate: fires once per MEMORY_SUGGEST_EVERY
// new messages, robust to count jumps and overlapping onFinish calls.
export const MEMORY_SUGGEST_EVERY = 6

// A stopped or failed turn has no finish chunk, so the reply's row id is looked up
// instead. The server writes that row as the connection drops, i.e. about when
// this runs — retry briefly rather than race it. Delays before each attempt, ms.
const REPLY_LOOKUP_DELAYS_MS = [0, 300, 900]

async function lookUpAssistantReplyId(chatId: number, userMessageDbId: number): Promise<number | null> {
  for (const delayMs of REPLY_LOOKUP_DELAYS_MS) {
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    try {
      const id = await getAssistantReplyId(chatId, userMessageDbId)
      if (id != null) return id
    } catch {
      return null
    }
  }
  return null
}

/** A turn the server has accepted, as reported by `useChatSessions` (start metadata). */
export interface StartedTurn {
  /** The raw metadata of the stream's first chunk. */
  metadata: unknown
  /** The transcript that was posted — the user's message is read from it. */
  messages?: UIMessage[]
}

/** One finished turn, as reported by `useChatSessions`. */
export interface FinishedTurn {
  /** The assistant reply (possibly partial or empty), carrying the server's turn metadata. */
  message: UIMessage
  /** The transcript the turn ended with — the user's message is read from it. */
  messages?: UIMessage[]
  /** The chat the turn was sent from. Used only when the server sent no metadata. */
  chatId?: number
  isAbort?: boolean
  isError?: boolean
  isDisconnect?: boolean
}

export interface UseChatPersistenceOpts {
  /** UI guard ONLY ("is this chat still on screen?") — never a source of ids. */
  activeChatIdRef: RefObject<number | null>
  /** Assistant message ids whose turn was already processed (one-shot guard). */
  processedTurnIdsRef: RefObject<Set<string>>
  lastSuggestedAtRef: RefObject<Map<number, number>>
  lastSummarizedCountRef: RefObject<Map<number, number>>
  /** Edit one chat's live transcript (no-op if that chat has no live session). */
  updateChatMessages: (chatId: number, updater: (messages: UIMessage[]) => UIMessage[]) => void
  setArtifacts: React.Dispatch<React.SetStateAction<ArtifactSummary[]>>
  /** Remove and return the images attached to `chatId`'s in-flight user message. */
  takePendingImages: (chatId: number) => AttachedImage[]
  triggerSummarization: (chatId: number, messageCount: number) => Promise<void>
  maybeGenerateTitle: (chatId: number) => void
}

/**
 * Returns the two turn handlers: everything the client does around a chat turn
 * that `/api/chat` has saved (the user's message up front, the assistant's reply
 * at the end).
 *
 * - `onTurnStart` — the server's start metadata arrived: save the user's image
 *   attachments and embed the user's message, right away. (Doing these only at
 *   the end would lose the attachments if the tab closed mid-reply.)
 * - `onTurnFinish` — the turn ended (finished, stopped or failed):
 *   generated-image linking → file-part attachments → embed → persona usage →
 *   summarize → memory-suggest → title → artifact-refetch. It also runs the
 *   user-message steps if the start never reported.
 *
 * The client no longer writes message TEXT at all. Every step that needs a chat,
 * a project or a message row takes its id from the server's turn metadata
 * (`readTurnMetadata`) — the chat the turn was SENT from and that chat's DB
 * project. Nothing here reads the active chat or project for an id: the user may
 * be anywhere by the time a turn starts or finishes (audit U1/F1/U3).
 *
 * All server actions and utility imports live INSIDE this module (not injected);
 * only the runtime state refs / callbacks are injected via opts so the hook is
 * decoupled from page state.
 */
export function useChatPersistence(opts: UseChatPersistenceOpts) {
  const {
    activeChatIdRef,
    processedTurnIdsRef,
    lastSuggestedAtRef,
    lastSummarizedCountRef,
    updateChatMessages,
    setArtifacts,
    takePendingImages,
    triggerSummarization,
    maybeGenerateTitle,
  } = opts

  // User rows whose steps already ran — at turn start, normally — so the finish
  // handler doesn't repeat them.
  const handledUserRowsRef = useRef<Set<number>>(new Set())

  // ---- The user's message (saved by the server before the model ran) ----
  const runUserMessageSteps = useCallback((turn: TurnMetadata, messages: UIMessage[] | undefined) => {
    const { chatId, projectId, userMessageDbId } = turn
    // Always claim this turn's pending images, even when they can't be saved —
    // left behind, they would attach to the chat's NEXT user message.
    const pendingImages = takePendingImages(chatId)
    if (userMessageDbId == null || handledUserRowsRef.current.has(userMessageDbId)) return
    handledUserRowsRef.current.add(userMessageDbId)

    // Save image attachments if any were pending
    if (pendingImages.length > 0) {
      saveMessageAttachments(
        userMessageDbId,
        chatId,
        pendingImages.map(img => ({
          filename: img.name,
          mediaType: img.mediaType,
          dataUrl: img.dataUrl,
          fileSize: img.size,
        }))
      ).catch(err => {
        console.error('[post-turn] Error saving attachments:', err)
        // The model saw the images, but they aren't stored: say so now rather
        // than letting them silently vanish on the next refresh (U4).
        toast.error("Couldn't save the attached images — they won't appear after a refresh")
      })
    }

    // Async embed the user message (best-effort)
    const lastUser = messages ? [...messages].reverse().find(m => m.role === 'user') : undefined
    const userText = lastUser ? extractText(lastUser.parts) : ''
    if (userText.trim()) {
      fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: userMessageDbId, chatId, projectId, content: userText }),
      }).catch(() => {}) // Embedding is best-effort
    }
  }, [takePendingImages])

  const onTurnStart = useCallback(({ metadata, messages }: StartedTurn) => {
    const turn = readTurnMetadata({ metadata })
    if (turn) runUserMessageSteps(turn, messages)
  }, [runUserMessageSteps])

  const onTurnFinish = useCallback(
    async ({ message, messages, chatId: originChatId, isAbort, isError, isDisconnect }: FinishedTurn) => {
      // One-shot per turn: if the same finished turn is reported twice (error+retry
      // or a remount), don't attach/embed/count it twice. A Set, not "the last id" —
      // turns from different chats can finish interleaved.
      if (processedTurnIdsRef.current.has(message.id)) return
      processedTurnIdsRef.current.add(message.id)

      const turn = readTurnMetadata(message)

      // No metadata: the request failed before the server began streaming (HTTP
      // error), so it reported no ids. There is nothing to attach anything to —
      // just drop the images that were waiting on this turn.
      if (!turn) {
        if (originChatId != null) takePendingImages(originChatId)
        return
      }
      const { chatId, projectId, userMessageDbId } = turn

      // Normally done at turn start; this covers a start that never reported.
      runUserMessageSteps(turn, messages)

      // ---- The assistant's reply (saved by the server at finish/abort) ----
      // Extract text content from message parts
      const textContent = extractText(message.parts)
      // Images produced by the generate_image tool (surfaced as tool-result parts).
      const imageOutputs = extractGeneratedImageOutputs(message.parts)
      // Artifacts produced by the generate_artifact tool surface as tool-result parts
      // (not file parts). Detect them so an artifact-only turn (no prose) still counts.
      const hasArtifactOutput = message.parts.some(
        p => typeof p.type === 'string' && p.type.startsWith('tool-generate_artifact')
      )
      // AI-generated images emitted as file parts (Gemini image models).
      const fileParts = message.parts.filter(
        (p): p is { type: 'file'; mediaType: string; url: string } =>
          p.type === 'file' && typeof (p as Record<string, unknown>).mediaType === 'string'
      )

      // Nothing came back (stopped before the first token, or an empty error turn):
      // no reply row exists and there is no exchange to count, summarize or title.
      if (!textContent.trim() && fileParts.length === 0 && imageOutputs.length === 0 && !hasArtifactOutput) return

      // The reply's row id arrives on the finish chunk. A stopped or failed turn
      // never gets one — but the server still saved the partial reply, so look it
      // up. After a CLEAN finish a null id is authoritative (no row was written).
      let assistantMessageDbId = turn.assistantMessageDbId
      if (assistantMessageDbId == null && userMessageDbId != null && (isAbort || isError || isDisconnect)) {
        assistantMessageDbId = await lookUpAssistantReplyId(chatId, userMessageDbId)
      }

      if (assistantMessageDbId != null) {
        // Persist + inline-render images from the generate_image tool. The bytes are
        // already in storage (uploaded by the tool); link them to the reply's row, then
        // optimistically append file parts so they show without a reload.
        if (imageOutputs.length > 0) {
          try {
            await saveGeneratedImage(assistantMessageDbId, chatId, imageOutputs.map(o => ({
              storagePath: o.storagePath, mediaType: o.mediaType, filename: o.filename ?? 'generated-image.png', fileSize: o.fileSize ?? 0,
            })))
          } catch (err) {
            console.error('[post-turn] Failed to save generated image:', err)
          }
          updateChatMessages(chatId, prev => prev.map(m => m.id === message.id
            ? { ...m, parts: [...m.parts, ...imageOutputs.map(o => ({ type: 'file' as const, mediaType: o.mediaType, url: o.url }))] }
            : m))
        }

        // Save AI-generated images (file parts) to messageAttachments
        if (fileParts.length > 0) {
          try {
            await saveMessageAttachments(
              assistantMessageDbId,
              chatId,
              fileParts.map((p, i) => ({
                filename: `generated-image-${i + 1}.png`,
                mediaType: p.mediaType,
                dataUrl: p.url,
                fileSize: p.url.length,
              }))
            )
          } catch (err) {
            console.error('[post-turn] Failed to save image attachments:', err)
            toast.error("Couldn't save the generated images — they won't appear after a refresh")
          }
        }

        // Async embed the assistant message (best-effort)
        if (textContent.trim()) {
          fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: assistantMessageDbId, chatId, projectId, content: textContent }),
          }).catch(() => {}) // Embedding is best-effort
        }
      }

      // ---- The chat ----
      // Increment persona usage message count (best-effort)
      incrementUsageMessageCount(chatId).catch(() => {})

      // Check if summarization is needed. Monotonic delta-gate (mirrors the
      // auto-memory gate below): past the threshold, fold at most once per
      // SUMMARIZE_EVERY new messages instead of on every turn.
      const messageCount = await getMessageCount(chatId)
      const lastSummarized = lastSummarizedCountRef.current.get(chatId) ?? 0
      if (messageCount > SUMMARIZATION_THRESHOLD && messageCount - lastSummarized >= SUMMARIZE_EVERY) {
        lastSummarizedCountRef.current.set(chatId, messageCount)
        triggerSummarization(chatId, messageCount).catch(() => {})
      }

      // Best-effort: throttled auto-memory suggestion pass (project chats only —
      // the chat's DB project, from the metadata). Monotonic gate — fire once per
      // ~6 new messages, robust to count jumps.
      const lastSuggested = lastSuggestedAtRef.current.get(chatId) ?? 0
      if (projectId && messageCount - lastSuggested >= MEMORY_SUGGEST_EVERY) {
        lastSuggestedAtRef.current.set(chatId, messageCount)
        getChatMessages(chatId, 12)
          .then(dbMessages =>
            fetch('/api/memory/suggest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId,
                chatId,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
              }),
            })
          )
          .catch(() => {}) // suggestion pass is best-effort
      }

      // Auto-generate the chat title once there's a full exchange (best-effort).
      maybeGenerateTitle(chatId)

      // Best-effort: re-fetch artifacts so a freshly-generated one appears. Gated on
      // the turn actually producing one — loadMessages already fetches on chat open,
      // so on artifact-less turns this round-trip (rows + a signed URL per artifact)
      // was a pure no-op. The artifact list on screen belongs to the OPEN chat: a
      // turn that finished in the background must not replace it (opening that chat
      // loads its artifacts anyway).
      if (hasArtifactOutput && activeChatIdRef.current === chatId) {
        fetch(`/api/artifacts?chatId=${chatId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.artifacts && activeChatIdRef.current === chatId) setArtifacts(data.artifacts)
          })
          .catch(() => {})
      }
    },
    // Refs and stable callbacks don't change identity — list them so React can
    // verify the deps array is exhaustive. The returned handler is recreated each
    // render (fine; it closes over current refs).
    [activeChatIdRef, processedTurnIdsRef, lastSuggestedAtRef, lastSummarizedCountRef, updateChatMessages, setArtifacts, takePendingImages, triggerSummarization, maybeGenerateTitle, runUserMessageSteps]
  )

  return useMemo(() => ({ onTurnStart, onTurnFinish }), [onTurnStart, onTurnFinish])
}
