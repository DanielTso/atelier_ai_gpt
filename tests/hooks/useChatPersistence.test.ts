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
const mockGetAssistantReplyId = vi.fn()

vi.mock('@/app/actions', () => ({
  // Present only so the tests can prove the client never writes message text.
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
  saveGeneratedImage: (...args: unknown[]) => mockSaveGeneratedImage(...args),
  saveMessageAttachments: (...args: unknown[]) => mockSaveMessageAttachments(...args),
  incrementUsageMessageCount: (...args: unknown[]) => mockIncrementUsageMessageCount(...args),
  getMessageCount: (...args: unknown[]) => mockGetMessageCount(...args),
  getChatMessages: (...args: unknown[]) => mockGetChatMessages(...args),
  getAssistantReplyId: (...args: unknown[]) => mockGetAssistantReplyId(...args),
}))

const mockToastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }))

// Import the hook AFTER vi.mock so mocks are in place
import { useChatPersistence, MEMORY_SUGGEST_EVERY, type UseChatPersistenceOpts } from '@/hooks/useChatPersistence'
import { SUMMARIZATION_THRESHOLD, SUMMARIZE_EVERY, SUMMARIZE_RETRY_AFTER } from '@/hooks/useSummarization'
import type { TurnMetadata } from '@/lib/chatTurn'
import type { AttachedImage } from '@/lib/fileAttachments'

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Server metadata for a turn in chat 1 (standalone) unless overridden. */
function meta(overrides: Partial<TurnMetadata> = {}): TurnMetadata {
  return { chatId: 1, projectId: null, userMessageDbId: 100, assistantMessageDbId: 101, ...overrides }
}

/** Build a minimal assistant UIMessage carrying the server's turn metadata. */
function makeMessage(overrides: {
  id?: string
  text?: string
  metadata?: TurnMetadata | null
  fileParts?: Array<{ type: 'file'; mediaType: string; url: string }>
  imageOutputs?: Array<{ storagePath: string; url: string; mediaType: string; filename?: string; fileSize?: number }>
  hasArtifact?: boolean
} = {}) {
  const { id = 'msg-1', text = 'Hello', fileParts = [], imageOutputs = [], hasArtifact = false } = overrides
  const metadata = overrides.metadata === undefined ? meta() : overrides.metadata

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

  return { id, role: 'assistant', parts, ...(metadata ? { metadata } : {}) } as unknown as UIMessage
}

/** The turn as the chat session reports it: the reply plus the transcript it ended. */
function makeTurn(message: UIMessage, extra: { userText?: string; chatId?: number; isAbort?: boolean; isError?: boolean; isDisconnect?: boolean } = {}) {
  const { userText = 'user question', ...flags } = extra
  const user = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: userText }] } as unknown as UIMessage
  return { message, messages: [user, message], ...flags }
}

/** Build the opts object passed to useChatPersistence. */
function makeOpts(overrides: {
  activeChatId?: number | null
  lastSuggestedAt?: Map<number, number>
  lastSummarizedCount?: Map<number, number>
  pendingImages?: Map<number, AttachedImage[]>
} = {}) {
  const {
    activeChatId = 1,
    lastSuggestedAt = new Map(),
    lastSummarizedCount = new Map(),
    pendingImages = new Map(),
  } = overrides

  const activeChatIdRef = { current: activeChatId }
  const processedTurnIdsRef = { current: new Set<string>() }
  const lastSuggestedAtRef = { current: lastSuggestedAt }
  const lastSummarizedCountRef = { current: lastSummarizedCount }
  const updateChatMessages = vi.fn<UseChatPersistenceOpts['updateChatMessages']>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setArtifacts = vi.fn() as any
  const takePendingImages = vi.fn((chatId: number) => {
    const images = pendingImages.get(chatId) ?? []
    pendingImages.delete(chatId)
    return images
  })
  const triggerSummarization = vi.fn<UseChatPersistenceOpts['triggerSummarization']>().mockResolvedValue(true)
  const maybeGenerateTitle = vi.fn()

  return {
    activeChatIdRef,
    processedTurnIdsRef,
    lastSuggestedAtRef,
    lastSummarizedCountRef,
    updateChatMessages,
    setArtifacts,
    takePendingImages,
    triggerSummarization,
    maybeGenerateTitle,
  }
}

