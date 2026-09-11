import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

// drizzle-orm/pglite's execute() returns { rows }, but postgres-js returns a bare
// array. Normalize so this test asserts the same way regardless of driver shape.
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

// drizzle-orm's execute() wraps every driver error in a generic
// `DrizzleQueryError` ("Failed query: ...") and puts the real Postgres error
// (with the violated constraint's name) on `.cause` (verified against the
// installed drizzle-orm@0.45.2 + @electric-sql/pglite driver pair). `.rejects
// .toThrow(/regex/)` only ever inspects the top-level `.message`, so a CHECK
// violation must be asserted via `.cause.message` instead.
function causeMessage(err: unknown): string {
  return (err as { cause?: { message?: string } }).cause?.message ?? ''
}

// Migration 0019 (audit D3/D4): the rollup filters created_at alone and the
// project_id FK is SET NULL on project delete — both need their own index; and
// purpose/token columns get CHECKs so a typo can never silently drop rows.
describe('migration 0019 — usage_events indexes + CHECKs', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates the created_at and project_id indexes', async () => {
    const res = await testDb.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'usage_events'
        AND indexname IN ('idx_usage_events_created_at', 'idx_usage_events_project_id')
    `)
    const names = rowsOf<{ indexname: string }>(res).map(r => r.indexname).sort()
    expect(names).toEqual(['idx_usage_events_created_at', 'idx_usage_events_project_id'])
  })

  it('rejects an unknown purpose', async () => {
    const err = await testDb.execute(sql`
      INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('bogus', 'claude-opus-4-8', 0)
    `).catch((e) => e)
    expect(causeMessage(err)).toMatch(/usage_events_purpose_chk/)
  })

  it('accepts every documented purpose', async () => {
    for (const purpose of ['chat', 'artifact-regenerate', 'summarize', 'generate-title', 'classify', 'memory-suggest']) {
      await testDb.execute(sql`
        INSERT INTO usage_events (purpose, model, cost_usd) VALUES (${purpose}, 'claude-opus-4-8', 0)
      `)
    }
    const res = await testDb.execute(sql`SELECT count(*)::int AS n FROM usage_events`)
    expect(rowsOf<{ n: number }>(res)[0].n).toBe(6)
  })

  it('rejects negative token counts and negative cost', async () => {
    const tokenErr = await testDb.execute(sql`
      INSERT INTO usage_events (purpose, model, output_tokens, cost_usd) VALUES ('chat', 'claude-opus-4-8', -5, 0)
    `).catch((e) => e)
    expect(causeMessage(tokenErr)).toMatch(/usage_events_tokens_nonneg_chk/)
    const costErr = await testDb.execute(sql`
      INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('chat', 'claude-opus-4-8', -0.01)
    `).catch((e) => e)
    expect(causeMessage(costErr)).toMatch(/usage_events_tokens_nonneg_chk/)
  })
})
