import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { usageEvents } from '@/db/schema'

vi.mock('@/db', () => ({ get db() { return testDb } }))

// Task 11 reads from usage_events (Task 10's frozen-cost ledger). These tests
// seed rows DIRECTLY through the real schema (bypassing recordUsage's pricing
// resolution, which is Task 10's concern) so every assertion below checks the
// rollup SQL's actual grouping/window/filter behavior against real Postgres
// (PGlite) — not a literal the test itself constructed.

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Pinned to day 1 before offsetting months, so e.g. Jan 31 - 1 month can't
// roll into March. Day-of-month is then set explicitly (default 15, safely
// mid-month for every calendar month).
function monthsAgo(n: number, day = 15): Date {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCMonth(d.getUTCMonth() - n)
  d.setUTCDate(day)
  return d
}

type UsageEventInsert = typeof usageEvents.$inferInsert

function usageRow(overrides: Partial<UsageEventInsert> = {}): UsageEventInsert {
  return {
    chatId: null,
    projectId: null,
    purpose: 'chat',
    model: 'claude-opus-4-8',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0.01,
    costEstimated: false,
    createdAt: monthsAgo(0),
    ...overrides,
  }
}

describe('getMonthlyUsageByModel', () => {
  beforeEach(async () => { await createTestDb() })

  it('groups by (month, model): sums cost + all three input columns, bool_or on estimated', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    const thisMonth = monthsAgo(0, 5)
    await testDb.insert(usageEvents).values([
      usageRow({
        createdAt: thisMonth,
        inputTokens: 1000, cacheReadTokens: 200, cacheCreationTokens: 100, outputTokens: 400,
        costUsd: 0.015725, costEstimated: false,
      }),
      usageRow({
        createdAt: monthsAgo(0, 20),
        inputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 100,
        costUsd: 0.005, costEstimated: true,
      }),
    ])

    const rows = await getMonthlyUsageByModel(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].month).toBe(monthKey(thisMonth))
    expect(rows[0].model).toBe('claude-opus-4-8')
    expect(rows[0].costUsd).toBeCloseTo(0.020725, 8)
    // 1000+200+100 (row 1, all three input columns) + 500 (row 2) = 1800
    expect(rows[0].inputTokens).toBe(1800)
    expect(rows[0].outputTokens).toBe(500)
    // bool_or: one row was estimated, so the group is flagged estimated.
    expect(rows[0].estimated).toBe(true)
  })

  it('window respects monthsBack: excludes a row older than the trailing window, includes the boundary month', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    await testDb.insert(usageEvents).values([
      usageRow({ model: 'claude-opus-4-8', createdAt: monthsAgo(0), costUsd: 0.01 }),
      usageRow({ model: 'claude-opus-4-8', createdAt: monthsAgo(2), costUsd: 0.02 }),
      usageRow({ model: 'claude-opus-4-8', createdAt: monthsAgo(4), costUsd: 0.04 }),
    ])

    // monthsBack=3 -> current month + 2 back = 3 months total: covers monthsAgo(0) and monthsAgo(2), not monthsAgo(4).
    const threeBack = await getMonthlyUsageByModel(3)
    expect(threeBack.map(r => r.month).sort()).toEqual([monthKey(monthsAgo(2)), monthKey(monthsAgo(0))].sort())

    // monthsBack=1 -> current month only.
    const oneBack = await getMonthlyUsageByModel(1)
    expect(oneBack.map(r => r.month)).toEqual([monthKey(monthsAgo(0))])
  })

  it('orders most-recent month first, then model within a month', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    await testDb.insert(usageEvents).values([
      usageRow({ model: 'claude-sonnet-5', createdAt: monthsAgo(0) }),
      usageRow({ model: 'claude-opus-4-8', createdAt: monthsAgo(0) }),
      usageRow({ model: 'claude-opus-4-8', createdAt: monthsAgo(1) }),
    ])

    const rows = await getMonthlyUsageByModel(2)
    expect(rows.map(r => [r.month, r.model])).toEqual([
      [monthKey(monthsAgo(0)), 'claude-opus-4-8'],
      [monthKey(monthsAgo(0)), 'claude-sonnet-5'],
      [monthKey(monthsAgo(1)), 'claude-opus-4-8'],
    ])
  })

  it('has no project_id filter: a null-project_id row (generate-title/classify shape) still counts, and the unpriced tuple survives untouched', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    // Mirrors a real generate-title/classify row: projectId null, chatId set,
    // the always-unpriced gemini sentinel (cost 0, estimated true).
    await testDb.insert(usageEvents).values(
      usageRow({
        model: 'gemini-3.5-flash', purpose: 'generate-title',
        chatId: null, projectId: null,
        inputTokens: 14, outputTokens: 4,
        costUsd: 0, costEstimated: true,
      }),
    )

    const rows = await getMonthlyUsageByModel(1)
    expect(rows).toHaveLength(1)
    // The action must not silently drop or reprice this row — the caller
    // (UsageSettingsTab) is responsible for rendering it as "unpriced".
    expect(rows[0]).toMatchObject({ model: 'gemini-3.5-flash', costUsd: 0, estimated: true, inputTokens: 14, outputTokens: 4 })
  })

  it('counts a row whose chat_id is null (surviving a chat deletion via ON DELETE SET NULL)', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    await testDb.insert(usageEvents).values(
      usageRow({ chatId: null, projectId: null, model: 'claude-haiku-4-5-20251001', costUsd: 0.0007 }),
    )
    const rows = await getMonthlyUsageByModel(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].costUsd).toBeCloseTo(0.0007, 8)
  })

  // Review regression: sum() over the integer token columns returns bigint;
  // an ::int cast on that sum raises "integer out of range" once a (month,
  // model) group's combined tokens pass 2^31-1 — individually-valid rows
  // (each well under the int4 ceiling) that only overflow once SUMMED. The
  // fix casts to ::float8 instead (matches costUsd's own cast).
  it('does not overflow summing tokens across rows into "integer out of range" (::float8, not ::int)', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    // Each row is individually valid (well under int4's ~2.147B ceiling);
    // summed, input+cacheRead+cacheCreation alone reaches ~3B, which an
    // ::int cast on the SQL sum() would reject.
    await testDb.insert(usageEvents).values([
      usageRow({ inputTokens: 1_500_000_000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 }),
      usageRow({ inputTokens: 1_500_000_000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    ])

    const rows = await getMonthlyUsageByModel(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].inputTokens).toBe(3_000_000_000)
    expect(rows[0].outputTokens).toBe(200)
  })

  // Review regression: to_char(timestamptz, ...) converts through the
  // POSTGRES SESSION's TimeZone setting before formatting, while `since`
  // (the window cutoff) is computed in UTC via JS Date methods — under a
  // non-UTC session those two disagreed, and a row near a month boundary
  // could land in the wrong month bucket. The fix forces `AT TIME ZONE
  // 'UTC'` before to_char so bucketing is always UTC regardless of session.
  it('buckets by UTC month even when the Postgres session TimeZone is not UTC', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    // 01:00 UTC on the 1st is still the 1st in UTC, but rolls back to the
    // LAST day of the PREVIOUS month under America/Phoenix (UTC-7: 01:00
    // minus 7h = 18:00 the day before). Pre-fix, to_char would bucket this
    // row into last month once the session TimeZone was non-UTC.
    const edgeOfMonth = new Date()
    edgeOfMonth.setUTCDate(1)
    edgeOfMonth.setUTCHours(1, 0, 0, 0)
    const currentMonthKey = monthKey(edgeOfMonth)

    await testDb.insert(usageEvents).values(usageRow({ createdAt: edgeOfMonth, costUsd: 0.05 }))

    await testDb.execute(sql.raw(`SET TIME ZONE 'America/Phoenix'`))
    try {
      const rows = await getMonthlyUsageByModel(2)
      expect(rows).toHaveLength(1)
      expect(rows[0].month).toBe(currentMonthKey)
    } finally {
      // Reset — testDb's underlying client persists across tests in this worker.
      await testDb.execute(sql.raw(`SET TIME ZONE 'UTC'`))
    }
  })

  // Final-review finding: this is a server action, directly callable with any
  // number — an absurd or malformed monthsBack must not push `since` to an
  // Invalid Date and throw. Clamped to 1..24; NaN/non-finite falls back to
  // the 3-month default.
  it('clamps an absurd monthsBack instead of throwing on an Invalid Date', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    await testDb.insert(usageEvents).values(usageRow({ createdAt: monthsAgo(0), costUsd: 0.01 }))

    await expect(getMonthlyUsageByModel(999_999)).resolves.toBeInstanceOf(Array)
    await expect(getMonthlyUsageByModel(-5)).resolves.toBeInstanceOf(Array)
    await expect(getMonthlyUsageByModel(0)).resolves.toBeInstanceOf(Array)
    await expect(getMonthlyUsageByModel(Number.NaN)).resolves.toBeInstanceOf(Array)
    await expect(getMonthlyUsageByModel(Number.POSITIVE_INFINITY)).resolves.toBeInstanceOf(Array)
  })

  it('clamped monthsBack still returns a correctly-windowed result, not just "did not throw"', async () => {
    const { getMonthlyUsageByModel } = await import('@/app/actions')
    await testDb.insert(usageEvents).values([
      usageRow({ createdAt: monthsAgo(0), costUsd: 0.01 }),
      usageRow({ createdAt: monthsAgo(23), costUsd: 0.02 }),
      usageRow({ createdAt: monthsAgo(30), costUsd: 0.03 }),
    ])

    // Clamped to 24: covers monthsAgo(0) and monthsAgo(23), not monthsAgo(30).
    const rows = await getMonthlyUsageByModel(999_999)
    expect(rows.map(r => r.month).sort()).toEqual([monthKey(monthsAgo(23)), monthKey(monthsAgo(0))].sort())

    // A negative/zero input clamps up to the 1-month floor: current month only.
    const flooredRows = await getMonthlyUsageByModel(-5)
    expect(flooredRows.map(r => r.month)).toEqual([monthKey(monthsAgo(0))])
  })
})

