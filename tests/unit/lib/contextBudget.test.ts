import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { stubOldToolOutputs, recentTail } from '@/lib/contextBudget'

const user = (id: string, text = `q${id}`): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const assistant = (id: string, text = `a${id}`, metadata?: unknown): UIMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text }], ...(metadata !== undefined && { metadata }) }) as UIMessage

const BIG = 'x'.repeat(100_000)

function readDocPart(callId: string, input: Record<string, unknown>, output: unknown, state = 'output-available') {
  return { type: 'tool-read_document', toolCallId: callId, state, input, output }
}

function readDocOutput(documentId: number, extra: Record<string, unknown> = {}) {
  return {
    documentId,
    filename: 'plans.pdf',
    totalChars: 250_000,
    text: BIG,
    startOffset: 0,
    endOffset: 100_000,
    nextOffset: 100_000,
    firstPage: 1,
    lastPage: 40,
    totalAnchors: 120,
    unavailablePages: [],
    note: 'Partial window — continue with offset=100000 if more is needed.',
    ...extra,
  }
}

const withParts = (m: UIMessage, parts: unknown[]): UIMessage => ({ ...m, parts: [...m.parts, ...parts] }) as UIMessage

describe('stubOldToolOutputs', () => {
  it('stubs-old-read-document-outputs: earlier windows become stubs, the last assistant turn keeps its output', () => {
    const history: UIMessage[] = [
      user('u1', 'list every sheet'),
      withParts(assistant('a1', 'Reading.'), [
        readDocPart('c1', { documentId: 12 }, readDocOutput(12)),
        readDocPart('c2', { documentId: 12, offset: 100_000 }, readDocOutput(12, { startOffset: 100_000, nextOffset: 200_000, firstPage: 41 })),
      ]),
      user('u2', 'and the electrical set?'),
      withParts(assistant('a2', 'Reading that too.'), [
        readDocPart('c3', { documentId: 13, fromPage: 5 }, readDocOutput(13, { nextOffset: null, firstPage: 5 })),
      ]),
      user('u3', 'thanks — which one is newest?'),
    ]

    const out = stubOldToolOutputs(history)
    expect(out).not.toBe(history)

    const oldParts = out[1].parts.filter(p => p.type === 'tool-read_document') as Array<{ output: unknown; toolCallId: string; state: string }>
    expect(oldParts.map(p => p.output)).toEqual([
      { stubbed: true, documentId: 12, fromPage: 1, nextOffset: 100_000, note: 're-read if needed' },
      { stubbed: true, documentId: 12, fromPage: 41, nextOffset: 200_000, note: 're-read if needed' },
    ])
    // The call itself is kept (a tool-call still pairs with its result).
    expect(oldParts.map(p => [p.toolCallId, p.state])).toEqual([['c1', 'output-available'], ['c2', 'output-available']])
    expect(JSON.stringify(out[1]).length).toBeLessThan(2_000)

    // The most recent assistant turn — the one a follow-up most likely refers to — is untouched.
    expect(out[3]).toBe(history[3])
    // Messages with nothing to stub keep their reference; the input is not mutated.
    expect(out[0]).toBe(history[0])
    expect(out[4]).toBe(history[4])
    expect((history[1].parts[1] as { output: { text: string } }).output.text).toBe(BIG)
  })

  it('uses the requested fromPage when the call asked for one', () => {
    const history: UIMessage[] = [
      user('u1'),
      withParts(assistant('a1'), [readDocPart('c1', { documentId: 9, fromPage: 30 }, readDocOutput(9, { firstPage: 30, nextOffset: undefined }))]),
      user('u2'),
      assistant('a2'),
      user('u3'),
    ]
    const part = stubOldToolOutputs(history)[1].parts[1] as { output: unknown }
    expect(part.output).toEqual({ stubbed: true, documentId: 9, fromPage: 30, note: 're-read if needed' })
  })

  it('returns the same array when nothing needs stubbing', () => {
    const plain = [user('u1'), assistant('a1'), user('u2')]
    expect(stubOldToolOutputs(plain)).toBe(plain)

    // Only the last assistant turn read a document.
    const onlyCurrent = [user('u1'), withParts(assistant('a1'), [readDocPart('c1', { documentId: 1 }, readDocOutput(1))]), user('u2')]
    expect(stubOldToolOutputs(onlyCurrent)).toBe(onlyCurrent)
  })

  it('leaves in-band errors, already-stubbed outputs, incomplete calls and other tools alone', () => {
    const earlier = withParts(assistant('a1'), [
      readDocPart('c1', { documentId: 1 }, { error: 'Document not found in this project.' }),
      readDocPart('c2', { documentId: 1 }, { stubbed: true, documentId: 1, note: 're-read if needed' }),
      readDocPart('c3', { documentId: 1 }, undefined, 'input-available'),
      { type: 'tool-generate_image', toolCallId: 'c4', state: 'output-available', input: { prompt: 'p' }, output: { storagePath: 's', url: 'u' } },
    ])
    const history = [user('u1'), earlier, user('u2'), assistant('a2'), user('u3')]
    expect(stubOldToolOutputs(history)).toBe(history)
  })

  it('stubs a dynamic-tool read_document part too', () => {
    const history: UIMessage[] = [
      user('u1'),
      withParts(assistant('a1'), [{ type: 'dynamic-tool', toolName: 'read_document', toolCallId: 'c1', state: 'output-available', input: { documentId: 4 }, output: readDocOutput(4) }]),
      user('u2'),
      assistant('a2'),
      user('u3'),
    ]
    const part = stubOldToolOutputs(history)[1].parts[1] as { output: { stubbed?: boolean; documentId?: number } }
    expect(part.output).toMatchObject({ stubbed: true, documentId: 4 })
  })
})

