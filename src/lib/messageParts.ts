// Single source of truth for pulling text out of an AI SDK message's `parts`
// array. Previously duplicated (with three slightly different typings) across the
// chat page, the classify/memory-suggest routes, and the retrieval pipeline.

type TextPart = { type: string; text?: string | null }

/** Concatenate the text of all `text` parts. Safe on undefined/empty. */
export function extractText(parts: readonly TextPart[] | undefined | null): string {
  if (!parts) return ''
  return parts
    .filter(p => p.type === 'text')
    .map(p => p.text ?? '')
    .join('')
}

/** Text of a message, preferring `parts` and falling back to a legacy `content`. */
export function messageText(m: { parts?: readonly TextPart[] | null; content?: string | null }): string {
  if (m.parts) return extractText(m.parts)
  return m.content ?? ''
}
