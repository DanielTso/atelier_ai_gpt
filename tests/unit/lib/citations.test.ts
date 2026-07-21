import { describe, it, expect } from 'vitest'
import {
  CITE_RE,
  parseCitation,
  splitOnCitations,
  hideIncompleteTrailingCite,
} from '@/lib/citations'

describe('CITE_RE', () => {
  it('is a global regex (splitOnCitations relies on matchAll)', () => {
    expect(CITE_RE.flags).toContain('g')
  })
})

describe('parseCitation — the four grammar forms', () => {
  it('[cite:12] → docId only', () => {
    expect(parseCitation('[cite:12]')).toEqual({ docId: 12 })
  })

  it('[cite:12 p34] → docId + page', () => {
    expect(parseCitation('[cite:12 p34]')).toEqual({ docId: 12, page: 34 })
  })

  it('[cite:12 p34-36] → docId + page + pageEnd', () => {
    expect(parseCitation('[cite:12 p34-36]')).toEqual({
      docId: 12,
      page: 34,
      pageEnd: 36,
    })
  })

  it('[cite:12 c456] → docId + chunkId', () => {
    expect(parseCitation('[cite:12 c456]')).toEqual({ docId: 12, chunkId: 456 })
  })

  it('handles multi-digit ids and single-digit docId', () => {
    expect(parseCitation('[cite:7]')).toEqual({ docId: 7 })
    expect(parseCitation('[cite:1000 p1-2]')).toEqual({
      docId: 1000,
      page: 1,
      pageEnd: 2,
    })
  })

  it('accepts multiple spaces before the modifier (\\s+ is one-or-more)', () => {
    expect(parseCitation('[cite:12  p3]')).toEqual({ docId: 12, page: 3 })
  })
})

describe('parseCitation — garbage returns null', () => {
  it.each([
    ['[cite:]', 'no docId'],
    ['[cite:abc]', 'non-numeric docId'],
    ['[cite:1 x9]', 'unknown modifier'],
    ['[cite:1 p]', 'p with no page number'],
    ['[cite:1 c]', 'c with no chunk number'],
    ['[cite:1 p3-]', 'dangling page range'],
    ['[cite:12', 'unclosed'],
    ['cite:12]', 'missing opening bracket'],
    ['[cite:12 p3', 'unclosed with page'],
    ['[cite:[cite:12]]', 'nested'],
    ['[cite:12] extra', 'trailing text after marker'],
    ['prefix [cite:12]', 'leading text before marker'],
    [' [cite:12] ', 'surrounding whitespace'],
    ['', 'empty string'],
    ['[cite:1.5]', 'decimal docId'],
    ['[cite:-1]', 'negative docId'],
  ])('parseCitation(%j) → null (%s)', (token) => {
    expect(parseCitation(token)).toBeNull()
  })
})

