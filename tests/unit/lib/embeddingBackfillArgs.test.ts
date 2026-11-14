import { describe, it, expect } from 'vitest'
import { parseBackfillArgs } from '@/lib/embeddingBackfillArgs'

describe('parseBackfillArgs', () => {
  it('defaults to limit 200, no since, a real run', () => {
    expect(parseBackfillArgs([])).toEqual({ limit: 200, since: undefined, dryRun: false, help: false })
  })

  it('reads --since, --limit and --dry-run, in either --flag value or --flag=value form', () => {
    expect(parseBackfillArgs(['--since', '2026-10-16', '--limit', '50', '--dry-run'])).toEqual({
      since: new Date('2026-10-16'), limit: 50, dryRun: true, help: false,
    })
    expect(parseBackfillArgs(['--since=2026-10-16T00:00:00Z', '--limit=1000'])).toEqual({
      since: new Date('2026-10-16T00:00:00Z'), limit: 1000, dryRun: false, help: false,
    })
  })

  it('recognises --help and -h', () => {
    expect(parseBackfillArgs(['--help']).help).toBe(true)
    expect(parseBackfillArgs(['-h']).help).toBe(true)
  })

  it('rejects a bad date, a bad or out-of-range limit, a missing value and an unknown flag', () => {
    expect(() => parseBackfillArgs(['--since', 'yesterday'])).toThrow(/--since/)
    expect(() => parseBackfillArgs(['--limit', 'abc'])).toThrow(/--limit/)
    expect(() => parseBackfillArgs(['--limit', '0'])).toThrow(/--limit/)
    expect(() => parseBackfillArgs(['--limit', '1001'])).toThrow(/--limit/)
    expect(() => parseBackfillArgs(['--limit', '2.5'])).toThrow(/--limit/)
    expect(() => parseBackfillArgs(['--since'])).toThrow(/--since/)
    expect(() => parseBackfillArgs(['--force'])).toThrow(/--force/)
  })
})
