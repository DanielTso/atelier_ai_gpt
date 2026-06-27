// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { UIMessage } from 'ai'

// --- Mocks (must be hoisted before module imports that use them) ---

const mockSaveMessage = vi.fn()
const mockSaveGeneratedImage = vi.fn()
const mockSaveMessageAttachments = vi.fn()
const mockIncrementUsageMessageCount = vi.fn()
const mockGetMessageCount = vi.fn()
const mockGetChatMessages = vi.fn()

vi.mock('@/app/actions', () => ({
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
  saveGeneratedImage: (...args: unknown[]) => mockSaveGeneratedImage(...args),
  saveMessageAttachments: (...args: unknown[]) => mockSaveMessageAttachments(...args),
  incrementUsageMessageCount: (...args: unknown[]) => mockIncrementUsageMessageCount(...args),
  getMessageCount: (...args: unknown[]) => mockGetMessageCount(...args),
  getChatMessages: (...args: unknown[]) => mockGetChatMessages(...args),
}))

// Import the hook AFTER vi.mock so mocks are in place
import { useChatPersistence, MEMORY_SUGGEST_EVERY } from '@/hooks/useChatPersistence'
import { SUMMARIZATION_THRESHOLD } from '@/hooks/useSummarization'

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Build a minimal assistant UIMessage. */
function makeMessage(overrides: {
  id?: string
  text?: string
  fileParts?: Array<{ type: 'file'; mediaType: string; url: string }>
  imageOutputs?: Array<{ storagePath: string; url: string; mediaType: string; filename?: string; fileSize?: number }>
  hasArtifact?: boolean
} = {}) {
  const { id = 'msg-1', text = 'Hello', fileParts = [], imageOutputs = [], hasArtifact = false } = overrides

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = []
  if (text) parts.push({ type: 'text', text })
  for (const fp of fileParts) parts.push(fp)
  for (const io of imageOutputs) {
    parts.push({ type: 'tool-generate_image', output: io })
  }
  if (hasArtifact) {
    parts.push({ type: 'tool-generate_artifact-result' })
  }

  return { id, parts } as unknown as UIMessage
}

