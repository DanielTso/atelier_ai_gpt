import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { Chat, useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  type ChatOnFinishCallback,
  type ChatTransport,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'

// One AI SDK `Chat` instance (store + in-flight request) per DB chat.
//
// The app used to run every chat through a single `useChat` store. A reply still
// streaming when the user left its chat kept writing into that one store — so it
// was saved under whichever chat was active by then (or not at all), and leaked
// into the next chat's transcript and request (audit U1/F1). With a session per
// chat, a stream can only ever write to the store of the chat that sent it:
//
// - Switching chats swaps which session the UI is subscribed to. It never calls
//   `stop()` — the turn keeps running, and the server saves it to its own chat.
// - A request's `chatId` is derived from the session that owns the messages being
//   posted, not from "the active chat" at send time.
// - Coming back to a chat that is still streaming shows the live reply again.
//
// (Passing `useChat({ id })` alone is not enough: the hook's `sendMessage` belongs
// to the instance of the LAST render, so a chat created and sent to in one handler
// would still post through the previous chat's store. Holding the instances here
// lets a send name its target chat directly.)

/** Session key for "no chat" (Home, a project landing, a not-yet-created compose). */
export const HOME_SESSION_KEY = 'home'

export function chatSessionKey(chatId: number | null): string {
  return chatId == null ? HOME_SESSION_KEY : `chat-${chatId}`
}

export function chatIdFromSessionKey(key: string): number | null {
  const match = /^chat-(\d+)$/.exec(key)
  return match ? Number(match[1]) : null
}

/**
 * `/api/chat` sends the turn's ids as metadata on the stream's first chunk, and the
 * SDK reacts to any metadata by putting the reply in the store — before it has any
 * content. Until the first real part (text, reasoning, a tool call) it holds
 * nothing, or only `step-start` markers. Without that metadata the SDK would not
 * have created the message yet, so such a message is treated as "not there": it is
 * hidden from the transcript while the turn runs and removed if the turn ends
 * without ever producing anything.
 */
export function isPendingReply(message: UIMessage | undefined): boolean {
  return message?.role === 'assistant' && message.parts.every(part => part.type === 'step-start')
}

type ChatFinish = Parameters<ChatOnFinishCallback<UIMessage>>[0]

/** A finished turn (complete, stopped, or failed) plus the chat it was SENT from. */
export type TurnFinish = ChatFinish & { chatId: number }

/**
 * The server accepted a turn: the stream's first chunk arrived, carrying the turn
 * metadata (the saved user row's id among it). Reported for background chats too.
 */
export type TurnStart = {
  /** The chat the turn was sent from. */
  chatId: number
  /** The raw `messageMetadata` of the start chunk (parse with `readTurnMetadata`). */
  metadata: unknown
  /** The transcript that was posted — its last message is the user's. */
  messages: UIMessage[]
}

type SessionHandlers = {
  /** Extra `/api/chat` body fields (model, effort, …), read when a message is sent. */
  getRequestBody: () => Record<string, unknown>
  /** Called once per turn, as soon as the server's start metadata arrives. */
  onTurnStart?: (turn: TurnStart) => void
  /** Called once per turn, for the chat it was sent from — whatever is active by then. */
  onTurnFinish: (turn: TurnFinish) => void | Promise<void>
}

export interface UseChatSessionsOpts extends SessionHandlers {
  /** The chat on screen; null on Home / project landing / tab views. */
  activeChatId: number | null
}

/**
 * The sessions themselves: a plain (non-React) store, one per mounted app. React
 * subscribes to the active session through `useChat({ chat })`; everything else —
 * sends, finishes, background streams — happens here, outside render.
 */
class ChatSessionRegistry {
  private readonly sessions = new Map<string, Chat<UIMessage>>()
  // Keys with a send under way, from the moment it is requested. The SDK only
  // flips a session's status to 'submitted' a microtask after sendMessage() is
  // called; this closes that gap so a just-created session can never be pruned.
  private readonly sending = new Set<string>()
  private activeKey = HOME_SESSION_KEY
  private handlers: SessionHandlers = { getRequestBody: () => ({}), onTurnFinish: () => {} }

  private readonly http = new DefaultChatTransport<UIMessage>({
    api: '/api/chat',
    body: () => this.handlers.getRequestBody(),
    // `id` is the session key, i.e. the chat whose store `messages` came from.
    prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
      body: { ...body, id, messages, trigger, messageId, chatId: chatIdFromSessionKey(id) },
    }),
  })

  // The HTTP transport, plus a tap on each response stream that reports the start
  // metadata the moment it arrives — for any session, on screen or not. The SDK
  // has no "turn started" callback, and waiting for onFinish would leave the
  // user's attachments unsaved for the whole length of a reply.
  private readonly transport: ChatTransport<UIMessage> = {
    sendMessages: async (options) => {
      const stream = await this.http.sendMessages(options)
      const chatId = chatIdFromSessionKey(options.chatId)
      if (chatId == null) return stream
      let reported = false
      return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform: (chunk, controller) => {
          if (!reported && chunk.type === 'start' && chunk.messageMetadata != null) {
            reported = true
            try {
              this.handlers.onTurnStart?.({ chatId, metadata: chunk.messageMetadata, messages: options.messages })
            } catch (err) {
              console.error('[chat] turn-start steps failed:', err)
            }
          }
          controller.enqueue(chunk)
        },
      }))
    },
    reconnectToStream: (options) => this.http.reconnectToStream(options),
  }

  /** Point the sessions at the latest callbacks (they are called long after render). */
  bind(handlers: SessionHandlers) {
    this.handlers = handlers
  }

  /**
   * Mark which chat is on screen, and drop every OTHER session that has no turn in
   * flight — reopening such a chat starts from the DB. Busy sessions are kept:
   * they are live streams.
   */
  activate(activeKey: string) {
    this.activeKey = activeKey
    for (const key of [...this.sessions.keys()]) {
      if (key !== activeKey && !this.isBusy(key)) this.sessions.delete(key)
    }
  }

  /** True while the chat behind `key` has a turn in flight. */
  isBusy(key: string): boolean {
    if (this.sending.has(key)) return true
    const status = this.sessions.get(key)?.status
    return status === 'submitted' || status === 'streaming'
  }

  /** Send a user message through `chatId`'s own session. Resolves when the turn ends. */
  async send(chatId: number, message: { text: string; files?: FileUIPart[] }): Promise<void> {
    const key = chatSessionKey(chatId)
    const session = this.session(chatId)
    this.sending.add(key)
    try {
      await session.sendMessage(message)
    } finally {
      this.sending.delete(key)
    }
  }

  /** The session for a chat, created on first use with an empty transcript. */
  session(chatId: number | null): Chat<UIMessage> {
    const key = chatSessionKey(chatId)
    const existing = this.sessions.get(key)
    if (existing) return existing
    const session: Chat<UIMessage> = new Chat<UIMessage>({
      id: key,
      transport: this.transport,
      onFinish: (finish) => {
        // The turn produced nothing (stopped or failed before the first part): the
        // content-less reply the start metadata created must not stay behind as an
        // empty bubble. The post-turn handler still gets it — it carries the ids.
        if (isPendingReply(finish.message)) {
          session.messages = session.messages.filter(m => m.id !== finish.message.id)
        }
        // A turn that ended while its chat was in the background: drop the
        // session. The server has saved the turn, and reopening the chat loads it
        // from the DB — a retained copy would only go stale.
        if (this.activeKey !== key && this.sessions.get(key) === session) this.sessions.delete(key)
        if (chatId == null) return
        try {
          Promise.resolve(this.handlers.onTurnFinish({ ...finish, chatId })).catch(err => {
            console.error('[chat] post-turn steps failed:', err)
          })
        } catch (err) {
          console.error('[chat] post-turn steps failed:', err)
        }
      },
    })
    this.sessions.set(key, session)
    return session
  }

  /** The session for a chat only if one exists (never creates). */
  peek(chatId: number): Chat<UIMessage> | undefined {
    return this.sessions.get(chatSessionKey(chatId))
  }
}