/** n messages with DB ids "1".."n", odd = user, even = assistant. */
function dbHistory(n: number): UIMessage[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(String(i + 1)) : assistant(String(i + 1))))
}

describe('recentTail', () => {
  it('tail-covers-summary-gap: keeps every message after the summary boundary even past the minimum', () => {
    // The summary ends at message 22; a later fold failed, so 29 messages follow it.
    const history = dbHistory(51)
    const tail = recentTail(history, 22)
    expect(tail.map(m => m.id)).toEqual(Array.from({ length: 29 }, (_, i) => String(i + 23)))
  })

  it('keeps at least `min` messages when the boundary is recent', () => {
    const history = dbHistory(50)
    const tail = recentTail(history, 45)
    expect(tail).toHaveLength(20)
    expect(tail[0].id).toBe('31')
    expect(tail[tail.length - 1].id).toBe('50')
  })

  it('caps the tail at `max`, never opening on an orphaned reply', () => {
    const history = dbHistory(150)
    const tail = recentTail(history, 10)
    // 60 back from 150 starts on message 91 (a user turn) — exactly max.
    expect(tail).toHaveLength(60)
    expect(tail[0].id).toBe('91')

    // An odd cut (would open on an assistant reply) steps back to its user message.
    const odd = recentTail(dbHistory(151), 10)
    expect(odd[0].role).toBe('user')
    expect(odd).toHaveLength(61)
  })

  it('with no summary returns the history unchanged up to `max`', () => {
    const short = dbHistory(40)
    expect(recentTail(short, null)).toBe(short)
    const long = dbHistory(80)
    expect(recentTail(long, null)).toHaveLength(60)
    expect(recentTail(long, null)[59].id).toBe('80')
  })

  it('returns the same array when nothing is trimmed', () => {
    const history = dbHistory(15)
    expect(recentTail(history, 3)).toBe(history)
  })

  it('places the boundary with live-session ids via the turn metadata', () => {
    // Loaded rows 1..30, then live turns: the client ids are SDK-generated, and
    // the DB ids ride on each assistant message's metadata.
    const live: UIMessage[] = []
    let dbId = 31
    for (let t = 0; t < 10; t++) {
      const userDbId = dbId++
      const asstDbId = dbId++
      live.push(user(`liveUser${t}xxxxxxx`))
      live.push(assistant(`liveAsst${t}xxxxxxx`, 'a', { chatId: 1, projectId: null, userMessageDbId: userDbId, assistantMessageDbId: asstDbId }))
    }
    const history = [...dbHistory(30), ...live, user('currentQuestion01')]
    // Summary folded up to row 34 (live turn 1's assistant). Rows 35..50 = 16 messages + the new question.
    const tail = recentTail(history, 34, 5)
    expect(tail).toHaveLength(17)
    expect(tail[0].id).toBe('liveUser2xxxxxxx')
  })

  it('sends up to `max` when the boundary cannot be placed in the history', () => {
    const history = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? user(`clientUser${i}xxxxx`) : assistant(`clientAsst${i}xxxxx`)))
    expect(recentTail(history, 500)).toBe(history)
  })
})
