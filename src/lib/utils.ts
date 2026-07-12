import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** [12,13,14,30] → "12–14, 30" — compact page-run formatting for badges/tooltips. */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const runs: string[] = []
  let start = -1, prev = -1
  for (const p of sorted) {
    if (start === -1) { start = prev = p; continue }
    if (p === prev + 1) { prev = p; continue }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = prev = p
  }
  if (start !== -1) runs.push(start === prev ? `${start}` : `${start}–${prev}`)
  return runs.join(', ')
}
