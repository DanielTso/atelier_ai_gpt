import { useCallback, type RefObject } from 'react'
import { toast } from 'sonner'
import { getChatMessages } from '@/app/actions'

// Context management: auto-summarize older messages once a chat grows past the
// threshold, keeping the most recent MESSAGES_TO_KEEP in full.
export const SUMMARIZATION_THRESHOLD = 30
export const MESSAGES_TO_KEEP = 10

/**
 * Returns a stable `triggerSummarization(chatId, messageCount)` that compresses all but
 * the last MESSAGES_TO_KEEP messages via `/api/summarize` (best-effort). Pinned server-side
 * to an internal Gemini model; the passed model ref is forwarded for routing parity.
 */
export function useSummarization(selectedModelRef: RefObject<string>) {
  return useCallback(
    async (chatId: number, messageCount: number) => {
      if (messageCount <= SUMMARIZATION_THRESHOLD) return

      // Summarize everything except the most recent MESSAGES_TO_KEEP.
      const messages = await getChatMessages(chatId)
      if (messages.length <= MESSAGES_TO_KEEP) return

      const cutoffIndex = messages.length - MESSAGES_TO_KEEP
      const cutoffMessageId = messages[cutoffIndex - 1]?.id
      if (!cutoffMessageId) return

      try {
        const response = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, cutoffMessageId, model: selectedModelRef.current }),
        })
        if (response.ok) {
          await response.json()
          toast.success('Conversation summarized for better context management')
        }
      } catch (error) {
        console.error('[Summarization] Error:', error)
      }
    },
    [selectedModelRef]
  )
}
