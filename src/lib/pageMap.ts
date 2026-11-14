import { PAGE_ANCHOR_RE } from '@/lib/documents/windowing'

export function buildPageMap(fullText: string): { page: number; start: number }[] {
  const map: { page: number; start: number }[] = []
  for (const m of fullText.matchAll(PAGE_ANCHOR_RE)) {
    map.push({ page: Number(m[1]), start: m.index ?? 0 })
  }
  return map
}

export function pageRangeFor(
  map: { page: number; start: number }[], start: number, end: number,
): { pageStart: number; pageEnd: number } | null {
  if (map.length === 0) return null
  let pageStart = map[0].page
  let pageEnd = map[0].page
  for (const a of map) {
    if (a.start <= start) pageStart = a.page
    if (a.start < end) pageEnd = a.page
    else break
  }
  return { pageStart, pageEnd }
}

/** Provenance header prepended to vision-derived text runs so it lands inside
 * chunk content and flows into retrieval context (same pattern as web ingest's
 * Source: header). */
export function visionRunHeader(first: number, last: number): string {
  return first === last ? `[page ${first} · vision]` : `[pages ${first}–${last} · vision]`
}

const LEADING_ANCHOR_RE = /^# Page (\d+)[ \t]*(?:\r?\n|$)/

/** A vision run as it goes into the document text: its page anchor first, then
 * the provenance header, then the transcription. The model is prompted to open
 * each page with "# Page <n>"; that leading heading is moved above the header,
 * and a run that came back without one gets "# Page <first>" (audit X1). With
 * the anchor first, the header belongs to its own page for pageMap and for
 * read_document windows, which start and end on anchors. */
export function visionRunText(first: number, last: number, text: string): string {
  const header = visionRunHeader(first, last)
  const lead = LEADING_ANCHOR_RE.exec(text)
  if (lead) return `# Page ${lead[1]}\n${header}\n${text.slice(lead[0].length)}`
  return `# Page ${first}\n${header}\n${text}`
}

/** The per-page hybrid splice: each text-path page under its own "# Page n"
 * anchor, and each vision run (in page order) in place of the pages it covers.
 * Every page then carries an anchor, so pageMap stamps each chunk with its real
 * page; with anchors only inside the vision runs, a 40-page set with one run on
 * page 4 stamped every chunk {4,4} (audit X1). */
export function spliceHybridPages(
  pageTexts: string[],
  segments: { firstPage: number; lastPage: number; text: string }[],
): string {
  const byStart = new Map(segments.map(s => [s.firstPage, s]))
  const covered = new Set(segments.flatMap(s =>
    Array.from({ length: s.lastPage - s.firstPage + 1 }, (_, k) => s.firstPage + k)))
  const parts: string[] = []
  pageTexts.forEach((t, i) => {
    const page = i + 1
    const seg = byStart.get(page)
    if (seg) parts.push(visionRunText(seg.firstPage, seg.lastPage, seg.text))
    else if (!covered.has(page)) parts.push(`# Page ${page}\n${t}`)
  })
  return parts.join('\n')
}
