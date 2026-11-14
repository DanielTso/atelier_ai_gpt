// @vitest-environment jsdom
//
// Page-level proofs for audit task C7 (U5, U6, U7, U8, F6/C9 and the Phase B
// follow-ups): the real <Home /> with only the server (actions + fetch) faked —
// same harness as page-chat-turns.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react'

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
let chatCalls: Array<{ body: { chatId: number | null } }> = []
// Overridable per test; by default the reply is held open.
let chatResponse: () => Response = () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
let otherCalls: Array<{ url: string; init: RequestInit | undefined }> = []

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
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/chat') {
      chatCalls.push({ body: JSON.parse(String(init?.body)) })
      return chatResponse()
    }
    otherCalls.push({ url, init })
    if (url.startsWith('/api/models')) return json({ models: [MODEL] })
    if (url.startsWith('/api/artifacts')) return json({ artifacts: [] })
    if (url.startsWith('/api/documents')) return json({ documents: [] })
    return json({})
  }))
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const PROJECT = { id: 7, name: 'Tower', memory: 'Hub', instructions: '' }

beforeEach(() => {
  chatCalls = []
  otherCalls = []
  chatResponse = () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
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

  for (const name of ['getProjects', 'getAllProjectChats', 'getStandaloneChats', 'getArchivedChats', 'getChatMessages', 'getChatAttachments', 'getProjectChatPreviews', 'getPendingSuggestions']) {
    action(name).mockResolvedValue([])
  }
  action('getProjectFileCounts').mockResolvedValue({})
  action('getProjectDefaults').mockResolvedValue({})
  action('getSetting').mockResolvedValue(null)
  action('getMessageCount').mockResolvedValue(2)
  action('getChatWithContext').mockResolvedValue({ systemPrompt: null })
  action('getApiKeyStatus').mockResolvedValue({ gemini: false, anthropic: false, tavily: false })
  let nextChatId = 1
  action('createStandaloneChat').mockImplementation(async (title: string) => [{ id: nextChatId++, projectId: null, title }])
  action('createChat').mockImplementation(async (projectId: number, title: string) => [{ id: nextChatId++, projectId, title }])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const composer = () => screen.findByPlaceholderText(/type a message/i) as Promise<HTMLTextAreaElement>

describe('Home — double send (U5)', () => {
  it('a double Enter on Home creates one chat and sends once', async () => {
    const create = deferred<Array<{ id: number; projectId: null; title: string }>>()
    action('createStandaloneChat').mockImplementation(() => create.promise)
    render(<Home />)

    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter' })
      fireEvent.keyDown(textarea, { key: 'Enter' })
    })
    // The composer clears before the create round-trip, not after it.
    expect(textarea.value).toBe('')
    await act(async () => { create.resolve([{ id: 1, projectId: null, title: 'New Chat' }]) })

    await waitFor(() => expect(chatCalls).toHaveLength(1))
    expect(action('createStandaloneChat')).toHaveBeenCalledTimes(1)
    expect(chatCalls[0].body.chatId).toBe(1)
  })

  it('a double Enter on a project landing creates one chat', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    const create = deferred<Array<{ id: number; projectId: number; title: string }>>()
    action('createChat').mockImplementation(() => create.promise)
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)

    expect(await screen.findByRole('heading', { name: 'Tower' })).toBeTruthy()
    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter' })
      fireEvent.keyDown(textarea, { key: 'Enter' })
    })
    await act(async () => { create.resolve([{ id: 3, projectId: 7, title: 'New Chat' }]) })

    await waitFor(() => expect(chatCalls).toHaveLength(1))
    expect(action('createChat')).toHaveBeenCalledTimes(1)
  })

  it('a failed chat create puts the message back and shows the error on Home', async () => {
    action('createStandaloneChat').mockRejectedValue(new Error('db down'))
    render(<Home />)

    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: 'Keep me' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })

    expect(await screen.findByText('Failed to create chat.')).toBeTruthy()
    expect((await composer()).value).toBe('Keep me')
    expect(chatCalls).toHaveLength(0)
  })

  it('a send after a failed create goes through (the guard is released)', async () => {
    action('createStandaloneChat').mockRejectedValueOnce(new Error('db down'))
    render(<Home />)

    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: 'Try again' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    expect(await screen.findByText('Failed to create chat.')).toBeTruthy()

    const again = await composer()
    expect(again.value).toBe('Try again')
    await act(async () => { fireEvent.keyDown(again, { key: 'Enter' }) })
    await waitFor(() => expect(chatCalls).toHaveLength(1))
    expect(action('createStandaloneChat')).toHaveBeenCalledTimes(2)
  })

  it('an oversized send creates no chat and keeps the input', async () => {
    render(<Home />)
    const big = 'x'.repeat(4 * 1024 * 1024 + 16)
    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: big } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })

    expect(action('createStandaloneChat')).not.toHaveBeenCalled()
    expect(chatCalls).toHaveLength(0)
    expect((await composer()).value.length).toBe(big.length)
  })
})

