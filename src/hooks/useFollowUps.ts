'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { extractText } from '@/lib/messageParts'

/**
 * Best-effort follow-up suggestions: when a response finishes (status
 * streaming→ready with an assistant message), fetch up to 3 clickable
 * next-step chips from the housekeeping model. Cleared on chat switch and the
 * moment a new turn starts. Failures are silent — no chips, never an error.
 */
export function useFollowUps({ messages, status, activeChatId }: {
  messages: UIMessage[]
  status: string
  activeChatId: number | null
}) {
  const [followUps, setFollowUps] = useState<string[]>([])
  const prevStatusRef = useRef(status)
  const clearFollowUps = useCallback(() => setFollowUps([]), [])

  useEffect(() => { setFollowUps([]) }, [activeChatId])

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (status === 'submitted' || status === 'streaming') {
      setFollowUps([])
      return
    }
    if (prev !== 'streaming' || status !== 'ready') return

    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const assistantText = extractText(last.parts).trim()
    if (!assistantText) return
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    const userText = lastUser ? extractText(lastUser.parts).trim() : ''

    let cancelled = false
    fetch('/api/suggest-followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          ...(userText ? [{ role: 'user' as const, content: userText.slice(0, 1000) }] : []),
          { role: 'assistant' as const, content: assistantText.slice(0, 2000) },
        ],
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !Array.isArray(data?.suggestions)) return
        setFollowUps(data.suggestions.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3))
      })
      .catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [status, messages])

  return { followUps, clearFollowUps }
}
