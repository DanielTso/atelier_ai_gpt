import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

// drizzle-orm/pglite's execute() returns { rows }, but postgres-js returns a bare
// array. Normalize so this test asserts the same way regardless of driver shape.
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

// Migration 0014: fidelity columns on documents (Phase 1 RAG). page_count /
// pages_extracted are nullable; extraction_partial is NOT NULL DEFAULT false.
describe('migration 0014 — document fidelity columns', () => {
  beforeEach(async () => { await createTestDb() })

  it('adds page_count, pages_extracted, extraction_partial with correct nullability + default', async () => {
    const res = await testDb.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'documents'
        AND column_name IN ('page_count', 'pages_extracted', 'extraction_partial')
      ORDER BY column_name
    `)
    const rows = rowsOf<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(res)
    const byName = Object.fromEntries(rows.map(r => [r.column_name, r]))
    expect(byName.page_count).toMatchObject({ data_type: 'integer', is_nullable: 'YES' })
    expect(byName.pages_extracted).toMatchObject({ data_type: 'integer', is_nullable: 'YES' })
    expect(byName.extraction_partial.data_type).toBe('boolean')
    expect(byName.extraction_partial.is_nullable).toBe('NO')
    expect(byName.extraction_partial.column_default).toMatch(/false/)
  })
})
