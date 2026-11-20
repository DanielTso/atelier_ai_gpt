import { describe, it, expect, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { createAssistantTurnRecorder, isDbMessageId, readTurnMetadata, replyHasSavedContent, resolveMessageDbId } from '@/lib/chatTurn'

// Stream parts as streamText hands them to an `experimental_transform` (verified
// against ai@6.0.230: text deltas carry `.text`, tool results `.toolName`/`.output`).
type Part = { type: string; [key: string]: unknown }

/** Pipe parts through the recorder's transform and collect what comes out. */
async function run(recorder: ReturnType<typeof createAssistantTurnRecorder>, parts: Part[]) {
  const out: Part[] = []
  const source = new ReadableStream<Part>({
    start(controller) {
      for (const p of parts) controller.enqueue(p)
      controller.close()
    },
  })
  // The recorder is typed against the SDK's TextStreamPart; the test feeds the
  // minimal shapes it actually reads.
  const transform = recorder.transform() as unknown as TransformStream<Part, Part>
  const reader = source.pipeThrough(transform).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

/**
 * Feed parts one at a time and keep the stream open — no finish/abort/flush
 * follows unless the test sends one — so checkpoint writes can be observed on
 * their own. The output side is drained so the transform never backs up.
 */
function open(recorder: ReturnType<typeof createAssistantTurnRecorder>) {
  const stream = recorder.transform() as unknown as TransformStream<Part, Part>
  const out: Part[] = []
  void (async () => {
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.push(value)
    }
  })()
  const writer = stream.writable.getWriter()
  return { out, write: (part: Part) => writer.write(part) }
}

/** Let un-awaited checkpoint writes settle. */
const settle = () => new Promise(r => setTimeout(r, 0))

const delta = (text: string): Part => ({ type: 'text-delta', id: 't', text })
const toolCall: Part = { type: 'tool-call', toolCallId: 'c1', toolName: 'generate_image', input: {} }
const finishStep: Part = { type: 'finish-step' }

/** A recorder whose `update` is a succeeding no-op spy unless one is given. */
function recorderWith(
  save: (text: string) => Promise<number | null>,
  opts: { update?: (id: number, text: string, previous: string) => Promise<boolean>; checkpointMs?: number; now?: () => number } = {},
) {
  const update = vi.fn(opts.update ?? (async () => true))
  const recorder = createAssistantTurnRecorder({ save, update, checkpointMs: opts.checkpointMs, now: opts.now })
  return { recorder, update }
}

describe('isDbMessageId', () => {
  it('accepts the stringified integer ids loadMessages assigns to DB rows', () => {
    expect(isDbMessageId('1')).toBe(true)
    expect(isDbMessageId('48213')).toBe(true)
    expect(isDbMessageId('2147483647')).toBe(true)
  })

  it('rejects client-generated ids and anything that cannot be an int4 key', () => {
    expect(isDbMessageId('aB3xK9mQ2LpT7vNc')).toBe(false)
    expect(isDbMessageId('3f2c1a9e-7b1d-4c55-9a0e-1f2d3c4b5a69')).toBe(false)
    expect(isDbMessageId('0')).toBe(false)
    expect(isDbMessageId('012')).toBe(false)
    expect(isDbMessageId('2147483648')).toBe(false)
    expect(isDbMessageId('1234567890123456')).toBe(false)
    expect(isDbMessageId('12a')).toBe(false)
    expect(isDbMessageId('')).toBe(false)
    expect(isDbMessageId(undefined)).toBe(false)
    expect(isDbMessageId(12)).toBe(false)
  })
})

describe('readTurnMetadata', () => {
  it('returns the server ids from assistant message metadata', () => {
    expect(readTurnMetadata({ metadata: { chatId: 3, projectId: 5, userMessageDbId: 10, assistantMessageDbId: 11 } }))
      .toEqual({ chatId: 3, projectId: 5, userMessageDbId: 10, assistantMessageDbId: 11 })
  })

  it('normalizes absent or malformed optional ids to null', () => {
    expect(readTurnMetadata({ metadata: { chatId: 3 } }))
      .toEqual({ chatId: 3, projectId: null, userMessageDbId: null, assistantMessageDbId: null })
    expect(readTurnMetadata({ metadata: { chatId: 3, projectId: 'x', userMessageDbId: -1, assistantMessageDbId: 1.5 } }))
      .toEqual({ chatId: 3, projectId: null, userMessageDbId: null, assistantMessageDbId: null })
  })

  it('returns null when there is no usable chat id — the turn never reached the server stream', () => {
    expect(readTurnMetadata(undefined)).toBeNull()
    expect(readTurnMetadata({ metadata: undefined })).toBeNull()
    expect(readTurnMetadata({ metadata: 'nope' })).toBeNull()
    expect(readTurnMetadata({ metadata: { projectId: 5 } })).toBeNull()
    expect(readTurnMetadata({ metadata: { chatId: '3' } })).toBeNull()
  })
})

describe('replyHasSavedContent (client mirror of the recorder\'s persist rule)', () => {
  it('is true for non-blank text, a file part, a generated image or an artifact result', () => {
    expect(replyHasSavedContent([{ type: 'text', text: 'Answer' }])).toBe(true)
    expect(replyHasSavedContent([{ type: 'file', mediaType: 'image/png', url: 'u' }])).toBe(true)
    expect(replyHasSavedContent([{ type: 'tool-generate_image', state: 'output-available', output: { storagePath: 'images/a.png' } }])).toBe(true)
    expect(replyHasSavedContent([{ type: 'tool-generate_artifact', state: 'output-available', output: { artifactId: 3 } }])).toBe(true)
    expect(replyHasSavedContent([{ type: 'dynamic-tool', toolName: 'generate_artifact', state: 'output-available', output: {} }])).toBe(true)
  })

  it('is false for reasoning, blank text, step markers and non-media or unfinished tool parts', () => {
    expect(replyHasSavedContent([])).toBe(false)
    expect(replyHasSavedContent([{ type: 'step-start' }, { type: 'reasoning', text: 'Thinking it over' }])).toBe(false)
    expect(replyHasSavedContent([{ type: 'text', text: '  ' }, { type: 'text', text: '\n' }])).toBe(false)
    expect(replyHasSavedContent([{ type: 'tool-web_search', state: 'output-available', output: [] }])).toBe(false)
    expect(replyHasSavedContent([{ type: 'tool-generate_image', state: 'input-available', input: { prompt: 'crane' } }])).toBe(false)
    // The image tool reports its failures in-band as { error }.
    expect(replyHasSavedContent([{ type: 'tool-generate_image', state: 'output-available', output: { error: 'quota' } }])).toBe(false)
  })
})

describe('resolveMessageDbId', () => {
  const msg = (id: string, role: 'user' | 'assistant', metadata?: unknown) =>
    ({ id, role, parts: [{ type: 'text', text: id }], ...(metadata ? { metadata } : {}) }) as UIMessage
  const meta = (userMessageDbId: number | null, assistantMessageDbId: number | null) =>
    ({ chatId: 1, projectId: null, userMessageDbId, assistantMessageDbId })

  it('reads a message loaded from the DB off its own id', () => {
    const messages = [msg('41', 'user'), msg('42', 'assistant')]
    expect(resolveMessageDbId(messages, 0)).toBe(41)
    expect(resolveMessageDbId(messages, 1)).toBe(42)
  })

  it('reads a reply sent this session off its turn metadata', () => {
    const messages = [msg('userSdkId0000001', 'user'), msg('asstSdkId0000001', 'assistant', meta(50, 51))]
    expect(resolveMessageDbId(messages, 1)).toBe(51)
  })

  it('reads a user message sent this session off the metadata of the reply after it', () => {
    const messages = [msg('userSdkId0000001', 'user'), msg('asstSdkId0000001', 'assistant', meta(50, 51))]
    expect(resolveMessageDbId(messages, 0)).toBe(50)
  })

  it('returns null while a stopped reply has no row id yet', () => {
    const messages = [msg('userSdkId0000001', 'user'), msg('asstSdkId0000001', 'assistant', meta(50, null))]
    expect(resolveMessageDbId(messages, 1)).toBeNull()
  })

  it('returns null for a session user message with no reply after it, and for an index out of range', () => {
    const messages = [msg('userSdkId0000001', 'user')]
    expect(resolveMessageDbId(messages, 0)).toBeNull()
    expect(resolveMessageDbId(messages, 5)).toBeNull()
    expect(resolveMessageDbId(messages, -1)).toBeNull()
  })
})

describe('createAssistantTurnRecorder', () => {
  it('saves the text of every step, joined like the client joins text parts, before the finish part is forwarded', async () => {
    const order: string[] = []
    const save = vi.fn(async (text: string) => { order.push(`save:${text}`); return 41 })
    const { recorder, update } = recorderWith(save, {
      update: async (id, text) => { order.push(`update:${id}:${text}`); return true },
      now: () => 0,
    })

    const out = await run(recorder, [
      { type: 'start' },
      delta('Step one. '),
      { type: 'finish-step' },
      delta('Step two.'),
      { type: 'finish', finishReason: 'stop' },
    ])
    for (const p of out) order.push(`out:${p.type}`)

    // One row: inserted at the first checkpoint, then brought up to the full text.
    expect(save).toHaveBeenCalledExactlyOnceWith('Step one. ')
    expect(update).toHaveBeenLastCalledWith(41, 'Step one. Step two.', 'Step one. ')
    expect(recorder.assistantMessageDbId()).toBe(41)
    // Every part is passed through untouched and in order.
    expect(out.map(p => p.type)).toEqual(['start', 'text-delta', 'finish-step', 'text-delta', 'finish'])
    // The full text is written before `finish` leaves the transform — that is
    // what lets the synchronous messageMetadata callback put the id on the
    // finish chunk, and what the client reads afterwards.
    expect(order.indexOf('update:41:Step one. Step two.')).toBeLessThan(order.indexOf('out:finish'))
  })

  it('saves the text streamed so far when the stream aborts', async () => {
    const save = vi.fn(async () => 7)
    const { recorder } = recorderWith(save)
    await run(recorder, [{ type: 'start' }, delta('Partial ans'), { type: 'abort' }])
    expect(save).toHaveBeenCalledExactlyOnceWith('Partial ans')
    expect(recorder.assistantMessageDbId()).toBe(7)
  })

  it('saves on flush when the stream ends with neither a finish nor an abort part (provider error)', async () => {
    const save = vi.fn(async () => 9)
    const { recorder } = recorderWith(save)
    await run(recorder, [{ type: 'start' }, delta('Before the error'), { type: 'error', error: new Error('boom') }])
    expect(save).toHaveBeenCalledExactlyOnceWith('Before the error')
  })

  it('writes exactly once across finish, flush and a late persist() call', async () => {
    const save = vi.fn(async () => 5)
    const { recorder, update } = recorderWith(save)
    await run(recorder, [delta('Once'), { type: 'finish', finishReason: 'stop' }])
    await recorder.persist()
    await recorder.persist()
    expect(save).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
  })

  it('persist() brings the checkpointed row up to the full text when the pipeline died before any terminal part', async () => {
    // A stream that ERRORS (not an error part) skips flush entirely — the route
    // calls persist() after draining as the catch-all. The first checkpoint wrote
    // the first delta; the second arrived inside checkpointMs, so only persist()
    // can write it.
    const save = vi.fn(async () => 12)
    const { recorder, update } = recorderWith(save, { checkpointMs: 3000, now: () => 0 })
    const { write } = open(recorder)
    await write(delta('Half a '))
    await settle()
    await write(delta('rep')) // no finish/abort/flush follows
    await settle()
    expect(update).not.toHaveBeenCalled()

    await recorder.persist()
    expect(save).toHaveBeenCalledExactlyOnceWith('Half a ')
    expect(update).toHaveBeenCalledExactlyOnceWith(12, 'Half a rep', 'Half a ')
    expect(recorder.assistantMessageDbId()).toBe(12)
  })

  it('writes nothing for a turn with no text and no media', async () => {
    const save = vi.fn(async () => 1)
    const { recorder, update } = recorderWith(save)
    await run(recorder, [{ type: 'start' }, delta('   '), { type: 'tool-result', toolName: 'web_search', output: {} }, finishStep, { type: 'abort' }])
    expect(save).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(recorder.assistantMessageDbId()).toBeNull()
  })

  it('still writes an (empty-text) row for a media-only turn', async () => {
    const image = vi.fn(async () => 2)
    await run(recorderWith(image).recorder, [
      { type: 'tool-result', toolName: 'generate_image', output: { storagePath: 'attachments/1/generated/a.png', url: 'u', mediaType: 'image/png' } },
      { type: 'finish', finishReason: 'stop' },
    ])
    expect(image).toHaveBeenCalledExactlyOnceWith('')

    const artifact = vi.fn(async () => 3)
    await run(recorderWith(artifact).recorder, [
      { type: 'tool-result', toolName: 'generate_artifact', output: { artifactId: 4 } },
      { type: 'finish', finishReason: 'stop' },
    ])
    expect(artifact).toHaveBeenCalledExactlyOnceWith('')

    // Gemini image models emit the picture as a `file` part.
    const file = vi.fn(async () => 4)
    const { recorder, update } = recorderWith(file)
    await run(recorder, [{ type: 'file', file: {} }, finishStep, { type: 'finish', finishReason: 'stop' }])
    expect(file).toHaveBeenCalledExactlyOnceWith('')
    expect(update).not.toHaveBeenCalled()
  })

  it('does not count a failed generate_image call (in-band error output) as media', async () => {
    const save = vi.fn(async () => 1)
    await run(recorderWith(save).recorder, [
      { type: 'tool-result', toolName: 'generate_image', output: { error: 'Image storage is not configured.' } },
      { type: 'finish', finishReason: 'stop' },
    ])
    expect(save).not.toHaveBeenCalled()
  })

  it('never throws when the save fails — the id stays null and the stream still completes', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const save = vi.fn(async () => { throw new Error('db down') })
      const { recorder } = recorderWith(save)
      const out = await run(recorder, [delta('Answer'), { type: 'finish', finishReason: 'stop' }])
      expect(out.map(p => p.type)).toEqual(['text-delta', 'finish'])
      expect(recorder.assistantMessageDbId()).toBeNull()
      await expect(recorder.persist()).resolves.toBeUndefined()
      // The first checkpoint tried, then persist() tried again — and gave up quietly.
      expect(save).toHaveBeenCalledTimes(2)
    } finally {
      errSpy.mockRestore()
    }
  })

  describe('checkpoints while the reply streams', () => {
    it('checkpoints-first-savable-content: one save after the first non-blank delta, none before', async () => {
      const save = vi.fn(async () => 41)
      const { recorder, update } = recorderWith(save, { now: () => 0 })
      const { write } = open(recorder)

      await write({ type: 'start' })
      await write({ type: 'reasoning-delta', id: 'r', text: 'Thinking it over' })
      await write(delta('  \n'))
      await settle()
      expect(save).not.toHaveBeenCalled()

      await write(delta('Hello'))
      expect(save).toHaveBeenCalledExactlyOnceWith('  \nHello')
      await settle()
      expect(recorder.assistantMessageDbId()).toBe(41)

      await write(delta(' there'))
      await settle()
      expect(save).toHaveBeenCalledOnce()
      expect(update).not.toHaveBeenCalled()
    })

    it('checkpoints-first-savable-content: writes nothing for a whitespace-only or reasoning-only stream', async () => {
      const save = vi.fn(async () => 1)
      const { recorder, update } = recorderWith(save, { now: () => 0 })
      const { write } = open(recorder)
      await write({ type: 'reasoning-delta', id: 'r', text: 'Only thoughts' })
      await write(delta('   '))
      await write(toolCall)
      await write(finishStep)
      await settle()
      expect(save).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it('throttles-text-checkpoints: no extra write inside checkpointMs, one update with the text so far past it', async () => {
      let clock = 1_000
      const save = vi.fn(async () => 41)
      const { recorder, update } = recorderWith(save, { checkpointMs: 3000, now: () => clock })
      const { write } = open(recorder)

      await write(delta('A'))
      await settle()
      expect(save).toHaveBeenCalledExactlyOnceWith('A')

      clock = 3_999
      await write(delta('B'))
      await settle()
      expect(update).not.toHaveBeenCalled()

      clock = 4_000
      await write(delta('C'))
      await settle()
      expect(update).toHaveBeenCalledExactlyOnceWith(41, 'ABC', 'A')

      // The clock restarted at that write.
      clock = 6_999
      await write(delta('D'))
      await settle()
      expect(update).toHaveBeenCalledOnce()
      clock = 7_000
      await write(delta('E'))
      await settle()
      expect(update).toHaveBeenLastCalledWith(41, 'ABCDE', 'ABC')
      expect(save).toHaveBeenCalledOnce()
    })

    it('checkpoints-at-step-boundaries: tool-call and finish-step write the text when it changed', async () => {
      const save = vi.fn(async () => 41)
      const { recorder, update } = recorderWith(save, { now: () => 0 })
      const { write } = open(recorder)

      await write(delta('Let me draw that. '))
      await settle()
      await write(delta('One moment.'))
      await write(toolCall)
      await settle()
      expect(update).toHaveBeenCalledExactlyOnceWith(41, 'Let me draw that. One moment.', 'Let me draw that. ')

      // Nothing new since the last write: no write.
      await write(finishStep)
      await settle()
      expect(update).toHaveBeenCalledOnce()

      await write(delta(' Here it is.'))
      await write(finishStep)
      await settle()
      expect(update).toHaveBeenLastCalledWith(41, 'Let me draw that. One moment. Here it is.', 'Let me draw that. One moment.')
      expect(update).toHaveBeenCalledTimes(2)
      expect(save).toHaveBeenCalledOnce()
    })

    it('checkpoints when a tool input starts streaming, before the tool call is complete', async () => {
      const save = vi.fn(async () => 41)
      const { recorder, update } = recorderWith(save, { now: () => 0 })
      const { write } = open(recorder)

      await write(delta('Building the page. '))
      await settle()
      await write(delta('It will take a moment.'))
      await write({ type: 'tool-input-start', id: 'c1', toolName: 'generate_artifact' })
      await settle()
      expect(update).toHaveBeenCalledExactlyOnceWith(41, 'Building the page. It will take a moment.', 'Building the page. ')

      // The input streaming and the finished call add no text: no further write.
      await write({ type: 'tool-input-delta', id: 'c1', delta: '{"html":"<p>' })
      await write({ type: 'tool-call', toolCallId: 'c1', toolName: 'generate_artifact', input: {} })
      await settle()
      expect(update).toHaveBeenCalledOnce()
    })

    it('never-overlaps-writes: no second write while a slow save is in flight; persist() waits, then updates', async () => {
      let clock = 0
      let landSave!: (id: number) => void
      const save = vi.fn(() => new Promise<number>(resolve => { landSave = resolve }))
      const { recorder, update } = recorderWith(save, { checkpointMs: 3000, now: () => clock })
      const { write } = open(recorder)

      await write(delta('Slow '))
      expect(save).toHaveBeenCalledOnce()
      clock = 10_000
      await write(delta('save, '))
      await write(toolCall)
      await write(finishStep)
      await write(delta('still going.'))
      await settle()
      expect(save).toHaveBeenCalledOnce()
      expect(update).not.toHaveBeenCalled()
      expect(recorder.assistantMessageDbId()).toBeNull()

      let persisted = false
      const persisting = recorder.persist().then(() => { persisted = true })
      await settle()
      expect(persisted).toBe(false)
      expect(update).not.toHaveBeenCalled()

      landSave(41)
      await persisting
      expect(update).toHaveBeenCalledExactlyOnceWith(41, 'Slow save, still going.', 'Slow ')
      expect(save).toHaveBeenCalledOnce()
      expect(recorder.assistantMessageDbId()).toBe(41)
    })

    it('failed-checkpoint-then-persist: a rejected checkpoint is logged, the stream goes on, persist() saves', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const save = vi.fn<(text: string) => Promise<number | null>>()
          .mockRejectedValueOnce(new Error('db blip'))
          .mockResolvedValue(9)
        const { recorder } = recorderWith(save, { now: () => 0 })
        const out = await run(recorder, [delta('Answer'), delta(' text'), { type: 'finish', finishReason: 'stop' }])
        expect(out.map(p => p.type)).toEqual(['text-delta', 'text-delta', 'finish'])
        expect(save.mock.calls).toEqual([['Answer'], ['Answer text']])
        expect(recorder.assistantMessageDbId()).toBe(9)
        expect(String(errSpy.mock.calls[0]?.[0])).toMatch(/failed to save the assistant message/)
      } finally {
        errSpy.mockRestore()
      }
    })

    it('calls save again when the first save found nothing to write to (resolved null)', async () => {
      const save = vi.fn<(text: string) => Promise<number | null>>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(9)
      const { recorder, update } = recorderWith(save, { now: () => 0 })
      const { write } = open(recorder)
      await write(delta('Answer'))
      await settle()
      expect(recorder.assistantMessageDbId()).toBeNull()
      await write(toolCall)
      await settle()
      expect(save.mock.calls).toEqual([['Answer'], ['Answer']])
      expect(recorder.assistantMessageDbId()).toBe(9)
      expect(update).not.toHaveBeenCalled()
    })

    it('final-update-only-when-text-changed', async () => {
      const unchanged = vi.fn(async () => 3)
      const first = recorderWith(unchanged, { now: () => 0 })
      await run(first.recorder, [delta('Done.'), finishStep, { type: 'finish', finishReason: 'stop' }])
      expect(unchanged).toHaveBeenCalledExactlyOnceWith('Done.')
      expect(first.update).not.toHaveBeenCalled()

      const changed = vi.fn(async () => 4)
      const second = recorderWith(changed, { now: () => 0 })
      await run(second.recorder, [delta('Do'), delta('ne.'), { type: 'finish', finishReason: 'stop' }])
      expect(changed).toHaveBeenCalledExactlyOnceWith('Do')
      expect(second.update).toHaveBeenCalledExactlyOnceWith(4, 'Done.', 'Do')
    })

    it('starts no checkpoint once persist() has begun', async () => {
      const save = vi.fn(async () => 5)
      const { recorder, update } = recorderWith(save, { now: () => 0 })
      const { write } = open(recorder)
      await write(delta('Before'))
      await recorder.persist()
      await write(delta(' after'))
      await write(toolCall)
      await settle()
      expect(save).toHaveBeenCalledOnce()
      expect(update).not.toHaveBeenCalled()
    })
  })

  describe('another turn takes the row over (compare-and-set updates)', () => {
    it('superseded-writer-stops: an update that matched no row ends all writes and drops the row id', async () => {
      const save = vi.fn(async () => 41)
      const { recorder, update } = recorderWith(save, { now: () => 0, update: async () => false })
      const { out, write } = open(recorder)

      await write(delta('Mine '))
      await settle()
      await write(delta('so far'))
      await write(toolCall)
      await settle()
      // The update compared against the text this turn last wrote — and lost.
      expect(update).toHaveBeenCalledExactlyOnceWith(41, 'Mine so far', 'Mine ')
      expect(recorder.assistantMessageDbId()).toBeNull()

      // No checkpoint, no finish write, no late persist() writes again.
      await write(delta(' and more'))
      await write(finishStep)
      await settle()
      await write({ type: 'finish', finishReason: 'stop' })
      await recorder.persist()
      await settle()
      expect(update).toHaveBeenCalledOnce()
      expect(save).toHaveBeenCalledOnce()
      expect(recorder.assistantMessageDbId()).toBeNull()
      // The stream itself is untouched.
      expect(out.map(p => p.type)).toEqual(['text-delta', 'text-delta', 'tool-call', 'text-delta', 'finish-step', 'finish'])
    })

    it('superseded-writer-stops: an update that loses inside persist() leaves no row id on the finish', async () => {
      const save = vi.fn(async () => 41)
      const { recorder, update } = recorderWith(save, { now: () => 0, update: async () => false })
      await run(recorder, [delta('Mine'), delta(' and more'), { type: 'finish', finishReason: 'stop' }])
      await recorder.persist()
      expect(update).toHaveBeenCalledExactlyOnceWith(41, 'Mine and more', 'Mine')
      expect(recorder.assistantMessageDbId()).toBeNull()
    })

    it('rejected-update-is-not-supersession: a DB error is logged and the next write tries again', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const save = vi.fn(async () => 41)
        const update = vi.fn<(id: number, text: string, previous: string) => Promise<boolean>>()
          .mockRejectedValueOnce(new Error('db blip'))
          .mockResolvedValue(true)
        const { recorder } = recorderWith(save, { now: () => 0, update })
        const { write } = open(recorder)

        await write(delta('A'))
        await settle()
        await write(delta('B'))
        await write(toolCall)
        await settle()
        expect(String(errSpy.mock.calls[0]?.[0])).toMatch(/failed to save the assistant message/)
        expect(recorder.assistantMessageDbId()).toBe(41)

        // The next checkpoint retries — still comparing against what last LANDED.
        await write(delta('C'))
        await write(finishStep)
        await settle()
        await write(delta('D'))
        await recorder.persist()
        expect(update.mock.calls).toEqual([[41, 'AB', 'A'], [41, 'ABC', 'A'], [41, 'ABCD', 'ABC']])
        expect(recorder.assistantMessageDbId()).toBe(41)
      } finally {
        errSpy.mockRestore()
      }
    })
  })
})
