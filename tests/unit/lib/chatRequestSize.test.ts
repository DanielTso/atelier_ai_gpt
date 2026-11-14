import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import {
  buildComposerMessage,
  chatRequestSizeError,
  replaceFilePartUrls,
  CHAT_REQUEST_BUDGET_BYTES,
  CHAT_TOO_LARGE_MESSAGE,
  MESSAGE_TOO_LARGE_MESSAGE,
} from '@/lib/chatRequestSize'
import type { AttachedImage } from '@/lib/fileAttachments'

const MB = 1024 * 1024

/** A base64 data URL of roughly `n` characters. */
const dataUrl = (n: number, seed = 'A') => `data:image/jpeg;base64,${seed.repeat(n)}`

function image(name: string, size: number, seed?: string): AttachedImage {
  return { name, mediaType: 'image/jpeg', size, dataUrl: dataUrl(size, seed) }
}

function userTurn(id: string, text: string, urls: string[] = []): UIMessage {
  return {
    id,
    role: 'user',
    parts: [
      ...urls.map(url => ({ type: 'file' as const, mediaType: 'image/jpeg', url })),
      { type: 'text' as const, text },
    ],
  }
}

const reply = (id: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text: 'Noted.' }] })

describe('chatRequestSizeError', () => {
  it('lets a normal turn through', () => {
    const history = [userTurn('u1', 'hello'), reply('a1')]
    expect(chatRequestSizeError(history, { text: 'and then?' })).toBeNull()
  })

  it('refuses a second turn whose history already carries ~2.5 MB of images, with the chat-specific message', () => {
    const earlier = userTurn('u1', 'site photos', [dataUrl(1.25 * MB, 'A'), dataUrl(1.25 * MB, 'B')])
    const history = [earlier, reply('a1')]
    // The new message alone is well inside the per-message image budget.
    const next = buildComposerMessage('one more angle', [], [image('angle.jpg', 2 * MB, 'C')])
    expect(chatRequestSizeError([], next)).toBeNull()
    expect(chatRequestSizeError(history, next)).toBe(CHAT_TOO_LARGE_MESSAGE)
  })

  it('lets the same turn through once the earlier images are stored URLs instead of inline data', () => {
    const a = dataUrl(1.25 * MB, 'A')
    const b = dataUrl(1.25 * MB, 'B')
    const history = replaceFilePartUrls(
      [userTurn('u1', 'site photos', [a, b]), reply('a1')],
      new Map([[a, 'https://storage.example/a.jpg?token=1'], [b, 'https://storage.example/b.jpg?token=2']]),
    )
    const next = buildComposerMessage('one more angle', [], [image('angle.jpg', 2 * MB, 'C')])
    expect(chatRequestSizeError(history, next)).toBeNull()
  })

  it('counts attached file text that earlier turns inlined', () => {
    const history = [userTurn('u1', 'x'.repeat(3.5 * MB)), reply('a1')]
    expect(chatRequestSizeError(history, { text: 'y'.repeat(0.6 * MB) })).toBe(CHAT_TOO_LARGE_MESSAGE)
  })

  it('measures UTF-8 bytes, not characters', () => {
    // 1.5 M three-byte characters: 4.5 MB on the wire though only 1.5 M chars long.
    expect(chatRequestSizeError([], { text: '€'.repeat(1.5 * MB) })).toBe(MESSAGE_TOO_LARGE_MESSAGE)
  })

  it('refuses a message that is too large on its own with the message-specific text', () => {
    expect(chatRequestSizeError([], { text: 'z'.repeat(CHAT_REQUEST_BUDGET_BYTES + 1) })).toBe(MESSAGE_TOO_LARGE_MESSAGE)
  })
})

describe('buildComposerMessage', () => {
  it('inlines attached file text and turns images into file parts', () => {
    const msg = buildComposerMessage('  summarize  ', [
      { name: 'a.txt', type: 'text/plain', size: 3, charCount: 3, textContent: 'abc', truncated: false },
    ], [image('p.jpg', 4)])
    expect(msg.text).toContain('abc')
    expect(msg.text.endsWith('summarize')).toBe(true)
    expect(msg.files).toEqual([{ type: 'file', mediaType: 'image/jpeg', url: dataUrl(4) }])
  })

  it('sends plain text without a files key', () => {
    expect(buildComposerMessage(' hi ', [], [])).toEqual({ text: 'hi' })
  })
})

describe('replaceFilePartUrls', () => {
  it('swaps only the matching file parts and keeps untouched messages identical', () => {
    const a = dataUrl(8, 'A')
    const first = userTurn('u1', 'one', [a, dataUrl(8, 'B')])
    const second = reply('a1')
    const out = replaceFilePartUrls([first, second], new Map([[a, 'https://s/a']]))
    expect(out[1]).toBe(second)
    const urls = out[0].parts.flatMap(p => (p.type === 'file' ? [p.url] : []))
    expect(urls).toEqual(['https://s/a', dataUrl(8, 'B')])
  })

  it('returns the same array when nothing matches', () => {
    const messages = [userTurn('u1', 'one'), reply('a1')]
    expect(replaceFilePartUrls(messages, new Map([['data:x', 'https://s/x']]))).toBe(messages)
  })
})