export function useChatSessions({ activeChatId, getRequestBody, onTurnStart, onTurnFinish }: UseChatSessionsOpts) {
  const [registry] = useState(() => new ChatSessionRegistry())
  const activeKey = chatSessionKey(activeChatId)

  // Layout effects, so the registry is current before any stream event can run.
  useLayoutEffect(() => {
    registry.bind({ getRequestBody, onTurnStart, onTurnFinish })
  }, [registry, getRequestBody, onTurnStart, onTurnFinish])
  useLayoutEffect(() => {
    registry.activate(activeKey)
  }, [registry, activeKey])

  const { messages: storeMessages, setMessages, status, error, stop } = useChat({ chat: registry.session(activeChatId) })

  // The transcript as the UI should see it: without a reply that has no content yet
  // (see isPendingReply). The message appears with its first real part, exactly as
  // it did before the server sent start metadata — so the staged status line, the
  // streaming cursor and "last message" checks all keep their meaning.
  const replyPending = isPendingReply(storeMessages[storeMessages.length - 1])
  const messages = useMemo(
    () => (replyPending ? storeMessages.slice(0, -1) : storeMessages),
    [storeMessages, replyPending],
  )

  /** Send through `chatId`'s own session — the only way a message is sent. */
  const sendToChat = useCallback(
    (chatId: number, message: { text: string; files?: FileUIPart[] }) => registry.send(chatId, message),
    [registry],
  )

  /** True while `chatId` has a turn in flight (possibly in the background). */
  const isChatBusy = useCallback((chatId: number) => registry.isBusy(chatSessionKey(chatId)), [registry])

  /** Edit `chatId`'s live transcript, if it has one. A dropped session is a no-op. */
  const updateChatMessages = useCallback((chatId: number, updater: (messages: UIMessage[]) => UIMessage[]) => {
    const session = registry.peek(chatId)
    if (session) session.messages = updater(session.messages)
  }, [registry])

  return {
    /** The ACTIVE chat's transcript, status and error. */
    messages,
    status,
    error,
    /** Replace the ACTIVE chat's transcript (history load). */
    setMessages,
    /** Stop the ACTIVE chat's turn. Background turns are never stopped. */
    stop,
    sendToChat,
    isChatBusy,
    updateChatMessages,
  }
}
