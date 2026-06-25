import { useCallback, type RefObject } from 'react'
import { getChatMessages, updateChatTitle } from '@/app/actions'

type TitleChat = { id: number; title: string }

/**
 * Returns a stable `maybeGenerateTitle(chatId)` that auto-names a still-"New Chat" once it
 * has a full user+assistant exchange. Called both after a turn finishes and when such a
 * chat is opened, so a chat that missed titling during its live turn is backfilled on next
 * open. Best-effort: falls back to the first words of the user's message, and silently
 * ignores failures (retries on next open).
 *
 * Decoupled from page state via injected callbacks (all expected to be stable):
 * - `readChats` → the current chat list to check the title against
 * - `modelRef`  → the selected model (forwarded to the title route)
 * - `applyTitle(chatId, title)` → persist the new title into local state
 */
export function useChatTitle(opts: {
  readChats: () => TitleChat[]
  modelRef: RefObject<string>
  applyTitle: (chatId: number, title: string) => void
}) {
  const { readChats, modelRef, applyTitle } = opts
  return useCallback(
    async (chatId: number) => {
      const chat = readChats().find((c) => c.id === chatId)
      if (!chat || chat.title !== 'New Chat') return
      try {
        const dbMessages = await getChatMessages(chatId, 2)
        const userMsg = dbMessages.find((m) => m.role === 'user')
        const assistantMsg = dbMessages.find((m) => m.role === 'assistant')
        if (!userMsg || !assistantMsg) return // need a full exchange to title from
        const res = await fetch('/api/generate-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId,
            messages: [
              { role: 'user', content: (userMsg.content || '').slice(0, 500) },
              { role: 'assistant', content: (assistantMsg.content || '').slice(0, 500) },
            ],
            model: modelRef.current,
          }),
        })
        const data = res.ok ? await res.json().catch(() => null) : null
        // Prefer the model's title; if empty, fall back to the first few words of the
        // user's message so the chat never stays stuck on "New Chat".
        let title: string = (data?.title || '').trim()
        if (!title) {
          title = (userMsg.content || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 50)
        }
        if (!title) return
        await updateChatTitle(chatId, title)
        applyTitle(chatId, title)
      } catch {
        // best-effort
      }
    },
    [readChats, modelRef, applyTitle]
  )
}