describe('getChatCost', () => {
  beforeEach(async () => { await createTestDb() })

  it('sums cost across every purpose tied to the chat, unaffected in dollars by an always-unpriced housekeeping row', async () => {
    const { createProject, createChat, getChatCost } = await import('@/app/actions')
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    await testDb.insert(usageEvents).values([
      usageRow({ chatId: chat.id, projectId: project.id, purpose: 'chat', model: 'claude-opus-4-8', costUsd: 1.2345, costEstimated: false }),
      // generate-title/classify shape: same chat_id, null project_id, the unpriced sentinel.
      usageRow({ chatId: chat.id, projectId: null, purpose: 'generate-title', model: 'gemini-3.5-flash', costUsd: 0, costEstimated: true }),
    ])

    const result = await getChatCost(chat.id)
    expect(result.costUsd).toBeCloseTo(1.2345, 8)
    // Must NOT be polluted true by the unrelated $0 housekeeping row.
    expect(result.estimated).toBe(false)
  })

  it('estimated reflects a real dollar-contributing estimate, not just the free housekeeping rows', async () => {
    const { createProject, createChat, getChatCost } = await import('@/app/actions')
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    await testDb.insert(usageEvents).values([
      usageRow({ chatId: chat.id, projectId: project.id, purpose: 'chat', model: 'claude-sonnet-9-20990101', costUsd: 0.5, costEstimated: true }),
      usageRow({ chatId: chat.id, projectId: null, purpose: 'classify', model: 'gemini-3.5-flash', costUsd: 0, costEstimated: true }),
    ])

    const result = await getChatCost(chat.id)
    expect(result.costUsd).toBeCloseTo(0.5, 8)
    expect(result.estimated).toBe(true)
  })

  it('returns costUsd 0 / estimated false for a chat with no usage_events rows', async () => {
    const { createProject, createChat, getChatCost } = await import('@/app/actions')
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Empty chat')

    expect(await getChatCost(chat.id)).toEqual({ costUsd: 0, estimated: false })
  })

  it('scopes strictly to the given chat_id — another chat’s rows are excluded', async () => {
    const { createProject, createChat, getChatCost } = await import('@/app/actions')
    const [project] = await createProject('P')
    const [chatA] = await createChat(project.id, 'Chat A')
    const [chatB] = await createChat(project.id, 'Chat B')

    await testDb.insert(usageEvents).values([
      usageRow({ chatId: chatA.id, projectId: project.id, costUsd: 0.1 }),
      usageRow({ chatId: chatB.id, projectId: project.id, costUsd: 9.99 }),
    ])

    const result = await getChatCost(chatA.id)
    expect(result.costUsd).toBeCloseTo(0.1, 8)
  })
})