/** Build the opts object passed to useChatPersistence. */
function makeOpts(overrides: {
  chatId?: number | null
  projectId?: number | null
  lastSavedAssistantId?: string | null
  lastSuggestedAt?: Map<number, number>
} = {}) {
  const {
    chatId = 1,
    projectId = null,
    lastSavedAssistantId = null,
    lastSuggestedAt = new Map(),
  } = overrides

  const activeChatIdRef = { current: chatId }
  const activeProjectIdRef = { current: projectId }
  const lastSavedAssistantIdRef = { current: lastSavedAssistantId }
  const lastSuggestedAtRef = { current: lastSuggestedAt }
  // Cast mocks to the required dispatch types — the actual type doesn't matter in tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setMessages = vi.fn() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setArtifacts = vi.fn() as any
  const triggerSummarization = vi.fn().mockResolvedValue(undefined)
  const maybeGenerateTitle = vi.fn()

  return {
    activeChatIdRef,
    activeProjectIdRef,
    lastSavedAssistantIdRef,
    lastSuggestedAtRef,
    setMessages,
    setArtifacts,
    triggerSummarization,
    maybeGenerateTitle,
  }
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('useChatPersistence', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifacts: [] }),
    }))
    mockSaveMessage.mockResolvedValue([{ id: 42 }])
    mockSaveGeneratedImage.mockResolvedValue(undefined)
    mockSaveMessageAttachments.mockResolvedValue(undefined)
    mockIncrementUsageMessageCount.mockResolvedValue(undefined)
    mockGetMessageCount.mockResolvedValue(5)
    mockGetChatMessages.mockResolvedValue([
      { role: 'user', content: 'hey' },
      { role: 'assistant', content: 'Hello' },
    ])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // (a) saveMessage called with (chatId, 'assistant', text)
  it('(a) calls saveMessage with chatId, role=assistant, and text content', async () => {
    const opts = makeOpts({ chatId: 7 })
    const { result } = renderHook(() => useChatPersistence(opts))

    const message = makeMessage({ text: 'World' })
    await act(async () => {
      await result.current({ message })
    })

    expect(mockSaveMessage).toHaveBeenCalledWith(7, 'assistant', 'World')
  })

  // (b) double-invoke with same message.id does NOT save twice (dedup)
  it('(b) double-invoke with the same message.id does not save twice', async () => {
    const opts = makeOpts({ chatId: 3 })
    const { result } = renderHook(() => useChatPersistence(opts))

    const message = makeMessage({ id: 'same-id', text: 'hi' })

    await act(async () => {
      await result.current({ message })
    })
    await act(async () => {
      await result.current({ message })
    })

    // saveMessage must have been called exactly once despite two invocations
    expect(mockSaveMessage).toHaveBeenCalledTimes(1)
  })

  // (c) messageCount > threshold → triggerSummarization fires
  it('(c) triggers summarization when messageCount exceeds SUMMARIZATION_THRESHOLD', async () => {
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 1)
    const opts = makeOpts({ chatId: 10 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'sum-msg' }) })
    })

    expect(opts.triggerSummarization).toHaveBeenCalledWith(10, SUMMARIZATION_THRESHOLD + 1)
  })

  // (c) below threshold → triggerSummarization NOT fired
  it('(c) does not trigger summarization when messageCount is at or below threshold', async () => {
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD)
    const opts = makeOpts({ chatId: 10 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'no-sum-msg' }) })
    })

    expect(opts.triggerSummarization).not.toHaveBeenCalled()
  })

  // (d) project chat past the gate → POST /api/memory/suggest
  it('(d) fires memory/suggest for a project chat past the gate', async () => {
    const chatId = 5
    const messageCount = MEMORY_SUGGEST_EVERY + 1 // past the gate (lastSuggested defaults to 0)
    mockGetMessageCount.mockResolvedValue(messageCount)
    mockGetChatMessages.mockResolvedValue([{ role: 'user', content: 'q' }])

    const opts = makeOpts({ chatId, projectId: 99 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'mem-msg' }) })
    })

    // Wait for the best-effort promise chain to settle
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    const fetchMock = fetch as ReturnType<typeof vi.fn>
    const memoryCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/api/memory/suggest')
    )
    expect(memoryCalls.length).toBeGreaterThanOrEqual(1)
  })

  // (d) project chat BELOW gate → memory/suggest NOT fired
  it('(d) does not fire memory/suggest when below the gate', async () => {
    const chatId = 5
    mockGetMessageCount.mockResolvedValue(3) // well below MEMORY_SUGGEST_EVERY
    const opts = makeOpts({ chatId, projectId: 99 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'below-gate-msg' }) })
    })

    const fetchMock = fetch as ReturnType<typeof vi.fn>
    const memoryCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/api/memory/suggest')
    )
    expect(memoryCalls.length).toBe(0)
  })

  // (d) standalone chat (no projectId) → memory/suggest NOT fired
  it('(d) does not fire memory/suggest for standalone chats (no projectId)', async () => {
    mockGetMessageCount.mockResolvedValue(MEMORY_SUGGEST_EVERY + 5)
    const opts = makeOpts({ chatId: 2, projectId: null })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'standalone-msg' }) })
    })

    const fetchMock = fetch as ReturnType<typeof vi.fn>
    const memoryCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/api/memory/suggest')
    )
    expect(memoryCalls.length).toBe(0)
  })

  // (e) artifact re-fetch updates setArtifacts
  it('(e) re-fetches artifacts and calls setArtifacts with the result', async () => {
    const chatId = 8
    const fakeFetch = vi.fn()
      .mockResolvedValue({ ok: true, json: async () => ({ artifacts: [{ id: 1, title: 'Report' }] }) })
    vi.stubGlobal('fetch', fakeFetch)

    const opts = makeOpts({ chatId })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'art-msg' }) })
    })

    // Let any dangling promises settle
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    const artifactFetches = fakeFetch.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes(`/api/artifacts?chatId=${chatId}`)
    )
    expect(artifactFetches.length).toBeGreaterThanOrEqual(1)
    expect(opts.setArtifacts).toHaveBeenCalledWith([{ id: 1, title: 'Report' }])
  })

  // (f) media-only turn (no text, has image output) still saves
  it('(f) saves a media-only turn that has image output but no text', async () => {
    const opts = makeOpts({ chatId: 6 })
    const { result } = renderHook(() => useChatPersistence(opts))

    const message = makeMessage({
      id: 'img-only-msg',
      text: '',
      imageOutputs: [{
        storagePath: 'images/foo.png',
        url: 'https://cdn.example.com/foo.png',
        mediaType: 'image/png',
        filename: 'foo.png',
        fileSize: 1024,
      }],
    })

    await act(async () => {
      await result.current({ message })
    })

    expect(mockSaveMessage).toHaveBeenCalledWith(6, 'assistant', '')
    expect(mockSaveGeneratedImage).toHaveBeenCalled()
  })

  // Dedup: different message ids DO save
  it('different message ids each get saved', async () => {
    const opts = makeOpts({ chatId: 4 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'msg-a', text: 'first' }) })
    })
    await act(async () => {
      await result.current({ message: makeMessage({ id: 'msg-b', text: 'second' }) })
    })

    expect(mockSaveMessage).toHaveBeenCalledTimes(2)
    expect(mockSaveMessage).toHaveBeenNthCalledWith(1, 4, 'assistant', 'first')
    expect(mockSaveMessage).toHaveBeenNthCalledWith(2, 4, 'assistant', 'second')
  })

  // No chatId → no save
  it('skips everything when activeChatId is null', async () => {
    const opts = makeOpts({ chatId: null })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage() })
    })

    expect(mockSaveMessage).not.toHaveBeenCalled()
  })

  // (e) maybeGenerateTitle is called
  it('calls maybeGenerateTitle with the active chat id', async () => {
    const opts = makeOpts({ chatId: 11 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current({ message: makeMessage({ id: 'title-msg' }) })
    })

    expect(opts.maybeGenerateTitle).toHaveBeenCalledWith(11)
  })
})
