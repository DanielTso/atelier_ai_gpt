'use client'

import { memo, useEffect, useState } from 'react'
import { Loader2, Receipt, AlertCircle } from 'lucide-react'
import { getMonthlyUsageByModel } from '@/app/actions'
import { resolveModelLabel } from '@/hooks/usePersonas'
import { formatUsd, isUnpricedUsage } from '@/lib/utils'
import type { Model, MonthlyUsageRow } from '@/types'

interface UsageSettingsTabProps {
  models: Model[]
}

// Trailing months to roll up (incl. the current one) — matches getMonthlyUsageByModel's default.
const MONTHS_BACK = 3

interface MonthGroup {
  month: string
  total: number
  // True only when a row that actually contributed dollars was priced via a
  // family-tier guess — NOT true just because an always-unpriced row (e.g.
  // gemini-3.5-flash) is in the group. That distinction is "unpriced", shown
  // per-row, not "est." (see isUnpricedUsage).
  hasEstimatedPriced: boolean
  // True when EVERY row this month is the unpriced sentinel (cost 0,
  // estimated, non-Claude) — a month with real Claude activity that happens
  // to sum to exactly $0 does NOT set this (that $0 is real and fine to show
  // as "$0.00"). Only used to decide how the month TOTAL renders; per-row
  // rendering already goes through isUnpricedUsage directly.
  allUnpriced: boolean
  rows: MonthlyUsageRow[]
}

function formatMonthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return month
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function groupByMonth(rows: MonthlyUsageRow[]): MonthGroup[] {
  const map = new Map<string, MonthlyUsageRow[]>()
  for (const row of rows) {
    const bucket = map.get(row.month)
    if (bucket) bucket.push(row)
    else map.set(row.month, [row])
  }
  return [...map.entries()]
    .map(([month, monthRows]) => ({
      month,
      total: monthRows.reduce((sum, r) => sum + r.costUsd, 0),
      hasEstimatedPriced: monthRows.some(r => r.estimated && r.costUsd > 0),
      allUnpriced: monthRows.every(r => isUnpricedUsage(r.model, r.costUsd, r.estimated)),
      // Highest spender first — the point of a per-model bar list.
      rows: [...monthRows].sort((a, b) => b.costUsd - a.costUsd),
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
}

// A failed fetch must NOT collapse into the same state as "loaded, zero
// rows" — that reads as "you have spent nothing" when the truth might be
// "the query failed" (today, always true: migration 0018 is unapplied, so
// this throws "relation usage_events does not exist" on every open). Loading
// vs. error vs. ready-with-N-rows are three genuinely different states, kept
// as a discriminated union rather than overloading `rows: [] | null | T[]`.
type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; rows: MonthlyUsageRow[] }

export const UsageSettingsTab = memo(function UsageSettingsTab({ models }: UsageSettingsTabProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    getMonthlyUsageByModel(MONTHS_BACK)
      .then(rows => { if (!cancelled) setState({ status: 'ready', rows }) })
      .catch(err => {
        if (cancelled) return
        console.error('[UsageSettingsTab] failed to load usage rollup', err)
        setState({ status: 'error' })
      })
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-red-400/60" />
        <p className="text-sm font-medium">Couldn&apos;t load usage</p>
        <p className="max-w-[280px] text-xs text-muted-foreground">
          Something went wrong fetching your spend history. Try reopening this tab.
        </p>
      </div>
    )
  }

  const rows = state.rows

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Receipt className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No spend recorded yet</p>
        <p className="max-w-[280px] text-xs text-muted-foreground">
          Once you start chatting, your monthly cost by model will show up here.
        </p>
      </div>
    )
  }

  const months = groupByMonth(rows)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Spend</h3>
        <p className="text-xs text-muted-foreground">
          Cost by model over the last {MONTHS_BACK} months. Figures are frozen at generation time — later price changes never reprice history.
        </p>
      </div>

      {months.map(group => (
        <div key={group.month} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{formatMonthLabel(group.month)}</span>
            <span className="text-sm font-semibold tabular-nums">
              {group.allUnpriced ? 'unpriced' : formatUsd(group.total)}
              {!group.allUnpriced && group.hasEstimatedPriced && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">est.</span>
              )}
            </span>
          </div>
          <div className="space-y-1.5">
            {group.rows.map(row => {
              const unpriced = isUnpricedUsage(row.model, row.costUsd, row.estimated)
              const percent = group.total > 0 ? Math.round((row.costUsd / group.total) * 100) : 0
              const totalTokens = row.inputTokens + row.outputTokens
              return (
                <div key={row.model} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-muted-foreground" title={row.model}>
                    {resolveModelLabel(row.model, models)}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                    {formatTokens(totalTokens)} tok
                  </span>
                  <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/50" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="w-24 shrink-0 truncate text-right tabular-nums text-muted-foreground" title={unpriced ? undefined : `${formatUsd(row.costUsd)}${row.estimated ? ' (estimated)' : ''}`}>
                    {unpriced ? 'unpriced' : `${formatUsd(row.costUsd)}${row.estimated ? ' est.' : ''}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
})