describe('parseCitation — regex-state safety (no shared lastIndex)', () => {
  it('repeated identical calls return identical results', () => {
    const a = parseCitation('[cite:12 p3]')
    const b = parseCitation('[cite:12 p3]')
    const c = parseCitation('[cite:12 p3]')
    expect(a).toEqual({ docId: 12, page: 3 })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('does not mutate the shared CITE_RE lastIndex', () => {
    parseCitation('[cite:12]')
    splitOnCitations('a [cite:1] b [cite:2] c')
    expect(CITE_RE.lastIndex).toBe(0)
  })
})

describe('splitOnCitations', () => {
  it('returns [] for empty string', () => {
    expect(splitOnCitations('')).toEqual([])
  })

  it('returns a single text run when there are no markers', () => {
    expect(splitOnCitations('just plain text')).toEqual([
      { type: 'text', value: 'just plain text' },
    ])
  })

  it('splits a single marker with surrounding text, order preserved', () => {
    expect(splitOnCitations('before [cite:12] after')).toEqual([
      { type: 'text', value: 'before ' },
      { type: 'cite', cite: { docId: 12 }, raw: '[cite:12]' },
      { type: 'text', value: ' after' },
    ])
  })

  it('handles a marker at the very start (no leading text run)', () => {
    expect(splitOnCitations('[cite:12] tail')).toEqual([
      { type: 'cite', cite: { docId: 12 }, raw: '[cite:12]' },
      { type: 'text', value: ' tail' },
    ])
  })

  it('handles a marker at the very end (no trailing text run)', () => {
    expect(splitOnCitations('head [cite:12]')).toEqual([
      { type: 'text', value: 'head ' },
      { type: 'cite', cite: { docId: 12 }, raw: '[cite:12]' },
    ])
  })

  it('preserves interleaved text runs across multiple markers', () => {
    expect(
      splitOnCitations('A [cite:1 p2] B [cite:3 c4] C [cite:5 p6-7] D'),
    ).toEqual([
      { type: 'text', value: 'A ' },
      { type: 'cite', cite: { docId: 1, page: 2 }, raw: '[cite:1 p2]' },
      { type: 'text', value: ' B ' },
      { type: 'cite', cite: { docId: 3, chunkId: 4 }, raw: '[cite:3 c4]' },
      { type: 'text', value: ' C ' },
      {
        type: 'cite',
        cite: { docId: 5, page: 6, pageEnd: 7 },
        raw: '[cite:5 p6-7]',
      },
      { type: 'text', value: ' D' },
    ])
  })

  it('handles adjacent markers with no text between', () => {
    expect(splitOnCitations('[cite:1][cite:2]')).toEqual([
      { type: 'cite', cite: { docId: 1 }, raw: '[cite:1]' },
      { type: 'cite', cite: { docId: 2 }, raw: '[cite:2]' },
    ])
  })

  it('handles a marker adjacent to punctuation', () => {
    expect(splitOnCitations('The sky is blue[cite:12].')).toEqual([
      { type: 'text', value: 'The sky is blue' },
      { type: 'cite', cite: { docId: 12 }, raw: '[cite:12]' },
      { type: 'text', value: '.' },
    ])
  })

  it('leaves an UNPARSEABLE [cite:…]-looking token inside the text run', () => {
    expect(splitOnCitations('foo [cite:abc] bar')).toEqual([
      { type: 'text', value: 'foo [cite:abc] bar' },
    ])
  })

  it('leaves [cite:1 x9] as text but still splits a valid neighbour', () => {
    expect(splitOnCitations('x [cite:1 x9] y [cite:2] z')).toEqual([
      { type: 'text', value: 'x [cite:1 x9] y ' },
      { type: 'cite', cite: { docId: 2 }, raw: '[cite:2]' },
      { type: 'text', value: ' z' },
    ])
  })

  it('repeated identical calls return identical results (state safety)', () => {
    const input = 'a [cite:1] b [cite:2 p3] c'
    const first = splitOnCitations(input)
    const second = splitOnCitations(input)
    expect(second).toEqual(first)
    expect(splitOnCitations(input)).toEqual(first)
  })
})

describe('hideIncompleteTrailingCite', () => {
  it('trims a trailing partial [cite:… with no closing bracket', () => {
    expect(hideIncompleteTrailingCite('…text [cite:12 p3')).toBe('…text ')
  })

  it('trims a bare trailing [cite:', () => {
    expect(hideIncompleteTrailingCite('hello [cite:')).toBe('hello ')
  })

  it('trims a trailing partial that follows an earlier complete marker', () => {
    expect(hideIncompleteTrailingCite('text [cite:12] and [cite:3')).toBe(
      'text [cite:12] and ',
    )
  })

  it('leaves a complete trailing marker untouched', () => {
    expect(hideIncompleteTrailingCite('text [cite:12]')).toBe('text [cite:12]')
  })

  it('leaves a complete marker with page untouched', () => {
    expect(hideIncompleteTrailingCite('text [cite:12 p3-4] more')).toBe(
      'text [cite:12 p3-4] more',
    )
  })

  it('leaves a mid-text [cite: that is later closed by ] untouched', () => {
    expect(hideIncompleteTrailingCite('a [cite: weird ] b')).toBe(
      'a [cite: weird ] b',
    )
  })

  it('returns text with no [cite: unchanged', () => {
    expect(hideIncompleteTrailingCite('plain text, no markers')).toBe(
      'plain text, no markers',
    )
  })

  it('returns empty string unchanged', () => {
    expect(hideIncompleteTrailingCite('')).toBe('')
  })

  it('only trims from the LAST [cite: — earlier closed markers survive', () => {
    expect(
      hideIncompleteTrailingCite('one [cite:1] two [cite:2] three [cite:3 p'),
    ).toBe('one [cite:1] two [cite:2] three ')
  })

  it('repeated identical calls return identical results (state safety)', () => {
    const input = '…text [cite:12 p3'
    const a = hideIncompleteTrailingCite(input)
    const b = hideIncompleteTrailingCite(input)
    expect(a).toBe('…text ')
    expect(b).toBe(a)
  })
})
