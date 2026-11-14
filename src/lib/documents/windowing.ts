// Pure window slicer for read_document. Vision/hybrid extractions carry
// "# Page <n>" heading anchors (absolute page numbers — see segmentPrompt in
// visionExtraction.ts and spliceHybridPages in pageMap.ts); text-path
// extractions have none, so the slicer supports both page-anchored and
// raw-offset navigation over the same string.

export interface DocWindow {
  text: string
  startOffset: number
  endOffset: number
  nextOffset: number | null
  firstPage: number | null
  lastPage: number | null
  totalAnchors: number
  pageFound: boolean
}

export const PAGE_ANCHOR_RE = /^# Page (\d+)\s*$/gm

function anchors(full: string): { page: number; index: number }[] {
  const out: { page: number; index: number }[] = []
  for (const m of full.matchAll(PAGE_ANCHOR_RE)) out.push({ page: Number(m[1]), index: m.index ?? 0 })
  return out
}

export function sliceWindow(
  full: string,
  opts: { fromPage?: number; offset?: number; maxChars: number },
): DocWindow {
  const marks = anchors(full)
  let start = opts.offset ?? 0
  const pageFound = true
  if (opts.fromPage != null) {
    const hit = marks.find(a => a.page >= opts.fromPage!)
    if (!hit) {
      return { text: '', startOffset: 0, endOffset: 0, nextOffset: null, firstPage: null, lastPage: null, totalAnchors: marks.length, pageFound: false }
    }
    start = hit.index
  }
  start = Math.max(0, Math.min(start, full.length))
  let end = Math.min(start + opts.maxChars, full.length)
  // Never end mid-page when anchors exist (audit X11): back off to the last
  // anchor after the start and at or before the cap, so the next window opens
  // on "# Page n". With no such anchor, the page the window is in alone exceeds
  // the cap and the raw cut stands. Text before the first anchor (an older
  // vision document's provenance header) is no page of its own: it is never
  // cut off into a window by itself.
  if (end < full.length) {
    const cut = marks.filter(a => a.index > start && a.index <= end).pop()
    const onlyPreamble = cut === marks[0] && start < marks[0]?.index
    if (cut && !onlyPreamble) end = cut.index
  }
  // The page an offset falls in: the last anchor at or before it.
  const pageAt = (offset: number) => marks.filter(a => a.index <= offset).pop()?.page ?? null
  const inWindow = marks.filter(a => a.index >= start && a.index < end)
  const firstPage = pageAt(start) ?? (inWindow.length ? inWindow[0].page : null)
  const lastPage = end > start ? pageAt(end - 1) ?? firstPage : firstPage
  return {
    text: full.slice(start, end),
    startOffset: start,
    endOffset: end,
    nextOffset: end < full.length ? end : null,
    firstPage,
    lastPage,
    totalAnchors: marks.length,
    pageFound,
  }
}
