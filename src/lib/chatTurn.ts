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
 * - On the `start` chunk: `assistantMessageDbId` is null (no reply exists yet).
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
 * Records one assistant turn from the model stream and saves it exactly once.
 *
 * Wired into `streamText` as an `experimental_transform`, which sits on the base
 * stream that `result.consumeStream()` drains — so it runs to the end whether or
 * not a client is still reading the response. Doing the write here (instead of in
 * `onFinish`/`onAbort`) buys two things, both verified against ai@6.0.230:
 *
 * 1. Ordering. Every part passes through in order, so on `finish` or `abort` the
 *    accumulated text is exactly what streamed. `onAbort` is called un-awaited
 *    from upstream of the transforms and can run before in-flight deltas land.
 * 2. The id on the wire. `messageMetadata` is a synchronous callback evaluated as
 *    the `finish` part is converted to a UI chunk. Awaiting the insert before
 *    forwarding `finish` means the row id exists by then; `onFinish` runs in the
 *    stream's flush, after `finish` has already been forwarded.
 *
 * `save` is called with the text of every step concatenated — the same thing the
 * client renders (`extractText` joins text parts with ''). A turn with no text and
 * no media writes nothing. A failed save is logged and leaves the id null; it never
 * breaks the stream.
 */
export function createAssistantTurnRecorder(save: (text: string) => Promise<number | null>) {
  let text = ''
  let hasMedia = false
  let assistantMessageDbId: number | null = null
  let write: Promise<void> | undefined

  // First call wins; later calls (flush after finish, the route's post-drain
  // catch-all) await the same write.
  const persist = (): Promise<void> => {
    write ??= (async () => {
      if (!text.trim() && !hasMedia) return
      try {
        assistantMessageDbId = await save(text)
      } catch (e) {
        console.error('[chat] failed to save the assistant message:', e instanceof Error ? e.message : e)
      }
    })()
    return write
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
          // Save BEFORE forwarding, so the id is known when `finish` reaches the
          // UI stream's metadata callback.
          await persist()
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
    /** Save what was recorded, if nothing has yet. Idempotent; never rejects. */
    persist,
    /** The saved row's id — null until saved, or if the turn had nothing to save. */
    assistantMessageDbId: () => assistantMessageDbId,
  }
}
