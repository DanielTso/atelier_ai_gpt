// Citation marker grammar — a pure, client/server-safe library shared by the
// server (compliance counting) and the client (chip rendering).
//
// Grammar (four forms):
//   [cite:12]        → { docId: 12 }
//   [cite:12 p34]    → { docId: 12, page: 34 }
//   [cite:12 p34-36] → { docId: 12, page: 34, pageEnd: 36 }
//   [cite:12 c456]   → { docId: 12, chunkId: 456 }
//
// Regex-state hazard: CITE_RE carries the /g flag, so its `lastIndex` is
// mutable across `.exec()`/`.test()` calls. Nothing here calls those on the
// shared export — parseCitation builds a fresh anchored regex, splitOnCitations
// builds a fresh global regex for `matchAll`. Never `.test()`/`.exec()` CITE_RE
// directly or repeated calls will desync.
export const CITE_RE = /\[cite:(\d+)(?:\s+(?:p(\d+)(?:-(\d+))?|c(\d+)))?\]/g

// Loose marker shape: bracket + cite prefix + digits, up to the closing bracket.
// Matches every token CITE_RE matches PLUS intended-but-malformed variants
// ([cite:12 p.34], en-dash ranges, [cite: 12], [cite:1 x9]). Used to (a) scope
// normalizeCitationText so it never rewrites general prose and (b) let the
// renderer strip cite-intended tokens that still fail the grammar, and the
// compliance log count them. Same /g lastIndex hazard as CITE_RE — always
// rebuild a fresh regex from `.source` before matching.
export const LOOSE_CITE_RE = /\[cite:\s*\d+[^\]]*\]/g

// Normalize display-form deviations INSIDE loose cite tokens to the canonical
// CITE_RE grammar: an en dash (U+2013) between digits becomes a hyphen
// ("p34–36" → "p34-36") and "p." directly before a digit becomes "p"
// ("p.34" → "p34"). Deliberately conservative: replacements run only within
// LOOSE_CITE_RE matches, so en dashes and "p." in ordinary prose are never
// touched, and canonical tokens pass through unchanged (idempotent).
export function normalizeCitationText(text: string): string {
  return text.replace(new RegExp(LOOSE_CITE_RE.source, 'g'), (token) =>
    token.replace(/(\d)–(\d)/g, '$1-$2').replace(/p\.(?=\d)/g, 'p'),
  )
}

export interface Citation {
  docId: number
  page?: number
  pageEnd?: number
  chunkId?: number
}

// Parse a single token. Returns a Citation only when the WHOLE string is a
// valid marker; any garbage ([cite:], [cite:abc], [cite:1 x9], [cite:1 p],
// unclosed/nested) yields null. Uses a fresh anchored regex — no shared state.
export function parseCitation(token: string): Citation | null {
  const re = new RegExp(`^${CITE_RE.source}$`)
  const m = re.exec(token)
  if (!m) return null
  const cite: Citation = { docId: Number(m[1]) }
  if (m[2] !== undefined) {
    cite.page = Number(m[2])
    if (m[3] !== undefined) cite.pageEnd = Number(m[3])
  }
  if (m[4] !== undefined) cite.chunkId = Number(m[4])
  return cite
}

// Split text into ordered text runs and cite tokens. Only well-formed markers
// (matched by CITE_RE, which encodes the grammar) become 'cite' runs — an
// unparseable '[cite:…]'-looking token never matches the grammar and so stays
// inside the surrounding 'text' run. Strip/render decisions live in the caller.
export function splitOnCitations(
  text: string,
): Array<
  | { type: 'text'; value: string }
  | { type: 'cite'; cite: Citation; raw: string }
> {
  const runs: Array<
    | { type: 'text'; value: string }
    | { type: 'cite'; cite: Citation; raw: string }
  > = []
  const re = new RegExp(CITE_RE.source, CITE_RE.flags)
  let lastIndex = 0
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const start = m.index
    const cite = parseCitation(raw)
    // Defensive: a CITE_RE match always reparses, but if it somehow didn't we
    // leave the token in the text by not advancing past it.
    if (!cite) continue
    if (start > lastIndex) {
      runs.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    runs.push({ type: 'cite', cite, raw })
    lastIndex = start + raw.length
  }
  if (lastIndex < text.length) {
    runs.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return runs
}

// Streaming safety: while a marker is mid-emission the tail can be a partial
// '[cite:…' with no closing ']'. Trim ONLY that trailing incomplete prefix so a
// half-marker never flashes as literal text. A completed marker, or a '[cite:'
// that has any ']' after it, passes through untouched.
export function hideIncompleteTrailingCite(text: string): string {
  const i = text.lastIndexOf('[cite:')
  if (i === -1) return text
  // A closing bracket anywhere after the last '[cite:' means it isn't a bare
  // trailing partial — leave it for splitOnCitations/parseCitation to judge.
  if (text.indexOf(']', i) !== -1) return text
  return text.slice(0, i)
}
