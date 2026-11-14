// Untrusted short labels (document filenames, web-page titles) are interpolated
// into the system prompt: the [Project documents] manifest in /api/chat and the
// retrieval source header in src/lib/retrieval.ts. A web page's H1 becomes a
// filename verbatim, so without this a title could close the surrounding quote,
// forge a bracketed source header, open a tag, or start a new prompt line.

// Characters that can delimit or forge prompt structure.
const STRUCTURAL = /["[\]<>`]/g
// C0/C1 controls (incl. \n, \r, \t) — replaced with a space so words stay apart.
const CONTROL = /\p{Cc}/gu
// Invisible format characters (bidi overrides, zero-width joiners/spaces) —
// removed outright so they cannot disguise the label's text.
const FORMAT = /\p{Cf}/gu

/**
 * Make an untrusted label safe to place inside a quoted span of a prompt: strips
 * `"`, `[`, `]`, `<`, `>`, backticks and every control/format character, collapses
 * whitespace, and truncates to `max` code points. May return '' — callers that need
 * a non-empty label supply their own fallback.
 */
export function promptSafeLabel(s: string, max = 120): string {
  const cleaned = s
    .replace(CONTROL, ' ')
    .replace(FORMAT, '')
    .replace(STRUCTURAL, '')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : cleaned
}
