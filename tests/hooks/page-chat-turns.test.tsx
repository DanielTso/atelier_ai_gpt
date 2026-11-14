// @vitest-environment jsdom
//
// Page-level proof of audit U1 / Review Focus 1: the real <Home /> wired to the
// real chat sessions, post-turn pipeline and AI SDK client — only the server
// (actions + fetch) is faked. "Leave a chat mid-stream, then send from Home":
// the reply keeps streaming, is never shown on or posted from the next chat, and
// its post-turn steps run for the chat it was sent from.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

// ---- server actions -------------------------------------------------------
// Every action resolves to a harmless default unless given a behavior below.
const actionMocks: Record<string, ReturnType<typeof vi.fn>> = {}
const action = (name: string) => (actionMocks[name] ??= vi.fn(async () => undefined))

vi.mock('@/app/actions', () =>
  new Proxy({} as Record<string, unknown>, {
    has: (_t, key) => key !== 'then',
    get: (_t, key) => (typeof key === 'string' && key !== 'then' ? action(key) : undefined),
  }),
)

import Home from '@/app/page'
import type { Model } from '@/types'

// ---- fetch ----------------------------------------------------------------
type ChatCall = {
  body: { chatId: number | null; messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> }
  signal: AbortSignal | undefined
  send: (...chunks: Array<Record<string, unknown>>) => void
  close: () => void
}
let chatCalls: ChatCall[] = []
let otherCalls: Array<{ url: string; body: Record<string, unknown> | null }> = []

const MODEL: Model = {
  name: 'Claude Opus 4.8',
  model: 'claude-opus-4-8',
  digest: '',
  provider: 'anthropic',
  family: 'opus',
  capabilities: {
    supportsEffort: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsThinking: true,
    supportsImageInput: true,
    supportsStructuredOutputs: true,
  },
  pricing: { inputPerMTok: 15, outputPerMTok: 75, estimated: false },
}

