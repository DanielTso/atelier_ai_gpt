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
