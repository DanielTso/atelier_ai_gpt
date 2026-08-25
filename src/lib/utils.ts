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

// Trims trailing zeros off a toFixed() string, never below 2 decimals (so
// "0.00500000" -> "0.005", but "0.00000000" stays "0.00", not "0.").
function trimTrailingZeros(fixed: string): string {
  let s = fixed.replace(/0+$/, '')
  if (s.endsWith('.')) s += '00'
  const dot = s.indexOf('.')
  const decimals = s.length - dot - 1
  if (decimals < 2) s += '0'.repeat(2 - decimals)
  return s
}

/**
 * Format a USD amount for a spend view. Two tiers, both empirically checked
 * against real Node output (Intl's `roundingPriority: 'morePrecision'` was
 * tried first — it looked like the idiomatic single-formatter fix, but it
 * drops the trailing zero on a value like 0.5 -> "$0.5" instead of "$0.50",
 * because when a value is already exact at fewer digits it's judged "more
 * precise" than the 2-decimal-padded form; not safe for a currency display):
 *
 * - >= 1 cent: standard 2-decimal currency via toLocaleString, which gives
 *   thousands grouping for free ($1,234.50, not $1234.50) and — unlike
 *   Number.toFixed — rounds .005-boundary values the way a person expects
 *   (1.005 -> "$1.01", not the "$1.00" toFixed(2) gives due to 1.005's
 *   binary floating-point representation being fractionally under it).
 * - < 1 cent: up to 8 decimals — usage_events.cost_usd's own numeric(12,8)
 *   scale — trimmed to the value's real precision (never padded with
 *   trailing zeros). Any value that column can actually store as nonzero is
 *   representable within 8 decimals, so a real tiny frozen cost (e.g.
 *   $0.00003) can never round away to a misleading "$0.00" the way a fixed
 *   2-4 decimal formatter could.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00'
  if (Math.abs(usd) < 0.01) return `$${trimTrailingZeros(usd.toFixed(8))}`
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * A usage row this feature deliberately does not token-price (the internal
 * gemini-3.5-flash housekeeping model, or any other non-Anthropic id) is
 * written cost_usd=0, cost_estimated=true — the exact same tuple a genuine
 * zero-cost Claude row could carry. Rendering that tuple as "$0.00" reads as
 * "free" when the truth is "not priced by this system". Callers must render
 * an unpriced row as "unpriced" (or equivalent), never a dollar figure — but
 * still show it (the tokens are real), never drop it.
 */
export function isUnpricedUsage(model: string, costUsd: number, estimated: boolean): boolean {
  return !model.startsWith('claude-') && costUsd === 0 && estimated
}
