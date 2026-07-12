// Pure window slicer for read_document. Vision/hybrid extractions carry
// "# Page <n>" heading anchors (absolute page numbers — see segmentPrompt in
// visionExtraction.ts); text-path extractions have none, so the slicer supports
// both page-anchored and raw-offset navigation over the same string.

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

const ANCHOR_RE = /^# Page (\d+)\s*$/gm

function anchors(full: string): { page: number; index: number }[] {
  const out: { page: number; index: number }[] = []
  for (const m of full.matchAll(ANCHOR_RE)) out.push({ page: Number(m[1]), index: m.index ?? 0 })
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
  const end = Math.min(start + opts.maxChars, full.length)
  const inWindow = marks.filter(a => a.index >= start && a.index < end)
  return {
    text: full.slice(start, end),
    startOffset: start,
    endOffset: end,
    nextOffset: end < full.length ? end : null,
    firstPage: inWindow.length ? inWindow[0].page : null,
    lastPage: inWindow.length ? inWindow[inWindow.length - 1].page : null,
    totalAnchors: marks.length,
    pageFound,
  }
}
