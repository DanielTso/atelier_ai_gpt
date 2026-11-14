// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { useChatSessions, chatSessionKey, chatIdFromSessionKey, type TurnFinish, type TurnStart } from '@/hooks/useChatSessions'
import { extractText } from '@/lib/messageParts'

// ----------------------------------------------------------------
// A fake /api/chat. Every POST gets its own SSE stream that the test drives
// chunk by chunk, so "mid-stream" is a state the test holds open, not a timer.
// ----------------------------------------------------------------

type PostedBody = { chatId: number | null; model?: string; messages: UIMessage[]; [key: string]: unknown }
type FakeCall = {
  body: PostedBody
  signal: AbortSignal | undefined
  send: (...chunks: Array<Record<string, unknown>>) => void
  close: () => void
}

let calls: FakeCall[] = []

function installFakeChatApi() {
  const encoder = new TextEncoder()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    const signal = init?.signal ?? undefined
    // A real fetch body errors when its request is aborted (the Stop button).
    signal?.addEventListener('abort', () => {
      try { controller.error(new DOMException('This operation was aborted', 'AbortError')) } catch { /* closed */ }
    })
    calls.push({
      body: JSON.parse(String(init?.body)) as PostedBody,
      signal,
      send: (...chunks) => {
        for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      },
      close: () => controller.close(),
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }))
}

const turnMeta = (chatId: number, assistantMessageDbId: number | null = null) => ({
  chatId, projectId: null, userMessageDbId: chatId * 100, assistantMessageDbId,
})
const startChunks = (chatId: number) => [
  { type: 'start', messageMetadata: turnMeta(chatId) },
  { type: 'start-step' },
  { type: 'text-start', id: 't1' },
]
const delta = (text: string) => ({ type: 'text-delta', id: 't1', delta: text })
const finishChunks = (chatId: number) => [
  { type: 'text-end', id: 't1' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop', messageMetadata: turnMeta(chatId, chatId * 100 + 1) },
]

/** Let the SDK's stream pump + React flush. */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 15)) })

function setup(initialChatId: number | null) {
  const onTurnFinish = vi.fn<(turn: TurnFinish) => void>()
  const onTurnStart = vi.fn<(turn: TurnStart) => void>()
  const requestBody = { model: 'claude-opus-4-8', effort: 'high', grounded: false, excludedDocumentIds: [] as number[] }
  const hook = renderHook(
    ({ activeChatId }: { activeChatId: number | null }) =>
      useChatSessions({ activeChatId, getRequestBody: () => requestBody, onTurnStart, onTurnFinish }),
    { initialProps: { activeChatId: initialChatId } },
  )
  const send = async (chatId: number, text: string) => {
    const before = calls.length
    await act(async () => { void hook.result.current.sendToChat(chatId, { text }) })
    await waitFor(() => expect(calls.length).toBe(before + 1))
    return calls[before]
  }
  const texts = () => hook.result.current.messages.map(m => `${m.role}:${extractText(m.parts)}`)
  return { ...hook, onTurnStart, onTurnFinish, requestBody, send, texts }
}

beforeEach(() => {
  calls = []
  installFakeChatApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chat session keys', () => {
  it('round-trips a chat id and maps "no chat" to the home session', () => {
    expect(chatSessionKey(12)).toBe('chat-12')
    expect(chatIdFromSessionKey('chat-12')).toBe(12)
    expect(chatSessionKey(null)).toBe('home')
    expect(chatIdFromSessionKey('home')).toBeNull()
    expect(chatIdFromSessionKey('chat-abc')).toBeNull()
  })
})

