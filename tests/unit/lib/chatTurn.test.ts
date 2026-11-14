import { describe, it, expect, vi } from 'vitest'
import { createAssistantTurnRecorder, isDbMessageId, readTurnMetadata } from '@/lib/chatTurn'

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

const delta = (text: string): Part => ({ type: 'text-delta', id: 't', text })

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

describe('createAssistantTurnRecorder', () => {
  it('saves the text of every step, joined like the client joins text parts, before the finish part is forwarded', async () => {
    const order: string[] = []
    const save = vi.fn(async (text: string) => { order.push(`save:${text}`); return 41 })
    const recorder = createAssistantTurnRecorder(save)

    const out = await run(recorder, [
      { type: 'start' },
      delta('Step one. '),
      { type: 'finish-step' },
      delta('Step two.'),
      { type: 'finish', finishReason: 'stop' },
    ])
    for (const p of out) order.push(`out:${p.type}`)

    expect(save).toHaveBeenCalledExactlyOnceWith('Step one. Step two.')
    expect(recorder.assistantMessageDbId()).toBe(41)
    // Every part is passed through untouched and in order.
    expect(out.map(p => p.type)).toEqual(['start', 'text-delta', 'finish-step', 'text-delta', 'finish'])
    // The id exists before `finish` leaves the transform — that is what lets the
    // synchronous messageMetadata callback put it on the finish chunk.
    expect(order.indexOf('save:Step one. Step two.')).toBeLessThan(order.indexOf('out:finish'))
  })

  it('saves the text streamed so far when the stream aborts', async () => {
    const save = vi.fn(async () => 7)
    const recorder = createAssistantTurnRecorder(save)
    await run(recorder, [{ type: 'start' }, delta('Partial ans'), { type: 'abort' }])
    expect(save).toHaveBeenCalledExactlyOnceWith('Partial ans')
    expect(recorder.assistantMessageDbId()).toBe(7)
  })

  it('saves on flush when the stream ends with neither a finish nor an abort part (provider error)', async () => {
    const save = vi.fn(async () => 9)
    const recorder = createAssistantTurnRecorder(save)
    await run(recorder, [{ type: 'start' }, delta('Before the error'), { type: 'error', error: new Error('boom') }])
    expect(save).toHaveBeenCalledExactlyOnceWith('Before the error')
  })

  it('writes exactly once across finish, flush and a late persist() call', async () => {
    const save = vi.fn(async () => 5)
    const recorder = createAssistantTurnRecorder(save)
    await run(recorder, [delta('Once'), { type: 'finish', finishReason: 'stop' }])
    await recorder.persist()
    await recorder.persist()
    expect(save).toHaveBeenCalledOnce()
  })

  it('persist() saves what was recorded when the pipeline died before any terminal part', async () => {
    // A stream that ERRORS (not an error part) skips flush entirely — the route
    // calls persist() after draining as the catch-all.
    const save = vi.fn(async () => 12)
    const recorder = createAssistantTurnRecorder(save)
    const stream = recorder.transform() as unknown as TransformStream<Part, Part>
    const reader = stream.readable.getReader()
    void stream.writable.getWriter().write(delta('Half a rep'))
    await reader.read() // the delta went through; no finish/abort/flush follows
    expect(save).not.toHaveBeenCalled()
    await recorder.persist()
    expect(save).toHaveBeenCalledExactlyOnceWith('Half a rep')
    expect(recorder.assistantMessageDbId()).toBe(12)
  })

  it('writes nothing for a turn with no text and no media', async () => {
    const save = vi.fn(async () => 1)
    const recorder = createAssistantTurnRecorder(save)
    await run(recorder, [{ type: 'start' }, delta('   '), { type: 'tool-result', toolName: 'web_search', output: {} }, { type: 'abort' }])
    expect(save).not.toHaveBeenCalled()
    expect(recorder.assistantMessageDbId()).toBeNull()
  })

  it('still writes an (empty-text) row for a media-only turn', async () => {
    const image = vi.fn(async () => 2)
    await run(createAssistantTurnRecorder(image), [
      { type: 'tool-result', toolName: 'generate_image', output: { storagePath: 'attachments/1/generated/a.png', url: 'u', mediaType: 'image/png' } },
      { type: 'finish', finishReason: 'stop' },
    ])
    expect(image).toHaveBeenCalledExactlyOnceWith('')

    const artifact = vi.fn(async () => 3)
    await run(createAssistantTurnRecorder(artifact), [
      { type: 'tool-result', toolName: 'generate_artifact', output: { artifactId: 4 } },
      { type: 'finish', finishReason: 'stop' },
    ])
    expect(artifact).toHaveBeenCalledExactlyOnceWith('')

    // Gemini image models emit the picture as a `file` part.
    const file = vi.fn(async () => 4)
    await run(createAssistantTurnRecorder(file), [{ type: 'file', file: {} }, { type: 'finish', finishReason: 'stop' }])
    expect(file).toHaveBeenCalledExactlyOnceWith('')
  })

  it('does not count a failed generate_image call (in-band error output) as media', async () => {
    const save = vi.fn(async () => 1)
    await run(createAssistantTurnRecorder(save), [
      { type: 'tool-result', toolName: 'generate_image', output: { error: 'Image storage is not configured.' } },
      { type: 'finish', finishReason: 'stop' },
    ])
    expect(save).not.toHaveBeenCalled()
  })

  it('never throws when the save fails — the id stays null and the stream still completes', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const save = vi.fn(async () => { throw new Error('db down') })
      const recorder = createAssistantTurnRecorder(save)
      const out = await run(recorder, [delta('Answer'), { type: 'finish', finishReason: 'stop' }])
      expect(out.map(p => p.type)).toEqual(['text-delta', 'finish'])
      expect(recorder.assistantMessageDbId()).toBeNull()
      await expect(recorder.persist()).resolves.toBeUndefined()
      expect(save).toHaveBeenCalledOnce()
    } finally {
      errSpy.mockRestore()
    }
  })
})
