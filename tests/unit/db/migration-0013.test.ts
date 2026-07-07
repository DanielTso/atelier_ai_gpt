import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

// drizzle-orm/pglite's execute() returns { rows }, but postgres-js returns a bare
// array. Normalize so this test asserts the same way regardless of driver shape.
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

// Migration 0013 hardening: RLS on the two tables added after the June RLS pass,
// plus three FK indexes flagged by Supabase's unindexed_foreign_keys advisor.
describe('migration 0013 — RLS + FK indexes', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates the three FK indexes', async () => {
    const res = await testDb.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN (
        'idx_artifacts_project_id',
        'idx_document_revisions_project_id',
        'idx_memory_suggestions_chat_id'
      )
    `)
    const names = rowsOf<{ indexname: string }>(res).map(r => r.indexname).sort()
    expect(names).toEqual([
      'idx_artifacts_project_id',
      'idx_document_revisions_project_id',
      'idx_memory_suggestions_chat_id',
    ])
  })

  it('enables row-level security on artifact_versions and generated_images', async () => {
    const res = await testDb.execute(sql`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('artifact_versions', 'generated_images')
      ORDER BY relname
    `)
    const rows = rowsOf<{ relname: string; relrowsecurity: boolean }>(res)
    expect(rows).toEqual([
      { relname: 'artifact_versions', relrowsecurity: true },
      { relname: 'generated_images', relrowsecurity: true },
    ])
  })
})