describe('useChatSessions', () => {
  it('next-chat-request-excludes-orphan: a reply still streaming in chat A never reaches Home or the next chat', async () => {
    const h = setup(1)

    // Chat A: send, and hold the reply open mid-stream.
    const callA = await h.send(1, 'Question A')
    expect(callA.body.chatId).toBe(1)
    act(() => callA.send(...startChunks(1), delta('Answer A so far')))
    await waitFor(() => expect(h.texts()).toEqual(['user:Question A', 'assistant:Answer A so far']))
    expect(h.result.current.status).toBe('streaming')

    // Switch to Home mid-stream (New chat / Projects / Back / archive all do this).
    h.rerender({ activeChatId: null })
    expect(h.result.current.messages).toEqual([])
    expect(h.result.current.status).toBe('ready')
    // The stream is NOT stopped by the switch (owner decision 1).
    expect(callA.signal?.aborted).toBe(false)

    // A keeps streaming; the Home store must not receive a single chunk of it.
    act(() => callA.send(delta(' and more')))
    await settle()
    expect(h.result.current.messages).toEqual([])

    // First send from Home → deferred-create of chat 2, sent through chat 2's own store.
    const callB = await h.send(2, 'Question B')
    h.rerender({ activeChatId: 2 })
    expect(callB.body.chatId).toBe(2)
    expect(callB.body.messages.map(m => m.role)).toEqual(['user'])
    expect(JSON.stringify(callB.body.messages)).not.toContain('Answer A')
    expect(h.texts()).toEqual(['user:Question B'])

    // A finishes in the background: its finish is reported for chat 1, with the
    // whole reply, and chat 2's transcript is untouched.
    act(() => { callA.send(...finishChunks(1)); callA.close() })
    await waitFor(() => expect(h.onTurnFinish).toHaveBeenCalledOnce())
    const turn = h.onTurnFinish.mock.calls[0][0]
    expect(turn.chatId).toBe(1)
    expect(extractText(turn.message.parts)).toBe('Answer A so far and more')
    expect(turn.message.metadata).toEqual(turnMeta(1, 101))
    expect(turn.isAbort).toBe(false)
    expect(h.texts()).toEqual(['user:Question B'])
  })

  it('binds the request chatId to the session that owns the messages, not to whatever is active', async () => {
    const h = setup(1)
    // The user is looking at chat 1, but the send targets chat 5 (deferred-create
    // sets the active chat and sends in the same tick, before React re-renders).
    const call = await h.send(5, 'Hello five')
    expect(call.body).toMatchObject({ chatId: 5, model: 'claude-opus-4-8', effort: 'high', grounded: false, excludedDocumentIds: [] })
    expect(call.body.messages.map(m => extractText(m.parts))).toEqual(['Hello five'])
    // Chat 1's store never saw it.
    expect(h.result.current.messages).toEqual([])
  })

  it('keeps a session whose send was just requested, even before the SDK marks it submitted', async () => {
    const h = setup(1)
    // sendMessage() only flips the status a microtask later. A navigation that
    // commits inside that gap must not prune the session the send is using — the
    // reply would otherwise stream into a store nothing can reach.
    act(() => {
      void h.result.current.sendToChat(5, { text: 'Hello five' })
      expect(h.result.current.isChatBusy(5)).toBe(true)
    })
    h.rerender({ activeChatId: 2 })
    await waitFor(() => expect(calls.length).toBe(1))

    h.rerender({ activeChatId: 5 })
    expect(h.texts()).toEqual(['user:Hello five'])
    act(() => { calls[0].send(...startChunks(5), delta('Hi'), ...finishChunks(5)); calls[0].close() })
    await waitFor(() => expect(h.texts()).toEqual(['user:Hello five', 'assistant:Hi']))
    expect(h.result.current.isChatBusy(5)).toBe(false)
  })

  it('keeps the content-less reply created by the start metadata out of the transcript until its first real part', async () => {
    const h = setup(1)
    const call = await h.send(1, 'Question')

    // Start metadata + a step marker: the SDK has put the reply in the store, but
    // there is nothing to show yet. The UI must still see "user message last".
    act(() => call.send({ type: 'start', messageMetadata: turnMeta(1) }, { type: 'start-step' }))
    await waitFor(() => expect(h.result.current.status).toBe('streaming'))
    await settle()
    expect(h.texts()).toEqual(['user:Question'])

    // First real part → the reply appears, carrying the metadata.
    act(() => call.send({ type: 'text-start', id: 't1' }, delta('Hi')))
    await waitFor(() => expect(h.texts()).toEqual(['user:Question', 'assistant:Hi']))
    expect(h.result.current.messages[1].metadata).toEqual(turnMeta(1))
  })

  it('removes a reply that never got any content when its turn is stopped, and still reports the turn', async () => {
    const h = setup(1)
    const call = await h.send(1, 'Question')
    act(() => call.send({ type: 'start', messageMetadata: turnMeta(1) }, { type: 'start-step' }))
    await waitFor(() => expect(h.result.current.status).toBe('streaming'))

    await act(async () => { await h.result.current.stop() })
    await waitFor(() => expect(h.result.current.status).toBe('ready'))

    // No empty assistant bubble is left behind…
    expect(h.result.current.messages.map(m => m.role)).toEqual(['user'])
    // …but the post-turn handler still learns the server's ids for the user row.
    await waitFor(() => expect(h.onTurnFinish).toHaveBeenCalledOnce())
    const turn = h.onTurnFinish.mock.calls[0][0]
    expect(turn.isAbort).toBe(true)
    expect(turn.message.metadata).toEqual(turnMeta(1))
    expect(turn.messages.map(m => m.role)).toEqual(['user', 'assistant'])

    // The next send posts no trace of it.
    const next = await h.send(1, 'Again')
    expect(next.body.messages.map(m => m.role)).toEqual(['user', 'user'])
  })

  it('reports the start of a turn once, with its chat and the server metadata — also for a chat in the background', async () => {
    const h = setup(1)
    const call = await h.send(1, 'Question A')
    h.rerender({ activeChatId: null })
    expect(h.onTurnStart).not.toHaveBeenCalled()

    act(() => call.send(...startChunks(1), delta('Answer')))
    await waitFor(() => expect(h.onTurnStart).toHaveBeenCalledOnce())
    const start = h.onTurnStart.mock.calls[0][0]
    expect(start.chatId).toBe(1)
    expect(start.metadata).toEqual(turnMeta(1))
    expect(start.messages.map(m => `${m.role}:${extractText(m.parts)}`)).toEqual(['user:Question A'])

    // The finish chunk's metadata is not a second "start".
    act(() => { call.send(...finishChunks(1)); call.close() })
    await waitFor(() => expect(h.onTurnFinish).toHaveBeenCalledOnce())
    expect(h.onTurnStart).toHaveBeenCalledOnce()
  })

  it('reports no start when the server sends no metadata', async () => {
    const h = setup(1)
    const call = await h.send(1, 'Question')
    act(() => { call.send({ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 't1' }, delta('Hi'), { type: 'text-end', id: 't1' }, { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' }); call.close() })
    await waitFor(() => expect(h.onTurnFinish).toHaveBeenCalledOnce())
    expect(h.onTurnStart).not.toHaveBeenCalled()
    expect(h.texts()).toEqual(['user:Question', 'assistant:Hi'])
  })

  it('reads the extra request body at send time', async () => {
    const h = setup(1)
    h.requestBody.model = 'claude-haiku-4-5'
    const call = await h.send(1, 'Hi')
    expect(call.body.model).toBe('claude-haiku-4-5')
  })

  it('shows the live transcript again when the user returns to a chat that is still streaming', async () => {
    const h = setup(1)
    const callA = await h.send(1, 'Question A')
    act(() => callA.send(...startChunks(1), delta('Part one')))
    await waitFor(() => expect(h.texts()).toEqual(['user:Question A', 'assistant:Part one']))

    h.rerender({ activeChatId: 2 })
    expect(h.result.current.messages).toEqual([])
    expect(h.result.current.isChatBusy(1)).toBe(true)
    expect(h.result.current.isChatBusy(2)).toBe(false)
    act(() => callA.send(delta(', part two')))
    await settle()

    h.rerender({ activeChatId: 1 })
    expect(h.texts()).toEqual(['user:Question A', 'assistant:Part one, part two'])
    expect(h.result.current.status).toBe('streaming')

    // …and it keeps updating live once it is active again.
    act(() => { callA.send(delta('.'), ...finishChunks(1)); callA.close() })
    await waitFor(() => expect(h.result.current.status).toBe('ready'))
    expect(h.texts()).toEqual(['user:Question A', 'assistant:Part one, part two.'])
    // Finished while active → the session (and its transcript) is kept.
    expect(h.onTurnFinish).toHaveBeenCalledOnce()
  })

  it('drops a background session once its turn finishes — reopening starts from an empty store', async () => {
    const h = setup(1)
    const callA = await h.send(1, 'Question A')
    act(() => callA.send(...startChunks(1), delta('Answer')))
    await waitFor(() => expect(h.result.current.status).toBe('streaming'))

    h.rerender({ activeChatId: null })
    act(() => { callA.send(...finishChunks(1)); callA.close() })
    await waitFor(() => expect(h.onTurnFinish).toHaveBeenCalledOnce())
    expect(h.result.current.isChatBusy(1)).toBe(false)

    // The DB is the source of truth for a finished background chat: the page
    // reloads it, so the session must not hand back a stale transcript.
    h.rerender({ activeChatId: 1 })
    expect(h.result.current.messages).toEqual([])
  })

  it('drops an idle session when the user leaves it', async () => {
    const h = setup(1)
    act(() => h.result.current.setMessages([{ id: '10', role: 'user', parts: [{ type: 'text', text: 'loaded from the DB' }] }]))
    expect(h.texts()).toEqual(['user:loaded from the DB'])

    h.rerender({ activeChatId: 2 })
    await settle()
    h.rerender({ activeChatId: 1 })
    expect(h.result.current.messages).toEqual([])
  })

  it('Stop aborts only the active chat', async () => {
    const h = setup(1)
    const callA = await h.send(1, 'Question A')
    act(() => callA.send(...startChunks(1), delta('A')))
    await waitFor(() => expect(h.result.current.status).toBe('streaming'))

    h.rerender({ activeChatId: 2 })
    const callB = await h.send(2, 'Question B')
    act(() => callB.send(...startChunks(2), delta('B')))
    await waitFor(() => expect(h.result.current.status).toBe('streaming'))

    await act(async () => { await h.result.current.stop() })
    await waitFor(() => expect(h.result.current.status).toBe('ready'))
    expect(callB.signal?.aborted).toBe(true)
    expect(callA.signal?.aborted).toBe(false)

    // The stopped turn still reports its finish (with what streamed) for chat 2.
    await waitFor(() => expect(h.onTurnFinish).toHaveBeenCalledOnce())
    const turn = h.onTurnFinish.mock.calls[0][0]
    expect(turn.chatId).toBe(2)
    expect(turn.isAbort).toBe(true)
    expect(turn.message.metadata).toEqual(turnMeta(2))
  })

  it('updateChatMessages edits one chat\'s live store and ignores chats with no session', async () => {
    const h = setup(1)
    const callA = await h.send(1, 'Question A')
    act(() => callA.send(...startChunks(1), delta('A')))
    await waitFor(() => expect(h.texts()).toEqual(['user:Question A', 'assistant:A']))

    act(() => h.result.current.updateChatMessages(1, prev => prev.map(m =>
      m.role === 'assistant' ? { ...m, parts: [...m.parts, { type: 'text' as const, text: '+edited' }] } : m)))
    expect(h.texts()).toEqual(['user:Question A', 'assistant:A+edited'])

    const updater = vi.fn((prev: UIMessage[]) => prev)
    act(() => h.result.current.updateChatMessages(99, updater))
    expect(updater).not.toHaveBeenCalled()
  })
})
