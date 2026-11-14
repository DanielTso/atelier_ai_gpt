import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

type Journal = { entries: { idx: number; tag: string }[] }

// Migration 0024: /api/classify was removed, so its chat_topics table is dropped.
// 'classify' stays a valid usage_events purpose — stored rows already use it.
describe('migration 0024 — drop chat_topics', () => {
  it('drops the table, keeps classify usage rows valid and leaves the search indexes alone', async () => {
    const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf-8')) as Journal
    expect(journal.entries.some(e => e.idx === 24)).toBe(true)
    const before = journal.entries.filter(e => e.idx < 24)

    const dir = mkdtempSync(join(tmpdir(), 'mig0024-'))
    try {
      mkdirSync(join(dir, 'meta'))
      writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }))
      for (const e of before) copyFileSync(join('./drizzle', `${e.tag}.sql`), join(dir, `${e.tag}.sql`))

      const client = new PGlite({ extensions: { vector, pg_trgm } })
      const db = drizzle({ client })
      await migrate(db, { migrationsFolder: dir })

      const exists = async () => rowsOf<{ n: number }>(await db.execute(
        sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'chat_topics'`))[0].n
      expect(await exists()).toBe(1)
      await db.execute(sql`INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('classify', 'gemini-3.5-flash', 0)`)

      await migrate(db, { migrationsFolder: './drizzle' })

      expect(await exists()).toBe(0)
      await db.execute(sql`INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('classify', 'gemini-3.5-flash', 0)`)
      const n = rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM usage_events WHERE purpose = 'classify'`))[0].n
      expect(n).toBe(2)

      const idx = rowsOf<{ indexname: string }>(await db.execute(
        sql`SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks' ORDER BY indexname`)).map(r => r.indexname)
      expect(idx).toEqual(expect.arrayContaining(['idx_chunks_tsv', 'idx_chunks_trgm']))
      await client.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
