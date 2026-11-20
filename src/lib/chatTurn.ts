// One chat turn = the user's message plus the assistant's reply to it. `/api/chat`
// persists both rows server-side, bound to the request's chat, and reports their ids
// to the client as assistant-message metadata. This module is the shared contract:
// the metadata shape, its client-side reader, and the server-side recorder that
// turns the model stream into exactly one assistant row. It imports types only, so
// it is safe in both the route and client hooks.
import type { TextStreamPart, ToolSet } from 'ai'

/**
 * Server-authoritative ids for a turn, sent as the assistant UI message's metadata.
 * `projectId` is read from the chat's DB row — never from the client's nav state.
 *
 * - On the `start` chunk: `assistantMessageDbId` is usually null (no reply row yet;
 *   a streaming checkpoint can occasionally land first, so do not rely on it).
 * - On the `finish` chunk: `assistantMessageDbId` is the saved row, or null when
 *   the turn produced nothing to save.
 * - A stopped/failed turn never receives `finish`; the server still saves the
 *   partial reply, and the client looks the row up (see `useChatPersistence`),
 *   then writes the found id into the reply's metadata.
 * - `userMessageDbId` is the user row this reply answers: the row the request
 *   inserted, or, on a regenerate, the existing row (nothing is inserted). It is
 *   null when the request's last message was already a DB row on an ordinary send
 *   (nothing was inserted for it).
 */
export type TurnMetadata = {
  chatId: number
  projectId: number | null
  userMessageDbId: number | null
  assistantMessageDbId: number | null
}

const isRowId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

/** Parse turn metadata off an assistant message; null if the server sent none. */
export function readTurnMetadata(message: { metadata?: unknown } | null | undefined): TurnMetadata | null {
  const m = message?.metadata
  if (!m || typeof m !== 'object') return null
  const raw = m as Record<string, unknown>
  if (!isRowId(raw.chatId)) return null
  return {
    chatId: raw.chatId,
    projectId: isRowId(raw.projectId) ? raw.projectId : null,
    userMessageDbId: isRowId(raw.userMessageDbId) ? raw.userMessageDbId : null,
    assistantMessageDbId: isRowId(raw.assistantMessageDbId) ? raw.assistantMessageDbId : null,
  }
}

const INT4_MAX = 2147483647

/**
 * True when a UI message id is a stringified `messages.id` — i.e. the message was
 * loaded from the DB (`loadMessages` assigns `String(row.id)`) and must not be
 * inserted again. Messages created by `useChat` carry the SDK's 16-character
 * generated id, which can never match (at most 10 digits here).
 */
export function isDbMessageId(id: unknown): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= INT4_MAX
}

/**
 * The DB row id of `messages[index]` in a client transcript, or null when it is
 * not known (yet). Client ids are never rewritten to DB ids, so:
 *
 * - a message loaded from the DB carries its row id as its own id;
 * - a reply sent this session carries it in its turn metadata (for a stopped
 *   turn, once `useChatPersistence` has looked it up);
 * - a user message sent this session has no metadata of its own — its row id
 *   rides on the metadata of the reply right after it. With no reply after it
 *   (stopped before the first token, or failed before the stream) it is unknown
 *   until the chat is reopened.
 */
export function resolveMessageDbId(
  messages: ReadonlyArray<{ id: string; role: string; metadata?: unknown }>,
  index: number,
): number | null {
  const message = messages[index]
  if (!message) return null
  if (isDbMessageId(message.id)) return Number(message.id)
  if (message.role === 'assistant') return readTurnMetadata(message)?.assistantMessageDbId ?? null
  const next = messages[index + 1]
  if (message.role === 'user' && next?.role === 'assistant') return readTurnMetadata(next)?.userMessageDbId ?? null
  return null
}

/**
 * Does a `tool-result` count as reply content worth a row? Mirrors the client's
 * media-only-turn rule: a generated image (a real one — the tool reports failures
 * in-band as `{ error }`) or an artifact call.
 */
function isMediaToolResult(toolName: string, output: unknown): boolean {
  if (toolName === 'generate_artifact') return true
  if (toolName === 'generate_image') {
    return typeof (output as { storagePath?: unknown } | null | undefined)?.storagePath === 'string'
  }
  return false
}

/**
 * Client mirror of the recorder's persist rule (`persist` below): would the
 * server have saved a row for a reply with these UI parts? Non-blank text (all
 * text parts joined, like the recorder's concatenated deltas), a model-emitted
 * file part, or a finished media tool result (`isMediaToolResult`). Reasoning,
 * step markers and other tool calls (web search) do not count. A regenerate
 * that ends on such a reply saved nothing, so the old reply is still the one in
 * the DB (see `handleRegenerate` in page.tsx).
 */
export function replyHasSavedContent(parts: ReadonlyArray<{ type: string; [key: string]: unknown }>): boolean {
  let text = ''
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') text += part.text
    else if (part.type === 'file') return true
    else if (part.state === 'output-available') {
      const toolName = part.type === 'dynamic-tool'
        ? (typeof part.toolName === 'string' ? part.toolName : '')
        : part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''
      if (toolName && isMediaToolResult(toolName, part.output)) return true
    }
  }
  return text.trim().length > 0
}

