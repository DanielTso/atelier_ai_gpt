import { useCallback, type RefObject } from 'react'
import { getChatMessages } from '@/app/actions'

// Context management: auto-summarize older messages once a chat grows past the
// threshold, keeping the most recent MESSAGES_TO_KEEP in full.
export const SUMMARIZATION_THRESHOLD = 30
export const MESSAGES_TO_KEEP = 10
// Delta gate: past the threshold, fold at most once per this many NEW messages
// (the server window is now incremental, so each fold is cheap). The chat route
// sends `summary` + every message after the summary boundary (at least 20, at
// most 60 — `recentTail` in src/lib/contextBudget.ts), so a failed fold opens no
// gap unless the summary falls more than 60 messages behind; keeping this at
// 20-10 = 10 keeps that tail near its minimum. Imported by useChatPersistence's onFinish
// trigger, which advances its gate before the fold and rolls it back when the fold
// reports failure (audit B4), so a failed fold is retried on the next turn.
export const SUMMARIZE_EVERY = 10

/**
 * Returns a stable `triggerSummarization(chatId, messageCount)` that compresses all but
 * the last MESSAGES_TO_KEEP messages via `/api/summarize` (best-effort). Pinned server-side
 * to an internal Gemini model; the passed model ref is forwarded for routing parity.
 *
 * Resolves `false` when the fold was attempted and failed (a non-2xx or a network
 * error), `true` otherwise (folded, or nothing to fold). It rejects only if the
 * message lookup throws; the caller treats that as a failure too.
 */
export function useSummarization(selectedModelRef: RefObject<string>) {
  return useCallback(
    async (chatId: number, messageCount: number): Promise<boolean> => {
      if (messageCount <= SUMMARIZATION_THRESHOLD) return true

      // Summarize everything except the most recent MESSAGES_TO_KEEP.
      const messages = await getChatMessages(chatId)
      if (messages.length <= MESSAGES_TO_KEEP) return true

      const cutoffIndex = messages.length - MESSAGES_TO_KEEP
      const cutoffMessageId = messages[cutoffIndex - 1]?.id
      if (!cutoffMessageId) return true

      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, cutoffMessageId, model: selectedModelRef.current }),
        })
        if (!res.ok) console.warn(`[Summarization] fold failed (HTTP ${res.status}); will retry next turn`)
        return res.ok
      } catch (error) {
        console.error('[Summarization] Error:', error)
        return false
      }
    },
    [selectedModelRef]
  )
}
