import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

// Migration 0020 (audit S3): RLS used to be enabled on 12 tables only in the
// live Supabase dashboard — invisible to schema.ts and the migrations, so a
// fresh environment came up anon-readable. Now every table declares it.
describe('migration 0020 — RLS on every public table', () => {
  beforeEach(async () => { await createTestDb() })

  it('enables row-level security on all 16 app tables', async () => {
    const res = await testDb.execute(sql`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `)
    const rows = rowsOf<{ relname: string; relrowsecurity: boolean }>(res)
    expect(rows.map(r => r.relname)).toEqual([
      'artifact_versions', 'artifacts', 'chat_topics', 'chats', 'document_chunks', 'document_revisions',
      'documents', 'generated_images', 'memory_suggestions', 'message_attachments', 'message_embeddings',
      'messages', 'persona_usage', 'projects', 'settings', 'usage_events',
    ])
    expect(rows.every(r => r.relrowsecurity)).toBe(true)
  })

  it('still lets the table owner read and write (no policies needed)', async () => {
    // PGlite connects as the owner, exactly like the app's `postgres` role on
    // Supabase — owners bypass RLS, so zero policies is the intended state.
    await testDb.execute(sql`INSERT INTO projects (name) VALUES ('rls-owner-check')`)
    const res = await testDb.execute(sql`SELECT count(*)::int AS n FROM projects`)
    expect(rowsOf<{ n: number }>(res)[0].n).toBe(1)
  })
})
