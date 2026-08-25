// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getMonthlyUsageByModel: vi.fn(),
}))

import { getMonthlyUsageByModel } from '@/app/actions'
import { UsageSettingsTab } from '@/components/settings/UsageSettingsTab'
import type { Model, MonthlyUsageRow } from '@/types'

const mockGetUsage = getMonthlyUsageByModel as ReturnType<typeof vi.fn>

const BASE_CAPS = { supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as const, supportsThinking: true, supportsImageInput: true, supportsStructuredOutputs: true }
const BASE_PRICING = { inputPerMTok: 1, outputPerMTok: 1, estimated: false }
function model(id: string, name: string, family: string): Model {
  return { name, model: id, digest: 'sha256:test', provider: 'anthropic', family, capabilities: { ...BASE_CAPS, effortLevels: [...BASE_CAPS.effortLevels] }, pricing: BASE_PRICING }
}
const MODELS: Model[] = [model('claude-opus-4-8', 'Claude Opus 4.8', 'opus')]

describe('UsageSettingsTab', () => {
  beforeEach(() => { mockGetUsage.mockReset() })

  it('requests the trailing 3-month window', async () => {
    mockGetUsage.mockResolvedValue([])
    render(<UsageSettingsTab models={[]} />)
    await screen.findByText(/No spend recorded yet/i)
    expect(mockGetUsage).toHaveBeenCalledWith(3)
  })

  it('shows an intentional empty state when there is no spend yet', async () => {
    mockGetUsage.mockResolvedValue([])
    render(<UsageSettingsTab models={[]} />)
    expect(await screen.findByText(/No spend recorded yet/i)).toBeTruthy()
  })

  it('renders the monthly total and resolves the model label via the live models list', async () => {
    const rows: MonthlyUsageRow[] = [
      { month: '2026-08', model: 'claude-opus-4-8', costUsd: 1.5, inputTokens: 1000, outputTokens: 500, estimated: false },
    ]
    mockGetUsage.mockResolvedValue(rows)
    render(<UsageSettingsTab models={MODELS} />)
    expect(await screen.findByText('August 2026')).toBeTruthy()
    expect(screen.getByText('Claude Opus 4.8')).toBeTruthy()
    // Single model this month: the month total and the per-model figure agree.
    expect(screen.getAllByText('$1.50')).toHaveLength(2)
  })

  it('renders a non-Anthropic $0/estimated row as "unpriced" (not "$0.00"), with a real label and its real token count visible', async () => {
    const rows: MonthlyUsageRow[] = [
      { month: '2026-08', model: 'claude-opus-4-8', costUsd: 2.5, inputTokens: 1000, outputTokens: 500, estimated: false },
      { month: '2026-08', model: 'gemini-3.5-flash', costUsd: 0, inputTokens: 140, outputTokens: 40, estimated: true },
    ]
    mockGetUsage.mockResolvedValue(rows)
    render(<UsageSettingsTab models={[]} />)
    expect(await screen.findByText('unpriced')).toBeTruthy()
    // The unpriced row's own cell never renders "$0.00" — and the month total
    // is the real (nonzero) Claude spend, not zeroed out by the unpriced row.
    expect(screen.queryByText('$0.00')).toBeNull()
    // $2.50 appears twice: the month total and the Claude row's own figure
    // (they agree here because the unpriced row contributes $0).
    expect(screen.getAllByText('$2.50')).toHaveLength(2)
    // Tokens are shown, not dropped, for the unpriced row.
    expect(screen.getByText('180 tok')).toBeTruthy()
    // The raw id never leaks into the label — "unpriced" needs a real name
    // next to it to mean anything.
    expect(screen.getByText('Gemini Flash (housekeeping)')).toBeTruthy()
    expect(screen.queryByText('3.5-flash')).toBeNull()
  })

  it('renders the month TOTAL as "unpriced" (not "$0.00") when every row that month is the unpriced sentinel', async () => {
    const rows: MonthlyUsageRow[] = [
      { month: '2026-08', model: 'gemini-3.5-flash', costUsd: 0, inputTokens: 14, outputTokens: 4, estimated: true },
    ]
    mockGetUsage.mockResolvedValue(rows)
    render(<UsageSettingsTab models={[]} />)
    await screen.findByText('August 2026')
    // Both the row cell and the month total say "unpriced".
    expect(screen.getAllByText('unpriced')).toHaveLength(2)
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('shows a real "$0.00" month total when a real (non-estimated) Claude row genuinely sums to zero', async () => {
    // Distinguishes "the aggregate happens to be zero because real activity
    // was zero-cost" from "the aggregate is zero because every row is the
    // unpriced sentinel" — only the latter should render as "unpriced".
    const rows: MonthlyUsageRow[] = [
      { month: '2026-08', model: 'claude-opus-4-8', costUsd: 0, inputTokens: 0, outputTokens: 0, estimated: false },
    ]
    mockGetUsage.mockResolvedValue(rows)
    render(<UsageSettingsTab models={[]} />)
    await screen.findByText('August 2026')
    expect(screen.getAllByText('$0.00')).toHaveLength(2)
    expect(screen.queryByText('unpriced')).toBeNull()
  })

  it('shows a distinct error state (not the empty state) when the fetch fails, and logs the failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUsage.mockRejectedValue(new Error('relation "usage_events" does not exist'))
    render(<UsageSettingsTab models={[]} />)
    expect(await screen.findByText(/Couldn.t load usage/i)).toBeTruthy()
    expect(screen.queryByText(/No spend recorded yet/i)).toBeNull()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('flags a real dollar-contributing estimate with "est." on both the row and the month total', async () => {
    const rows: MonthlyUsageRow[] = [
      { month: '2026-08', model: 'claude-sonnet-9-unknown', costUsd: 0.5, inputTokens: 10, outputTokens: 10, estimated: true },
    ]
    mockGetUsage.mockResolvedValue(rows)
    render(<UsageSettingsTab models={[]} />)
    await screen.findByText('August 2026')
    // Month total: "$0.50" plus a separate "est." badge element.
    expect(screen.getByText('$0.50')).toBeTruthy()
    expect(screen.getByText('est.')).toBeTruthy()
    // Row: cost + estimate suffix in one cell.
    expect(screen.getByText('$0.50 est.')).toBeTruthy()
  })

  it('does not flag "est." when no row is estimated', async () => {
    const rows: MonthlyUsageRow[] = [
      { month: '2026-08', model: 'claude-opus-4-8', costUsd: 1, inputTokens: 10, outputTokens: 10, estimated: false },
    ]
    mockGetUsage.mockResolvedValue(rows)
    render(<UsageSettingsTab models={[]} />)
    await screen.findByText('August 2026')
    expect(screen.queryByText('est.')).toBeNull()
  })
})
