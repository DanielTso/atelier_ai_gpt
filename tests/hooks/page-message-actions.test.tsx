// @vitest-environment jsdom
//
// Page-level proofs for audit task C8 (D1, D2, D4/U9): the real <Home /> with only
// the server (actions + fetch) faked — same harness as page-chat-turns.test.tsx.
// - "Project settings" in the chat header, the project landing and the Projects
//   view opens the per-project defaults dialog.
// - Message Delete goes through the deleteMessage action with the message's DB id.
// - Regenerate on the last reply posts `regenerate: true` + `replaceMessageDbId`.
// - A new chat with no persona or custom prompt gets the default system prompt.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

// ---- server actions -------------------------------------------------------
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
  body: {
    chatId: number | null
    trigger?: string
    regenerate?: boolean
    replaceMessageDbId?: number
    messages: Array<{ id: string; role: string; parts: Array<{ type: string; text?: string }> }>
  }
  send: (...chunks: Array<Record<string, unknown>>) => void
  close: () => void
}
let chatCalls: ChatCall[] = []
// A one-off canned /api/chat response (an HTTP error); otherwise the stream is driven by the test.
let nextChatResponse: (() => Response) | null = null

const MODEL: Model = {
  name: 'Claude Opus 4.8',
  model: 'claude-opus-4-8',
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
    if (url === '/api/chat' && nextChatResponse) {
      const respond = nextChatResponse
      nextChatResponse = null
      chatCalls.push({ body: JSON.parse(String(init?.body)), send: () => {}, close: () => {} })
      return respond()
    }
    if (url === '/api/chat') {
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
      // Like a real fetch: aborting the request (Stop) errors the response body.
      init?.signal?.addEventListener('abort', () => {
        try { controller.error(new DOMException('The operation was aborted.', 'AbortError')) } catch { /* already closed */ }
      })
      chatCalls.push({
        body: JSON.parse(String(init?.body)),
        send: (...chunks) => { for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`)) },
        close: () => controller.close(),
      })
      return new Response(stream, { status: 200 })
    }
    if (url.startsWith('/api/models')) return json({ models: [MODEL] })
    if (url.startsWith('/api/artifacts')) return json({ artifacts: [] })
    if (url.startsWith('/api/documents')) return json({ documents: [] })
    if (url.startsWith('/api/suggest-followups')) return json({ suggestions: [] })
    return json({})
  }))
}

const PROJECT = { id: 7, name: 'Tower', memory: '', instructions: '' }
const row = (id: number, role: 'user' | 'assistant', content: string) => ({ id, chatId: 5, role, content, createdAt: new Date('2026-11-01') })

beforeAll(() => {
  // Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
  chatCalls = []
  nextChatResponse = null
  for (const key of Object.keys(actionMocks)) delete actionMocks[key]
  installFetch()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= () => {}
  window.history.replaceState(null, '', '/')
  localStorage.clear()

  for (const name of ['getProjects', 'getAllProjectChats', 'getStandaloneChats', 'getArchivedChats', 'getChatMessages', 'getChatAttachments', 'getProjectChatPreviews', 'getPendingSuggestions', 'getProjectPersonaStats']) {
    action(name).mockResolvedValue([])
  }
  action('getProjectFileCounts').mockResolvedValue({})
  action('getProjectDefaults').mockResolvedValue({ defaultPersonaId: null, defaultModel: null })
  action('getSetting').mockResolvedValue(null)
  action('getMessageCount').mockResolvedValue(2)
  action('getChatWithContext').mockResolvedValue({ systemPrompt: null })
  action('getApiKeyStatus').mockResolvedValue({ gemini: false, anthropic: false, tavily: false })
  action('deleteMessage').mockResolvedValue(true)
  let nextChatId = 1
  action('createStandaloneChat').mockImplementation(async (title: string) => [{ id: nextChatId++, projectId: null, title }])
  action('createChat').mockImplementation(async (projectId: number, title: string) => [{ id: nextChatId++, projectId, title }])
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.pointerUp(trigger)
}

/** Open quick chat 5, loaded from the DB with one finished turn. */
async function openLoadedChat() {
  action('getStandaloneChats').mockResolvedValue([{ id: 5, projectId: null, title: 'Loaded' }])
  action('getChatMessages').mockResolvedValue([row(11, 'user', 'Loaded question'), row(12, 'assistant', 'Loaded answer')])
  window.history.replaceState(null, '', '/?chat=5')
  render(<Home />)
  expect(await screen.findByText('Loaded answer')).toBeTruthy()
}

describe('Home — message Delete (D2)', () => {
  it('deletes a loaded message by its DB id and drops it from the transcript', async () => {
    await openLoadedChat()
    openMenu(screen.getAllByRole('button', { name: 'Message actions' })[1])
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })) })

    expect(action('deleteMessage')).toHaveBeenCalledExactlyOnceWith(12)
    await waitFor(() => expect(screen.queryByText('Loaded answer')).toBeNull())
    expect(screen.getByText('Loaded question')).toBeTruthy()
  })

  it('keeps the message and says so when the delete fails', async () => {
    action('deleteMessage').mockRejectedValue(new Error('db down'))
    await openLoadedChat()
    openMenu(screen.getAllByRole('button', { name: 'Message actions' })[1])
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })) })

    expect(action('deleteMessage')).toHaveBeenCalledOnce()
    expect(screen.getByText('Loaded answer')).toBeTruthy()
  })
})

describe('Home — Regenerate (D2)', () => {
  it('regenerates the last loaded reply: posts regenerate + the replaced row id, without the old reply', async () => {
    await openLoadedChat()
    openMenu(screen.getAllByRole('button', { name: 'Message actions' })[1])
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' })) })

    await waitFor(() => expect(chatCalls).toHaveLength(1))
    const { body } = chatCalls[0]
    expect(body).toMatchObject({ chatId: 5, trigger: 'regenerate-message', regenerate: true, replaceMessageDbId: 12 })
    expect(body.messages.map(m => [m.id, m.role])).toEqual([['11', 'user']])
    // (waitFor: the row leaves through an exit animation.)
    await waitFor(() => expect(screen.queryByText('Loaded answer')).toBeNull())
  })

  it('regenerates a reply sent this session, using the row id from its turn metadata', async () => {
    render(<Home />)
    const textarea = await screen.findByPlaceholderText(/type a message/i)
    fireEvent.change(textarea, { target: { value: 'Fresh question' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    await waitFor(() => expect(chatCalls).toHaveLength(1))

    const meta = { chatId: 1, projectId: null, userMessageDbId: 100, assistantMessageDbId: null }
    await act(async () => {
      chatCalls[0].send(
        { type: 'start', messageMetadata: meta },
        { type: 'start-step' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Fresh answer' },
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish', messageMetadata: { ...meta, assistantMessageDbId: 101 } },
      )
      chatCalls[0].close()
    })
    expect(await screen.findByText('Fresh answer')).toBeTruthy()
    // Delete/Regenerate stay hidden until the reply has finished streaming.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Message actions' })).toHaveLength(2))

    await waitFor(async () => {
      openMenu(screen.getAllByRole('button', { name: 'Message actions' })[1])
      expect(await screen.findByRole('menuitem', { name: 'Regenerate' })).toBeTruthy()
    })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' })) })

    await waitFor(() => expect(chatCalls).toHaveLength(2))
    const { body } = chatCalls[1]
    expect(body).toMatchObject({ chatId: 1, trigger: 'regenerate-message', regenerate: true, replaceMessageDbId: 101 })
    expect(body.messages.map(m => m.role)).toEqual(['user'])
  })
})

describe('Home — a regenerate that produces no new reply puts the old one back', () => {
  async function regenerateLoaded() {
    await openLoadedChat()
    openMenu(screen.getAllByRole('button', { name: 'Message actions' })[1])
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' })) })
  }

  it('after an HTTP refusal (409), and the banner shows the server\'s message, not raw JSON', async () => {
    nextChatResponse = () => new Response(JSON.stringify({ error: 'This reply can no longer be regenerated' }), { status: 409 })
    await regenerateLoaded()

    expect(await screen.findByText('This reply can no longer be regenerated')).toBeTruthy()
    expect(screen.queryByText(/"error"/)).toBeNull()
    expect(await screen.findByText('Loaded answer')).toBeTruthy()
  })

  it('after a stream that ends in an error before any content', async () => {
    await regenerateLoaded()
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Loaded answer')).toBeNull())

    await act(async () => {
      chatCalls[0].send(
        { type: 'start', messageMetadata: { chatId: 5, projectId: null, userMessageDbId: 11, assistantMessageDbId: null } },
        { type: 'error', errorText: 'The AI provider is overloaded or unavailable right now. Try again in a moment.' },
      )
      chatCalls[0].close()
    })

    expect(await screen.findByText('Loaded answer')).toBeTruthy()
    // Only one copy, still the last message.
    expect(screen.getAllByText('Loaded answer')).toHaveLength(1)
  })

  it('after a stream that only reasoned before its error (no content-less bubble left)', async () => {
    await regenerateLoaded()
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    await act(async () => {
      chatCalls[0].send(
        { type: 'start', messageMetadata: { chatId: 5, projectId: null, userMessageDbId: 11, assistantMessageDbId: null } },
        { type: 'start-step' },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'Weighing the options' },
        { type: 'reasoning-end', id: 'r1' },
      )
    })
    // The reasoning-only reply is on screen while the turn runs.
    await waitFor(() => expect(screen.queryByText('Loaded answer')).toBeNull())
    await act(async () => {
      chatCalls[0].send({ type: 'error', errorText: 'The AI provider is overloaded or unavailable right now. Try again in a moment.' })
      chatCalls[0].close()
    })

    expect(await screen.findByText('Loaded answer')).toBeTruthy()
    expect(screen.getAllByText('Loaded answer')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText(/Thought process|Thinking…|Weighing the options/)).toBeNull())
    expect(screen.getAllByRole('button', { name: 'Message actions' })).toHaveLength(2)
  })

  it('after a Stop while only a non-media tool call (web search) had streamed', async () => {
    await regenerateLoaded()
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    await act(async () => {
      chatCalls[0].send(
        { type: 'start', messageMetadata: { chatId: 5, projectId: null, userMessageDbId: 11, assistantMessageDbId: null } },
        { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'web_search', input: { query: 'retainage' }, providerExecuted: true },
      )
    })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Stop response' })) })

    expect(await screen.findByText('Loaded answer')).toBeTruthy()
    expect(screen.getAllByText('Loaded answer')).toHaveLength(1)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Message actions' })).toHaveLength(2))
  })

  it('but keeps the new reply when the regenerate produced one', async () => {
    await regenerateLoaded()
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    const meta = { chatId: 5, projectId: null, userMessageDbId: 11, assistantMessageDbId: null }
    await act(async () => {
      chatCalls[0].send(
        { type: 'start', messageMetadata: meta },
        { type: 'start-step' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Regenerated answer' },
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish', messageMetadata: { ...meta, assistantMessageDbId: 12 } },
      )
      chatCalls[0].close()
    })

    expect(await screen.findByText('Regenerated answer')).toBeTruthy()
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText('Loaded answer')).toBeNull()
  })
})

describe('Home — Delete on a message sent this session', () => {
  it('deletes a session user message by the id on the reply after it', async () => {
    render(<Home />)
    const textarea = await screen.findByPlaceholderText(/type a message/i)
    fireEvent.change(textarea, { target: { value: 'Session question' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    const meta = { chatId: 1, projectId: null, userMessageDbId: 100, assistantMessageDbId: null }
    await act(async () => {
      chatCalls[0].send(
        { type: 'start', messageMetadata: meta },
        { type: 'start-step' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Session answer' },
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish', messageMetadata: { ...meta, assistantMessageDbId: 101 } },
      )
      chatCalls[0].close()
    })
    expect(await screen.findByText('Session answer')).toBeTruthy()

    await waitFor(async () => {
      openMenu(screen.getAllByRole('button', { name: 'Message actions' })[0])
      expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy()
    })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })) })

    expect(action('deleteMessage')).toHaveBeenCalledExactlyOnceWith(100)
    await waitFor(() => expect(screen.queryByText('Session question')).toBeNull())
    expect(screen.getByText('Session answer')).toBeTruthy()
  })
})

describe('Home — Project settings (D1)', () => {
  const dialogTitle = () => screen.findByText('Project Defaults: Tower')

  it('opens from the project chat header menu', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    action('getAllProjectChats').mockResolvedValue([{ id: 5, projectId: 7, title: 'Tower chat' }])
    window.history.replaceState(null, '', '/?project=7&chat=5')
    render(<Home />)

    openMenu(await screen.findByRole('button', { name: 'Project options for Tower' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }))
    expect(await dialogTitle()).toBeTruthy()
  })

  it('opens from the project landing header menu', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)

    expect(await screen.findByRole('heading', { name: 'Tower' })).toBeTruthy()
    openMenu(screen.getByRole('button', { name: 'Project options for Tower' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }))
    expect(await dialogTitle()).toBeTruthy()
  })

  it('opens from a Projects view card menu', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    window.history.replaceState(null, '', '/?view=projects')
    render(<Home />)

    openMenu(await screen.findByRole('button', { name: 'Project options for Tower' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }))
    expect(await dialogTitle()).toBeTruthy()
  })
})

describe('Home — default system prompt (D4 / U9)', () => {
  const withDefaultPrompt = (value: string | null) =>
    action('getSetting').mockImplementation(async (key: string) => (key === 'default-system-prompt' ? value : null))

  async function sendFrom(text: string) {
    const textarea = await screen.findByPlaceholderText(/type a message/i)
    fireEvent.change(textarea, { target: { value: text } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    await waitFor(() => expect(chatCalls).toHaveLength(1))
  }

  it('applies it to a new quick chat created with no persona or custom prompt', async () => {
    withDefaultPrompt('Answer like a superintendent.')
    render(<Home />)
    await sendFrom('Hello')
    expect(action('updateChatSystemPrompt')).toHaveBeenCalledExactlyOnceWith(1, 'Answer like a superintendent.')
  })

  it('applies it to a new chat from a project landing with no default persona', async () => {
    withDefaultPrompt('Answer like a superintendent.')
    action('getProjects').mockResolvedValue([PROJECT])
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)
    expect(await screen.findByRole('heading', { name: 'Tower' })).toBeTruthy()
    await sendFrom('Hello')
    expect(action('updateChatSystemPrompt')).toHaveBeenCalledExactlyOnceWith(1, 'Answer like a superintendent.')
  })

  it('loses to the project default persona', async () => {
    withDefaultPrompt('Answer like a superintendent.')
    action('getProjects').mockResolvedValue([PROJECT])
    action('getProjectDefaults').mockResolvedValue({ defaultPersonaId: 'coding', defaultModel: null })
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)
    expect(await screen.findByRole('heading', { name: 'Tower' })).toBeTruthy()
    await sendFrom('Hello')
    const calls = action('updateChatSystemPrompt').mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).not.toBe('Answer like a superintendent.')
    expect(String(calls[0][1]).length).toBeGreaterThan(0)
  })

  it('applies a default saved in Settings during this session', async () => {
    withDefaultPrompt(null)
    action('setSettings').mockResolvedValue(undefined)
    render(<Home />)

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Customize' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /model defaults/i })) })
    fireEvent.change(await screen.findByPlaceholderText(/you are a helpful assistant/i), { target: { value: 'Cite the spec section.' } })
    withDefaultPrompt('Cite the spec section.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save defaults/i })) })
    expect(action('setSettings')).toHaveBeenCalledWith(expect.arrayContaining([{ key: 'default-system-prompt', value: 'Cite the spec section.' }]))
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }) })

    await sendFrom('Hello')
    expect(action('updateChatSystemPrompt')).toHaveBeenCalledExactlyOnceWith(1, 'Cite the spec section.')
  })

  it('loses to an explicit General Assistant pick', async () => {
    withDefaultPrompt('Answer like a superintendent.')
    render(<Home />)
    openMenu(await screen.findByTitle('Select persona'))
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: /General Assistant/ })) })
    await sendFrom('Hello')
    const calls = action('updateChatSystemPrompt').mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).not.toBe('Answer like a superintendent.')
    expect(String(calls[0][1]).length).toBeGreaterThan(0)
  })

  it('waits for the setting when a chat is created before it has loaded', async () => {
    let release!: (v: string) => void
    action('getSetting').mockImplementation((key: string) =>
      key === 'default-system-prompt' ? new Promise<string>(r => { release = r }) : Promise.resolve(null))
    render(<Home />)
    const textarea = await screen.findByPlaceholderText(/type a message/i)
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    expect(chatCalls).toHaveLength(0)

    await act(async () => { release('Late default.') })
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    expect(action('updateChatSystemPrompt')).toHaveBeenCalledExactlyOnceWith(1, 'Late default.')
  })

  it('writes no system prompt when the setting is empty', async () => {
    withDefaultPrompt('   ')
    render(<Home />)
    await sendFrom('Hello')
    expect(action('updateChatSystemPrompt')).not.toHaveBeenCalled()
  })
})