function installFetch() {
  const encoder = new TextEncoder()
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/chat') {
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
      chatCalls.push({
        body: JSON.parse(String(init?.body)),
        signal: init?.signal ?? undefined,
        send: (...chunks) => { for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`)) },
        close: () => controller.close(),
      })
      return new Response(stream, { status: 200 })
    }
    otherCalls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
    if (url.startsWith('/api/models')) {
      return json({ models: [MODEL] })
    }
    if (url.startsWith('/api/artifacts')) return json({ artifacts: [] })
    if (url.startsWith('/api/suggest-followups')) return json({ suggestions: [] })
    return json({})
  }))
}

const turnMeta = (chatId: number, assistantMessageDbId: number | null = null) => ({
  chatId, projectId: null, userMessageDbId: chatId * 100, assistantMessageDbId,
})
const delta = (text: string) => ({ type: 'text-delta', id: 't1', delta: text })
const texts = (call: ChatCall) => call.body.messages.map(m => `${m.role}:${m.parts.filter(p => p.type === 'text').map(p => p.text).join('')}`)

async function sendFromComposer(text: string) {
  const textarea = await screen.findByPlaceholderText(/type a message/i)
  fireEvent.change(textarea, { target: { value: text } })
  const before = chatCalls.length
  await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
  await waitFor(() => expect(chatCalls.length).toBe(before + 1))
  return chatCalls[before]
}

beforeEach(() => {
  chatCalls = []
  otherCalls = []
  for (const key of Object.keys(actionMocks)) delete actionMocks[key]
  installFetch()
  // jsdom gaps the page's components touch.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= () => {}
  window.history.replaceState(null, '', '/')
  localStorage.clear()

  // List loaders return arrays; chats are created with increasing ids.
  for (const name of ['getProjects', 'getAllProjectChats', 'getStandaloneChats', 'getArchivedChats', 'getChatMessages', 'getChatAttachments', 'getProjectChatPreviews']) {
    action(name).mockResolvedValue([])
  }
  action('getProjectFileCounts').mockResolvedValue({})
  action('getSetting').mockResolvedValue(null)
  action('getMessageCount').mockResolvedValue(2)
  action('getChatWithContext').mockResolvedValue({ systemPrompt: null })
  let nextChatId = 1
  action('createStandaloneChat').mockImplementation(async (title: string) => [{ id: nextChatId++, projectId: null, title }])
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Home — a reply left streaming when the user moves on', () => {
  it('stays out of the next chat, is never stopped, and runs its post-turn steps for its own chat', async () => {
    render(<Home />)

    // Chat A (created on first send → id 1). Hold its reply open mid-stream.
    const callA = await sendFromComposer('Question A')
    expect(callA.body.chatId).toBe(1)
    expect(texts(callA)).toEqual(['user:Question A'])
    act(() => callA.send(
      { type: 'start', messageMetadata: turnMeta(1) },
      { type: 'start-step' },
      { type: 'text-start', id: 't1' },
      delta('Answer A so far'),
    ))
    expect(await screen.findByText('Answer A so far')).toBeTruthy()
    // The user's message is embedded as soon as the server reports its row —
    // long before the reply ends.
    await waitFor(() => expect(otherCalls.filter(c => c.url === '/api/embed').map(c => c.body)).toEqual([
      { messageId: 100, chatId: 1, projectId: null, content: 'Question A' },
    ]))

    // Leave mid-stream: sidebar "New chat" → Home.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /new chat/i })) })
    await waitFor(() => expect(screen.queryByText('Answer A so far')).toBeNull())
    expect(callA.signal?.aborted).toBe(false)

    // A keeps streaming while the user is on Home.
    act(() => callA.send(delta(', still going')))

    // First message from Home → a new chat (id 2), whose request and transcript
    // contain nothing of chat A.
    const callB = await sendFromComposer('Question B')
    expect(callB.body.chatId).toBe(2)
    expect(texts(callB)).toEqual(['user:Question B'])
    expect(JSON.stringify(callB.body)).not.toContain('Answer A')
    expect(await screen.findByText('Question B')).toBeTruthy()
    expect(screen.queryByText(/Answer A so far/)).toBeNull()

    // A finishes in the background. The client saves no text (the server did);
    // its post-turn steps address chat 1 and the row ids the server reported.
    act(() => {
      callA.send(
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish', finishReason: 'stop', messageMetadata: turnMeta(1, 101) },
      )
      callA.close()
    })
    await waitFor(() => expect(action('incrementUsageMessageCount')).toHaveBeenCalledWith(1))
    await waitFor(() => {
      const embeds = otherCalls.filter(c => c.url === '/api/embed').map(c => c.body)
      expect(embeds).toEqual([
        { messageId: 100, chatId: 1, projectId: null, content: 'Question A' },
        { messageId: 101, chatId: 1, projectId: null, content: 'Answer A so far, still going' },
      ])
    })
    expect(action('saveMessage')).not.toHaveBeenCalled()
    expect(callA.signal?.aborted).toBe(false)

    // …and chat B's screen still shows only chat B.
    expect(screen.queryByText(/Answer A so far/)).toBeNull()
    expect(screen.getByText('Question B')).toBeTruthy()
  })

  it('shows the live reply again when the user comes back to the chat, instead of the DB snapshot', async () => {
    render(<Home />)

    const callA = await sendFromComposer('Question A')
    act(() => callA.send(
      { type: 'start', messageMetadata: turnMeta(1) },
      { type: 'start-step' },
      { type: 'text-start', id: 't1' },
      delta('Answer A so far'),
    ))
    expect(await screen.findByText('Answer A so far')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /new chat/i })) })
    await waitFor(() => expect(screen.queryByText('Answer A so far')).toBeNull())
    act(() => callA.send(delta(', still going')))

    // Reopen chat A from the sidebar while its turn is in flight. The DB has the
    // user's message but no reply yet — loading that snapshot over the live
    // session would erase the streaming answer.
    action('getChatMessages').mockResolvedValue([{ id: 100, chatId: 1, role: 'user', content: 'Question A', createdAt: new Date() }])
    const loadsBefore = action('getChatMessages').mock.calls.length
    await act(async () => { fireEvent.click(screen.getByText('New Chat')) })
    expect(await screen.findByText('Answer A so far, still going')).toBeTruthy()
    await waitFor(() => expect(action('getChatMessages').mock.calls.length).toBeGreaterThan(loadsBefore))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(screen.getByText('Answer A so far, still going')).toBeTruthy()

    // It is still the live stream: later chunks keep arriving on screen.
    act(() => {
      callA.send(
        delta('. Done.'),
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish', finishReason: 'stop', messageMetadata: turnMeta(1, 101) },
      )
      callA.close()
    })
    expect(await screen.findByText('Answer A so far, still going. Done.')).toBeTruthy()
    expect(chatCalls).toHaveLength(1)
    expect(callA.signal?.aborted).toBe(false)
  })
})