export type AssistantTurnRecorderOptions = {
  /** The first write: insert the row (or, on a regenerate, replace the old reply in place). Returns its id. */
  save: (text: string) => Promise<number | null>
  /** A content-only rewrite of the row `save` returned. */
  update: (id: number, text: string) => Promise<void>
  /** Minimum gap between two text-delta checkpoints. */
  checkpointMs?: number
  /** Clock for the checkpoint throttle (injectable for tests). */
  now?: () => number
}

/**
 * Records one assistant turn from the model stream into exactly one row, written
 * while the reply streams and completed when it ends.
 *
 * Wired into `streamText` as an `experimental_transform`, which sits on the base
 * stream that `result.consumeStream()` drains — so it runs to the end whether or
 * not a client is still reading the response. Doing the final write here (instead
 * of in `onFinish`/`onAbort`) buys two things, both verified against ai@6.0.230:
 *
 * 1. Ordering. Every part passes through in order, so on `finish` or `abort` the
 *    accumulated text is exactly what streamed. `onAbort` is called un-awaited
 *    from upstream of the transforms and can run before in-flight deltas land.
 * 2. The id on the wire. `messageMetadata` is a synchronous callback evaluated as
 *    the `finish` part is converted to a UI chunk. Awaiting the write before
 *    forwarding `finish` means the row id exists by then; `onFinish` runs in the
 *    stream's flush, after `finish` has already been forwarded.
 *
 * Checkpoints (audit R2): a function killed mid-stream (timeout, crash, deploy)
 * never reaches `finish`/`abort`/flush, so the row is also written WHILE the reply
 * streams — un-awaited, adding nothing to the stream. The first checkpoint fires as
 * soon as there is savable content (`save`); later ones (`update`) on every
 * `tool-input-start`, `tool-call` and `finish-step` part, and on a text delta once `checkpointMs` has
 * passed since the last write started. A checkpoint is skipped while another write
 * is in flight (dropped, not queued: the next one carries the newer text), when the
 * text has not changed, and once `persist()` has started.
 *
 * The text written is every step's text concatenated — the same thing the client
 * renders (`extractText` joins text parts with ''). A turn with no text and no
 * media writes nothing. A failed write is logged and never breaks the stream; the
 * next checkpoint or `persist()` tries again.
 */
export function createAssistantTurnRecorder({ save, update, checkpointMs = 3000, now = Date.now }: AssistantTurnRecorderOptions) {
  let text = ''
  let hasMedia = false
  let assistantMessageDbId: number | null = null
  // The text the row holds, once a write has landed.
  let writtenText: string | null = null
  let inFlight: Promise<void> | undefined
  let lastWriteStartedAt: number | undefined
  let persisting: Promise<void> | undefined

  // The persist rule — mirrored on the client by `replyHasSavedContent`.
  const hasSavableContent = () => text.trim().length > 0 || hasMedia

  // One write of `snapshot`: insert when no row exists yet (a `save` that
  // resolved null left none), rewrite it afterwards. Never rejects.
  const writeRow = async (snapshot: string) => {
    try {
      if (assistantMessageDbId == null) {
        assistantMessageDbId = await save(snapshot)
        if (assistantMessageDbId != null) writtenText = snapshot
      } else {
        await update(assistantMessageDbId, snapshot)
        writtenText = snapshot
      }
    } catch (e) {
      console.error('[chat] failed to save the assistant message:', e instanceof Error ? e.message : e)
    }
  }

  // Fire-and-forget: the transform never awaits it.
  const checkpoint = () => {
    if (persisting || inFlight || !hasSavableContent()) return
    if (assistantMessageDbId != null && text === writtenText) return
    lastWriteStartedAt = now()
    inFlight = writeRow(text).finally(() => { inFlight = undefined })
  }

  // First call wins; later calls (flush after finish, the route's post-drain
  // catch-all) await the same write. Waits for an in-flight checkpoint first, so
  // writes never overlap and the final text always lands last.
  const persist = (): Promise<void> => {
    persisting ??= (async () => {
      await inFlight
      if (!hasSavableContent()) return
      if (assistantMessageDbId != null && text === writtenText) return
      await writeRow(text)
    })()
    return persisting
  }

  const transform = <TOOLS extends ToolSet>() =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(part, controller) {
        if (part.type === 'text-delta') {
          text += part.text
        } else if (part.type === 'file') {
          hasMedia = true
        } else if (part.type === 'tool-result') {
          if (isMediaToolResult(part.toolName, part.output)) hasMedia = true
        } else if (part.type === 'finish' || part.type === 'abort') {
          // Write BEFORE forwarding, so the id is known when `finish` reaches the
          // UI stream's metadata callback.
          await persist()
        }

        // Step boundaries: text written before a tool (whose input can stream for
        // a long time, e.g. an artifact page) or a step ends does not wait for it.
        if (part.type === 'tool-input-start' || part.type === 'tool-call' || part.type === 'finish-step') {
          checkpoint()
        } else if (lastWriteStartedAt === undefined) {
          // No write yet: checkpoint as soon as there is savable content.
          checkpoint()
        } else if (part.type === 'text-delta' && now() - lastWriteStartedAt >= checkpointMs) {
          checkpoint()
        }
        controller.enqueue(part)
      },
      // The stream closed without a finish/abort part (a provider error part).
      async flush() {
        await persist()
      },
    })

  return {
    /** Pass as `experimental_transform`. */
    transform,
    /** Write the final text (insert, or update the checkpointed row). Idempotent; never rejects. */
    persist,
    /** The row's id — set when the first write lands; null if the turn had nothing to save. */
    assistantMessageDbId: () => assistantMessageDbId,
  }
}