type FetchCall = [string, { body?: string } | undefined]
const fetchCalls = (path: string) =>
  ((fetch as ReturnType<typeof vi.fn>).mock.calls as FetchCall[]).filter(c => typeof c[0] === 'string' && c[0].includes(path))
const fetchBodies = (path: string) => fetchCalls(path).map(c => JSON.parse(c[1]?.body ?? '{}'))
/** Let the best-effort promise chains settle. */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('useChatPersistence', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifacts: [] }),
    }))
    mockSaveGeneratedImage.mockResolvedValue(undefined)
    mockSaveMessageAttachments.mockResolvedValue(undefined)
    mockIncrementUsageMessageCount.mockResolvedValue(undefined)
    mockGetMessageCount.mockResolvedValue(5)
    mockGetChatMessages.mockResolvedValue([
      { role: 'user', content: 'hey' },
      { role: 'assistant', content: 'Hello' },
    ])
    mockGetAssistantReplyId.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // The Task B1 contract: ids come from the server's metadata, never from nav state.
  it('post-turn-steps-use-metadata: embed, memory and persona steps use the metadata chat and project, not the active ones', async () => {
    mockGetMessageCount.mockResolvedValue(MEMORY_SUGGEST_EVERY + 1)
    // The user has since moved to chat 7 inside project 42; the reply belongs to
    // chat 3 in project 5. (activeProjectIdRef is no longer an option of the hook
    // at all — it is passed here only to show a stale value has nowhere to go.)
    const opts = { ...makeOpts({ activeChatId: 7 }), activeProjectIdRef: { current: 42 } }
    const { result } = renderHook(() => useChatPersistence(opts))

    const message = makeMessage({
      text: 'Hello',
      metadata: { chatId: 3, projectId: 5, userMessageDbId: 30, assistantMessageDbId: 31 },
    })
    await act(async () => { await result.current.onTurnFinish(makeTurn(message, { userText: 'user question' })) })
    await settle()

    expect(fetchBodies('/api/embed')).toEqual([
      { messageId: 30, chatId: 3, projectId: 5, content: 'user question' },
      { messageId: 31, chatId: 3, projectId: 5, content: 'Hello' },
    ])
    expect(mockIncrementUsageMessageCount).toHaveBeenCalledExactlyOnceWith(3)
    expect(mockGetMessageCount).toHaveBeenCalledExactlyOnceWith(3)
    expect(mockGetChatMessages).toHaveBeenCalledExactlyOnceWith(3, 12)
    expect(fetchBodies('/api/memory/suggest')).toEqual([
      expect.objectContaining({ projectId: 5, chatId: 3 }),
    ])
    expect(opts.maybeGenerateTitle).toHaveBeenCalledExactlyOnceWith(3)
    expect(opts.lastSuggestedAtRef.current.get(3)).toBe(MEMORY_SUGGEST_EVERY + 1)

    // Nothing anywhere was addressed to the active chat or project.
    const bodies = [...fetchBodies('/api/embed'), ...fetchBodies('/api/memory/suggest')]
    expect(bodies.length).toBe(3)
    expect(bodies.every(b => b.chatId === 3 && b.projectId === 5)).toBe(true)
    expect(opts.lastSuggestedAtRef.current.has(7)).toBe(false)
  })

  describe('onTurnStart', () => {
    const image = { name: 'site.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 } as AttachedImage
    const userMessage = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'look at this' }] } as unknown as UIMessage
    const startMeta = meta({ chatId: 3, projectId: 5, userMessageDbId: 30, assistantMessageDbId: null })

    it('saves the pending images and embeds the user message as soon as the server reports the user row', async () => {
      // Active chat 9: the start may arrive for a chat the user has already left.
      const opts = makeOpts({ activeChatId: 9, pendingImages: new Map([[3, [image]]]) })
      const { result } = renderHook(() => useChatPersistence(opts))

      act(() => result.current.onTurnStart({ metadata: startMeta, messages: [userMessage] }))
      await settle()

      expect(mockSaveMessageAttachments).toHaveBeenCalledExactlyOnceWith(30, 3, [
        { filename: 'site.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', fileSize: 3 },
      ])
      expect(fetchBodies('/api/embed')).toEqual([{ messageId: 30, chatId: 3, projectId: 5, content: 'look at this' }])
      // Nothing that belongs to the END of a turn runs yet.
      expect(mockIncrementUsageMessageCount).not.toHaveBeenCalled()
      expect(opts.maybeGenerateTitle).not.toHaveBeenCalled()
    })

    it('tells the user when the images could not be saved — they would vanish on refresh', async () => {
      mockToastError.mockReset()
      mockSaveMessageAttachments.mockRejectedValueOnce(new Error('Body exceeded 10mb limit'))
      const opts = makeOpts({ pendingImages: new Map([[3, [image]]]) })
      const { result } = renderHook(() => useChatPersistence(opts))

      act(() => result.current.onTurnStart({ metadata: startMeta, messages: [userMessage] }))
      await settle()

      expect(mockToastError).toHaveBeenCalledOnce()
      expect(String(mockToastError.mock.calls[0][0])).toMatch(/image/i)
      // The action can also fail AFTER its insert landed (a short RETURNING), so
      // the copy must not promise the images are gone.
      expect(String(mockToastError.mock.calls[0][0])).not.toMatch(/won't appear/)
    })

    it('does not repeat the user-message steps when the turn then finishes', async () => {
      const opts = makeOpts({ pendingImages: new Map([[3, [image]]]) })
      const { result } = renderHook(() => useChatPersistence(opts))

      act(() => result.current.onTurnStart({ metadata: startMeta, messages: [userMessage] }))
      const reply = makeMessage({ text: 'I see it', metadata: { ...startMeta, assistantMessageDbId: 31 } })
      await act(async () => { await result.current.onTurnFinish({ message: reply, messages: [userMessage, reply] }) })
      await settle()

      expect(mockSaveMessageAttachments).toHaveBeenCalledOnce()
      expect(fetchBodies('/api/embed')).toEqual([
        { messageId: 30, chatId: 3, projectId: 5, content: 'look at this' },
        { messageId: 31, chatId: 3, projectId: 5, content: 'I see it' },
      ])
    })

    it('ignores a start chunk without usable metadata and leaves the pending images for the finish handler', async () => {
      const opts = makeOpts({ pendingImages: new Map([[3, [image]]]) })
      const { result } = renderHook(() => useChatPersistence(opts))

      act(() => result.current.onTurnStart({ metadata: { unrelated: true }, messages: [userMessage] }))
      await settle()

      expect(opts.takePendingImages).not.toHaveBeenCalled()
      expect(mockSaveMessageAttachments).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('claims the pending images but saves nothing when the server inserted no user row', async () => {
      const opts = makeOpts({ pendingImages: new Map([[3, [image]]]) })
      const { result } = renderHook(() => useChatPersistence(opts))

      act(() => result.current.onTurnStart({ metadata: { ...startMeta, userMessageDbId: null }, messages: [userMessage] }))
      await settle()

      expect(opts.takePendingImages).toHaveBeenCalledExactlyOnceWith(3)
      expect(mockSaveMessageAttachments).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('never writes user or assistant text from the client — the server owns both rows', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    await act(async () => { await result.current.onTurnFinish(makeTurn(makeMessage({ text: 'World' }))) })
    await settle()
    expect(mockSaveMessage).not.toHaveBeenCalled()
  })

  it('saves the pending image attachments onto the server-saved user row', async () => {
    const image = { name: 'site.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 } as AttachedImage
    const opts = makeOpts({ activeChatId: 9, pendingImages: new Map([[3, [image]]]) })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ metadata: meta({ chatId: 3, userMessageDbId: 30 }) })))
    })

    expect(opts.takePendingImages).toHaveBeenCalledExactlyOnceWith(3)
    expect(mockSaveMessageAttachments).toHaveBeenCalledExactlyOnceWith(30, 3, [
      { filename: 'site.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', fileSize: 3 },
    ])
  })

  it('swaps the saved images\' inline data URLs for their signed URLs in that chat\'s live transcript', async () => {
    const first = { name: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 } as AttachedImage
    const second = { name: 'b.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,BBB', size: 3 } as AttachedImage
    mockSaveMessageAttachments.mockResolvedValue([{ url: 'https://storage.example/a?sig=1' }, { url: 'https://storage.example/b?sig=2' }])
    const opts = makeOpts({ activeChatId: 9, pendingImages: new Map([[3, [first, second]]]) })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ metadata: meta({ chatId: 3, userMessageDbId: 30 }) })))
    })
    await settle()

    expect(opts.updateChatMessages).toHaveBeenCalledWith(3, expect.any(Function))
    const updater = opts.updateChatMessages.mock.calls.find(c => c[0] === 3)![1]
    const user = {
      id: 'u', role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', url: first.dataUrl },
        { type: 'file', mediaType: 'image/png', url: second.dataUrl },
        { type: 'text', text: 'two photos' },
      ],
    } as unknown as UIMessage
    const [swapped] = updater([user])
    expect(swapped.parts.flatMap(p => (p.type === 'file' ? [p.url] : []))).toEqual([
      'https://storage.example/a?sig=1', 'https://storage.example/b?sig=2',
    ])
  })

  it('keeps the inline data URLs when the images were saved without Storage', async () => {
    const image = { name: 'a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 } as AttachedImage
    mockSaveMessageAttachments.mockResolvedValue([{ url: null }])
    const opts = makeOpts({ pendingImages: new Map([[3, [image]]]) })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ metadata: meta({ chatId: 3, userMessageDbId: 30 }) })))
    })
    await settle()

    expect(opts.updateChatMessages).not.toHaveBeenCalled()
  })

  it('links generated images to the assistant row from the metadata and updates that chat\'s store', async () => {
    const opts = makeOpts({ activeChatId: 9 })
    const { result } = renderHook(() => useChatPersistence(opts))
    const message = makeMessage({
      id: 'img-msg',
      metadata: meta({ chatId: 3, assistantMessageDbId: 31 }),
      imageOutputs: [{ storagePath: 'images/foo.png', url: 'https://cdn.example.com/foo.png', mediaType: 'image/png', filename: 'foo.png', fileSize: 1024 }],
    })

    await act(async () => { await result.current.onTurnFinish(makeTurn(message)) })

    expect(mockSaveGeneratedImage).toHaveBeenCalledExactlyOnceWith(31, 3, [
      { storagePath: 'images/foo.png', mediaType: 'image/png', filename: 'foo.png', fileSize: 1024 },
    ])
    // The inline file part is appended in chat 3's store — not "the current" one.
    expect(opts.updateChatMessages).toHaveBeenCalledOnce()
    const [chatId, updater] = opts.updateChatMessages.mock.calls[0]
    expect(chatId).toBe(3)
    const other = { id: 'other', role: 'assistant', parts: [] } as unknown as UIMessage
    const [updated, untouched] = updater([message, other])
    expect(updated.parts.at(-1)).toEqual({ type: 'file', mediaType: 'image/png', url: 'https://cdn.example.com/foo.png' })
    expect(untouched).toBe(other)
  })

  it('saves model-emitted file parts (Gemini image output) onto the assistant row', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    const message = makeMessage({
      text: '',
      metadata: meta({ chatId: 4, assistantMessageDbId: 41 }),
      fileParts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,BBB' }],
    })

    await act(async () => { await result.current.onTurnFinish(makeTurn(message)) })

    expect(mockSaveMessageAttachments).toHaveBeenCalledExactlyOnceWith(41, 4, [
      { filename: 'generated-image-1.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,BBB', fileSize: 'data:image/png;base64,BBB'.length },
    ])
  })

  it('runs the pipeline once when the same turn is reported twice', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    const turn = makeTurn(makeMessage({ id: 'same-id', text: 'hi' }))

    await act(async () => { await result.current.onTurnFinish(turn) })
    await act(async () => { await result.current.onTurnFinish(turn) })

    expect(mockIncrementUsageMessageCount).toHaveBeenCalledTimes(1)
    expect(fetchCalls('/api/embed')).toHaveLength(2) // user + assistant, once each
  })

  it('processes different turns independently, even when they finish interleaved across chats', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => { await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'a1', metadata: meta({ chatId: 1 }) }))) })
    await act(async () => { await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'b1', metadata: meta({ chatId: 2 }) }))) })
    // A late duplicate report of the first turn must still be recognized.
    await act(async () => { await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'a1', metadata: meta({ chatId: 1 }) }))) })

    expect(mockIncrementUsageMessageCount.mock.calls).toEqual([[1], [2]])
  })

  it('does nothing but discard pending images when the reply carries no server metadata', async () => {
    // A request that failed before the stream began (HTTP error): the server
    // reported no ids, so there is nothing to attach anything to.
    const image = { name: 'a.png', mediaType: 'image/png', dataUrl: 'data:,', size: 1 } as AttachedImage
    const opts = makeOpts({ pendingImages: new Map([[6, [image]]]) })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ metadata: null }), { chatId: 6, isError: true }))
    })
    await settle()

    // The images are dropped so they can't attach to the NEXT turn's message.
    expect(opts.takePendingImages).toHaveBeenCalledExactlyOnceWith(6)
    expect(mockSaveMessageAttachments).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(mockIncrementUsageMessageCount).not.toHaveBeenCalled()
    expect(opts.maybeGenerateTitle).not.toHaveBeenCalled()
  })

  it('still runs the user-message steps when the reply is empty (stopped before the first token)', async () => {
    const image = { name: 'a.png', mediaType: 'image/png', dataUrl: 'data:,', size: 1 } as AttachedImage
    const opts = makeOpts({ pendingImages: new Map([[1, [image]]]) })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(
        makeMessage({ text: '', metadata: meta({ assistantMessageDbId: null }) }),
        { userText: 'describe this', isAbort: true },
      ))
    })
    await settle()

    expect(mockSaveMessageAttachments).toHaveBeenCalledExactlyOnceWith(100, 1, expect.any(Array))
    expect(fetchBodies('/api/embed')).toEqual([{ messageId: 100, chatId: 1, projectId: null, content: 'describe this' }])
    // No reply content → no assistant-row lookup, no chat-level housekeeping.
    expect(mockGetAssistantReplyId).not.toHaveBeenCalled()
    expect(mockIncrementUsageMessageCount).not.toHaveBeenCalled()
    expect(opts.maybeGenerateTitle).not.toHaveBeenCalled()
  })

  it('looks up the server-saved partial reply for a stopped turn and uses its id', async () => {
    // Stop/abort: the finish chunk (which carries the assistant row id) never
    // arrives, but the server still saves the partial reply.
    mockGetAssistantReplyId.mockResolvedValue(77)
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    const message = makeMessage({
      text: 'Partial',
      metadata: meta({ chatId: 3, userMessageDbId: 30, assistantMessageDbId: null }),
      imageOutputs: [{ storagePath: 'images/p.png', url: 'u', mediaType: 'image/png' }],
    })

    await act(async () => { await result.current.onTurnFinish(makeTurn(message, { isAbort: true })) })
    await settle()

    expect(mockGetAssistantReplyId).toHaveBeenCalledWith(3, 30)
    expect(mockSaveGeneratedImage).toHaveBeenCalledWith(77, 3, expect.any(Array))
    expect(fetchBodies('/api/embed')).toContainEqual({ messageId: 77, chatId: 3, projectId: null, content: 'Partial' })
    expect(mockIncrementUsageMessageCount).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('writes the looked-up row id into the stopped reply\'s metadata, so Delete and Regenerate can find it', async () => {
    mockGetAssistantReplyId.mockResolvedValue(77)
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    const message = makeMessage({ id: 'stopped-1', text: 'Partial', metadata: meta({ chatId: 3, userMessageDbId: 30, assistantMessageDbId: null }) })

    await act(async () => { await result.current.onTurnFinish(makeTurn(message, { isAbort: true })) })
    await settle()

    const updaters = opts.updateChatMessages.mock.calls.filter(([chatId]) => chatId === 3).map(([, updater]) => updater)
    const other = { id: 'other', role: 'user', parts: [] } as unknown as UIMessage
    const patched = updaters.reduce((list, updater) => updater(list), [other, message] as UIMessage[])
    expect(patched[0]).toBe(other)
    expect(patched[1].metadata).toEqual({ chatId: 3, projectId: null, userMessageDbId: 30, assistantMessageDbId: 77 })
  })

  it('skips the user-message steps on a regenerate — the posted user message is an existing DB row', async () => {
    const image = { name: 'site.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 } as AttachedImage
    const opts = makeOpts({ pendingImages: new Map([[1, [image]]]) })
    const { result } = renderHook(() => useChatPersistence(opts))
    const loadedUser = { id: '100', role: 'user', parts: [{ type: 'text', text: 'Question' }] } as unknown as UIMessage

    act(() => result.current.onTurnStart({ metadata: meta({ assistantMessageDbId: null }), messages: [loadedUser] }))
    await settle()

    expect(opts.takePendingImages).toHaveBeenCalledWith(1)
    expect(mockSaveMessageAttachments).not.toHaveBeenCalled()
    expect(fetchBodies('/api/embed')).toEqual([])
  })

  it('skips the assistant-row steps when a stopped turn\'s reply was never saved, but keeps the chat-level ones', async () => {
    vi.useFakeTimers()
    try {
      mockGetAssistantReplyId.mockResolvedValue(null)
      const opts = makeOpts()
      const { result } = renderHook(() => useChatPersistence(opts))
      const message = makeMessage({
        text: 'Partial',
        metadata: meta({ assistantMessageDbId: null }),
        imageOutputs: [{ storagePath: 'images/p.png', url: 'u', mediaType: 'image/png' }],
      })

      await act(async () => {
        const done = result.current.onTurnFinish(makeTurn(message, { isError: true }))
        await vi.runAllTimersAsync()
        await done
      })

      // Bounded retries, then give up.
      expect(mockGetAssistantReplyId.mock.calls.length).toBeGreaterThan(1)
      expect(mockGetAssistantReplyId.mock.calls.length).toBeLessThanOrEqual(4)
      expect(mockSaveGeneratedImage).not.toHaveBeenCalled()
      expect(fetchBodies('/api/embed')).toEqual([{ messageId: 100, chatId: 1, projectId: null, content: 'user question' }])
      expect(mockIncrementUsageMessageCount).toHaveBeenCalledExactlyOnceWith(1)
      expect(opts.maybeGenerateTitle).toHaveBeenCalledExactlyOnceWith(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not look anything up after a clean finish — a null assistant id then means the server saved no row', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ text: 'Hello', metadata: meta({ assistantMessageDbId: null }) })))
    })
    await settle()
    expect(mockGetAssistantReplyId).not.toHaveBeenCalled()
    expect(fetchBodies('/api/embed')).toEqual([{ messageId: 100, chatId: 1, projectId: null, content: 'user question' }])
  })

  // (c) messageCount > threshold → triggerSummarization fires
  it('(c) triggers summarization when messageCount exceeds SUMMARIZATION_THRESHOLD', async () => {
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 1)
    const opts = makeOpts({ activeChatId: 2 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'sum-msg', metadata: meta({ chatId: 10 }) })))
    })

    expect(opts.triggerSummarization).toHaveBeenCalledWith(10, SUMMARIZATION_THRESHOLD + 1)
  })

  // (c) below threshold → triggerSummarization NOT fired
  it('(c) does not trigger summarization when messageCount is at or below threshold', async () => {
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD)
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'no-sum-msg', metadata: meta({ chatId: 10 }) })))
    })

    expect(opts.triggerSummarization).not.toHaveBeenCalled()
  })

  // (c) delta-gate: past the threshold, fold at most once per SUMMARIZE_EVERY new messages
  it('(c) fires summarization at most once per SUMMARIZE_EVERY new messages past the threshold', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))
    const turn = (id: string) => makeTurn(makeMessage({ id, metadata: meta({ chatId: 12 }) }))

    // First finish past the threshold → fires, records the count.
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 1) // 31, delta 31
    await act(async () => { await result.current.onTurnFinish(turn('a')) })
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(1)

    // A few messages later (delta < SUMMARIZE_EVERY) → does NOT fire again.
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 10) // 40, delta 9
    await act(async () => { await result.current.onTurnFinish(turn('b')) })
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(1)

    // Once the delta reaches SUMMARIZE_EVERY → fires again.
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + SUMMARIZE_EVERY + 1) // 51, delta 20 from the first fire
    await act(async () => { await result.current.onTurnFinish(turn('c')) })
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(2)
  })

  // Audit B4 (client side): the gate used to advance before the fold and never roll
  // back, so a failed fold postponed the next try by SUMMARIZE_EVERY messages.
  it('(c) re-arms the summarization gate when the fold fails, retrying after SUMMARIZE_RETRY_AFTER more messages', async () => {
    const opts = makeOpts()
    opts.triggerSummarization.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useChatPersistence(opts))
    const turn = (id: string) => makeTurn(makeMessage({ id, metadata: meta({ chatId: 12 }) }))
    const failedAt = SUMMARIZATION_THRESHOLD + 1

    mockGetMessageCount.mockResolvedValue(failedAt)
    await act(async () => { await result.current.onTurnFinish(turn('a')) })
    await settle()
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(1)
    // Rolled back to just short of the gate, not to the last successful fold:
    // the retry comes SUMMARIZE_RETRY_AFTER messages later (about two turns).
    expect(opts.lastSummarizedCountRef.current.get(12)).toBe(failedAt - SUMMARIZE_EVERY + SUMMARIZE_RETRY_AFTER)

    // One turn later (2 messages) is too soon.
    mockGetMessageCount.mockResolvedValue(failedAt + 2)
    await act(async () => { await result.current.onTurnFinish(turn('b')) })
    await settle()
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(1)

    // Two turns later (SUMMARIZE_RETRY_AFTER messages) it retries.
    mockGetMessageCount.mockResolvedValue(failedAt + SUMMARIZE_RETRY_AFTER)
    await act(async () => { await result.current.onTurnFinish(turn('c')) })
    await settle()
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(2)
    // That fold succeeded, so the gate holds its count now.
    expect(opts.lastSummarizedCountRef.current.get(12)).toBe(failedAt + SUMMARIZE_RETRY_AFTER)
  })

  it('(c) re-arms the summarization gate the same way when the fold rejects', async () => {
    const opts = makeOpts({ lastSummarizedCount: new Map([[12, 20]]) })
    opts.triggerSummarization.mockRejectedValueOnce(new Error('getChatMessages failed'))
    const { result } = renderHook(() => useChatPersistence(opts))
    const failedAt = SUMMARIZATION_THRESHOLD + 1

    mockGetMessageCount.mockResolvedValue(failedAt)
    await act(async () => { await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'rej', metadata: meta({ chatId: 12 }) }))) })
    await settle()
    expect(opts.lastSummarizedCountRef.current.get(12)).toBe(failedAt - SUMMARIZE_EVERY + SUMMARIZE_RETRY_AFTER)
  })

  it('(c) leaves the gate alone when a later fold moved it before this one failed', async () => {
    let failFold: (ok: boolean) => void = () => {}
    const opts = makeOpts()
    opts.triggerSummarization.mockImplementationOnce(() => new Promise<boolean>(resolve => { failFold = resolve }))
    const { result } = renderHook(() => useChatPersistence(opts))

    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 1)
    await act(async () => { await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'slow-fold', metadata: meta({ chatId: 12 }) }))) })
    // A later fold has advanced the gate while this one is still running.
    opts.lastSummarizedCountRef.current.set(12, SUMMARIZATION_THRESHOLD + 11)
    await act(async () => { failFold(false) })
    await settle()
    expect(opts.lastSummarizedCountRef.current.get(12)).toBe(SUMMARIZATION_THRESHOLD + 11)
  })

  // (d) project chat past the gate → POST /api/memory/suggest
  it('(d) fires memory/suggest for a project chat past the gate', async () => {
    mockGetMessageCount.mockResolvedValue(MEMORY_SUGGEST_EVERY + 1) // past the gate (lastSuggested defaults to 0)
    mockGetChatMessages.mockResolvedValue([{ role: 'user', content: 'q' }])

    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'mem-msg', metadata: meta({ chatId: 5, projectId: 99 }) })))
    })
    await settle()

    expect(fetchBodies('/api/memory/suggest')).toEqual([
      { projectId: 99, chatId: 5, messages: [{ role: 'user', content: 'q' }] },
    ])
  })

  // (d) project chat BELOW gate → memory/suggest NOT fired
  it('(d) does not fire memory/suggest when below the gate', async () => {
    mockGetMessageCount.mockResolvedValue(3) // well below MEMORY_SUGGEST_EVERY
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'below-gate-msg', metadata: meta({ chatId: 5, projectId: 99 }) })))
    })
    await settle()

    expect(fetchCalls('/api/memory/suggest')).toHaveLength(0)
  })

  // (d) standalone chat (metadata projectId null) → memory/suggest NOT fired
  it('(d) does not fire memory/suggest for standalone chats (no project in the metadata)', async () => {
    mockGetMessageCount.mockResolvedValue(MEMORY_SUGGEST_EVERY + 5)
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'standalone-msg', metadata: meta({ chatId: 2, projectId: null }) })))
    })
    await settle()

    expect(fetchCalls('/api/memory/suggest')).toHaveLength(0)
  })

  // (e) artifact re-fetch updates setArtifacts — only on turns that produced an artifact
  it('(e) re-fetches artifacts and calls setArtifacts when the turn produced an artifact in the open chat', async () => {
    const chatId = 8
    const fakeFetch = vi.fn()
      .mockResolvedValue({ ok: true, json: async () => ({ artifacts: [{ id: 1, title: 'Report' }] }) })
    vi.stubGlobal('fetch', fakeFetch)

    const opts = makeOpts({ activeChatId: chatId })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'art-msg', hasArtifact: true, metadata: meta({ chatId }) })))
    })
    await settle()

    expect(fetchCalls(`/api/artifacts?chatId=${chatId}`).length).toBeGreaterThanOrEqual(1)
    expect(opts.setArtifacts).toHaveBeenCalledWith([{ id: 1, title: 'Report' }])
  })

  // (e) a background chat's artifacts must not replace the open chat's list
  it('(e) does not touch the artifact list when the turn belongs to a chat that is no longer open', async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValue({ ok: true, json: async () => ({ artifacts: [{ id: 1, title: 'Report' }] }) })
    vi.stubGlobal('fetch', fakeFetch)

    const opts = makeOpts({ activeChatId: 9 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'art-bg', hasArtifact: true, metadata: meta({ chatId: 8 }) })))
    })
    await settle()

    expect(opts.setArtifacts).not.toHaveBeenCalled()
  })

  // (e2) a plain text turn must NOT re-fetch artifacts (the fetch was a per-turn no-op)
  it('(e2) does not re-fetch artifacts on a turn with no artifact output', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'text-msg' })))
    })
    await settle()

    expect(fetchCalls('/api/artifacts')).toHaveLength(0)
    expect(opts.setArtifacts).not.toHaveBeenCalled()
  })

  // (f) media-only turn (no text, has image output) still runs the assistant steps
  it('(f) links images for a media-only turn and does not embed its empty text', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useChatPersistence(opts))

    const message = makeMessage({
      id: 'img-only-msg',
      text: '',
      metadata: meta({ chatId: 6, userMessageDbId: 60, assistantMessageDbId: 61 }),
      imageOutputs: [{
        storagePath: 'images/foo.png',
        url: 'https://cdn.example.com/foo.png',
        mediaType: 'image/png',
        filename: 'foo.png',
        fileSize: 1024,
      }],
    })

    await act(async () => { await result.current.onTurnFinish(makeTurn(message)) })
    await settle()

    expect(mockSaveGeneratedImage).toHaveBeenCalledWith(61, 6, expect.any(Array))
    expect(fetchBodies('/api/embed').map(b => b.messageId)).toEqual([60])
  })

  // (e) maybeGenerateTitle is called
  it('calls maybeGenerateTitle with the turn\'s chat id', async () => {
    const opts = makeOpts({ activeChatId: 4 })
    const { result } = renderHook(() => useChatPersistence(opts))

    await act(async () => {
      await result.current.onTurnFinish(makeTurn(makeMessage({ id: 'title-msg', metadata: meta({ chatId: 11 }) })))
    })

    expect(opts.maybeGenerateTitle).toHaveBeenCalledWith(11)
  })
})