describe('Home — the error banner (F6 / prior C9)', () => {
  it('shows an error raised on Home and keeps it until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    action('getProjects').mockRejectedValue(new Error('down'))
    render(<Home />)

    expect(await screen.findByText('Failed to load projects.')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('Failed to load projects.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText('Failed to load projects.')).toBeNull()
  })
})

describe('Home — which errors clear themselves', () => {
  it('a settings save does not wipe an unrelated error', async () => {
    action('createStandaloneChat').mockRejectedValue(new Error('db down'))
    render(<Home />)
    await waitFor(() => expect(otherCalls.some(c => c.url === '/api/models')).toBe(true))

    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    expect(await screen.findByText('Failed to create chat.')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Customize' })) })
    const keysTab = await screen.findByRole('button', { name: /api keys/i })
    await act(async () => { fireEvent.click(keysTab) })
    fireEvent.change(await screen.findByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-new' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save keys/i })) })
    await waitFor(() => expect(otherCalls.filter(c => c.url === '/api/models')).toHaveLength(2))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    expect(screen.getByText('Failed to create chat.')).toBeTruthy()
  })

  it("a chat's stream error is cleared when the user leaves that chat", async () => {
    chatResponse = () => new Response('Upstream failed', { status: 500 })
    render(<Home />)

    const textarea = await composer()
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    expect(await screen.findByText('Upstream failed')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /new chat/i })) })
    await waitFor(() => expect(screen.queryByText('Upstream failed')).toBeNull())
  })
})

describe('Home — command palette from a tab view (U7)', () => {
  it('opens the picked chat instead of leaving the Projects view on screen', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    action('getAllProjectChats').mockResolvedValue([{ id: 9, projectId: 7, title: 'Steel RFI' }])
    render(<Home />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Projects' })) })
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy()

    act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
    const search = await screen.findByPlaceholderText('Type a command or search...')
    const palette = search.closest('.fixed') as HTMLElement
    await act(async () => { fireEvent.click(within(palette).getByText('Steel RFI')) })

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Projects' })).toBeNull())
    await waitFor(() => expect(action('getChatWithContext')).toHaveBeenCalledWith(9))
    expect(await composer()).toBeTruthy()
  })
})

describe('Home — settings changes refresh the model list (U8)', () => {
  it('re-fetches /api/models past the browser cache after keys are saved', async () => {
    render(<Home />)
    await waitFor(() => expect(otherCalls.some(c => c.url === '/api/models')).toBe(true))
    const before = otherCalls.length

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Customize' })) })
    const keysTab = await screen.findByRole('button', { name: /api keys/i })
    await act(async () => { fireEvent.click(keysTab) })
    fireEvent.change(await screen.findByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-new' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save keys/i })) })

    await waitFor(() => {
      const refetch = otherCalls.slice(before).find(c => c.url === '/api/models')
      expect(refetch?.init?.cache).toBe('reload')
    })
  })
})

describe('Home — project landing (U6, delete-project history)', () => {
  it('an accepted memory suggestion survives leaving and reopening the project', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    action('getPendingSuggestions').mockResolvedValue([{ id: 3, text: 'PE is Jane', createdAt: null }])
    action('acceptSuggestion').mockResolvedValue({ memory: 'Hub\nPE is Jane' })
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)

    const accept = await screen.findByTitle('Accept')
    await act(async () => { fireEvent.click(accept) })
    await waitFor(() => expect((screen.getByLabelText('Memory') as HTMLTextAreaElement).value).toBe('Hub\nPE is Jane'))

    // Leave for the Projects grid, then come back: the rail remounts from the
    // page's project state, which must already hold the accepted fact.
    action('getPendingSuggestions').mockResolvedValue([])
    await act(async () => { fireEvent.click(screen.getByText('All projects')) })
    const grid = await screen.findByRole('heading', { name: 'Projects' })
    const main = grid.closest('main') as HTMLElement
    await act(async () => { fireEvent.click(within(main).getByText('Tower')) })
    await waitFor(() => expect((screen.getByLabelText('Memory') as HTMLTextAreaElement).value).toBe('Hub\nPE is Jane'))
  })

  it('deleting the open project replaces the URL instead of pushing a dead entry', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)
    expect(await screen.findByRole('heading', { name: 'Tower' })).toBeTruthy()
    const lengthBefore = window.history.length

    const trigger = screen.getByRole('button', { name: 'Project options for Tower' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.pointerUp(trigger)
    const deleteItem = await screen.findByText('Delete')
    await act(async () => { fireEvent.click(deleteItem) })
    const dialog = await screen.findByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) })

    await waitFor(() => expect(action('deleteProject')).toHaveBeenCalledWith(7))
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(window.history.length).toBe(lengthBefore)
  })

  it('deleting a project from the Projects tab leaves the next navigation a real push', async () => {
    action('getProjects').mockResolvedValue([PROJECT])
    window.history.replaceState(null, '', '/?project=7')
    render(<Home />)
    expect(await screen.findByRole('heading', { name: 'Tower' })).toBeTruthy()

    // Projects tab: activeProjectId stays 7 behind the tab view.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Projects' })) })
    const grid = await screen.findByRole('heading', { name: 'Projects' })
    const main = grid.closest('main') as HTMLElement
    const trigger = within(main).getByRole('button', { name: 'Project options for Tower' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.pointerUp(trigger)
    const deleteItem = await screen.findByText('Delete')
    await act(async () => { fireEvent.click(deleteItem) })
    const dialog = await screen.findByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) })
    await waitFor(() => expect(action('deleteProject')).toHaveBeenCalledWith(7))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const lengthBefore = window.history.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Artifacts' })) })
    await waitFor(() => expect(window.location.search).toContain('artifacts'))
    expect(window.history.length).toBe(lengthBefore + 1)
  })
})
