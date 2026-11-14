// Bounds what `/api/chat` replays to the model from the client's message history.
// The client posts its whole live store on every send (tool parts and all), so
// without these two passes a session's input grows without limit: every
// `read_document` window is re-billed on each later turn (audit B3), and a
// failed summarize fold used to leave messages in neither the summary nor the
// fixed last-20 tail (audit B4). Both are pure and return the input array itself
// when there is nothing to change.
import type { UIMessage } from 'ai'
import { isDbMessageId, readTurnMetadata } from '@/lib/chatTurn'

export const RECENT_MIN = 20
export const RECENT_MAX = 60

/** What an old `read_document` result is replaced with: enough to re-read it. */
export type ReadDocumentStub = {
  stubbed: true
  documentId: number
  fromPage?: number
  nextOffset?: number
  note: 're-read if needed'
}

type ToolPartLike = {
  type: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : null

const positiveInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined

const nonNegativeInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined

function isReadDocumentPart(part: ToolPartLike): boolean {
  return part.type === 'tool-read_document' || (part.type === 'dynamic-tool' && part.toolName === 'read_document')
}

/**
 * The stub for one `read_document` part, or null when it should stay as it is:
 * not a finished call, an in-band `{ error }` (short, and worth keeping), or
 * already a stub.
 */
function stubFor(part: ToolPartLike): ReadDocumentStub | null {
  if (!isReadDocumentPart(part) || part.state !== 'output-available') return null
  const output = asRecord(part.output)
  if (!output || output.stubbed === true || 'error' in output) return null
  const input = asRecord(part.input) ?? {}
  const documentId = positiveInt(output.documentId) ?? positiveInt(input.documentId)
  if (documentId === undefined) return null
  const fromPage = positiveInt(input.fromPage) ?? positiveInt(output.firstPage)
  const nextOffset = nonNegativeInt(output.nextOffset)
  return {
    stubbed: true,
    documentId,
    ...(fromPage !== undefined && { fromPage }),
    ...(nextOffset !== undefined && { nextOffset }),
    note: 're-read if needed',
  }
}

/**
 * Replaces the output of every `read_document` part with a short stub, except in
 * the last assistant turn — the one a follow-up most likely refers to. The tool
 * call itself is kept so each call still pairs with a result. Messages with
 * nothing to stub keep their reference; nothing is mutated.
 */
export function stubOldToolOutputs<M extends UIMessage>(messages: M[]): M[] {
  let lastAssistant = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') { lastAssistant = i; break }
  }

  let changed = false
  const out = messages.map((message, i) => {
    if (i === lastAssistant || message.role !== 'assistant') return message
    let partsChanged = false
    const parts = message.parts.map(part => {
      const stub = stubFor(part as ToolPartLike)
      if (!stub) return part
      partsChanged = true
      return { ...part, output: stub }
    })
    if (!partsChanged) return message
    changed = true
    return { ...message, parts } as M
  })
  return changed ? out : messages
}

/**
 * The DB row id of a message when it is known: a loaded message carries it as its
 * id; a live assistant message carries it in its turn metadata. A live user
 * message has none of its own — it is placed by the assistant reply around it.
 */
function knownDbId(message: UIMessage): number | null {
  if (isDbMessageId(message.id)) return Number(message.id)
  if (message.role === 'assistant') return readTurnMetadata(message)?.assistantMessageDbId ?? null
  return null
}

/**
 * The recent messages to send in full alongside the summary: every message newer
 * than the summary boundary (`summaryUpToMessageId`, a `messages.id`), at least
 * `min`, capped at `max`. With no summary it is the history itself, capped at
 * `max`. When the boundary cannot be placed in the history it errs toward
 * sending more (up to `max`) — an overlap with the summary is harmless, a gap is
 * not. A cut that would open the window on a reply steps back one to include the
 * user message it answers. Returns the input array when nothing is trimmed.
 */
export function recentTail<M extends UIMessage>(
  messages: M[],
  summaryUpToMessageId: number | null,
  min = RECENT_MIN,
  max = RECENT_MAX,
): M[] {
  let newer = messages.length
  if (summaryUpToMessageId != null) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = knownDbId(messages[i])
      if (id !== null && id <= summaryUpToMessageId) { newer = messages.length - 1 - i; break }
    }
  }
  const keep = Math.min(max, Math.max(min, newer))
  if (messages.length <= keep) return messages
  let start = messages.length - keep
  if (messages[start].role !== 'user' && start > 0) start -= 1
  return messages.slice(start)
}

/**
 * The DB row ids of the messages actually sent to the model (the output of
 * `recentTail`), plus the turn's own user row — what semantic retrieval must
 * leave out (audit B9). A live user message has no id of its own; the reply
 * after it carries it in its turn metadata, so it is taken from there, and only
 * when that user message was sent too. Messages trimmed off the front are NOT
 * listed: they are in no other layer, so retrieval may still surface them.
 *
 * Known edge: a stopped or failed reply never gets `assistantMessageDbId` in the
 * client's metadata (no `finish` chunk), so its saved row is not listed here and
 * can be sent and also retrieved once it is embedded.
 */
export function sentMessageDbIds(sent: UIMessage[], currentUserMessageDbId: number | null): number[] {
  const ids = new Set<number>()
  sent.forEach((message, i) => {
    const id = knownDbId(message)
    if (id !== null) ids.add(id)
    const prev = i > 0 ? sent[i - 1] : undefined
    if (message.role === 'assistant' && prev?.role === 'user' && knownDbId(prev) === null) {
      const userId = readTurnMetadata(message)?.userMessageDbId
      if (userId != null) ids.add(userId)
    }
  })
  if (currentUserMessageDbId != null) ids.add(currentUserMessageDbId)
  return [...ids]
}
