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

// drizzle wraps the Postgres error; the violated constraint's name is on .cause.
function causeMessage(err: unknown): string {
  return (err as { cause?: { message?: string } }).cause?.message ?? ''
}

type Journal = { entries: { idx: number; tag: string }[] }

const EXISTING_PURPOSES = ['chat', 'artifact-regenerate', 'summarize', 'generate-title', 'classify', 'memory-suggest']
const NEW_PURPOSES = ['suggest-followups', 'query-rewrite', 'rerank', 'image-generate', 'vision-extract']

// Migration 0023 (audit C5): the usage_events purpose CHECK gains the five
// formerly unrecorded LLM call sites. Production already holds rows with every
// existing purpose — 'classify' included, though /api/classify is slated for
// deletion — and the replacement CHECK is validated against them, so it must
// keep every old value. This test migrates a fresh database to 0022, seeds one
// historical row per existing purpose, then applies the real 0023 file.
describe('migration 0023 — usage_events purpose CHECK covers every LLM call site', () => {
  it('keeps historical rows (classify included), accepts the new purposes and still rejects an unknown one', async () => {
    const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf-8')) as Journal
    expect(journal.entries.some(e => e.idx === 23)).toBe(true)
    const before = journal.entries.filter(e => e.idx < 23)

    const dir = mkdtempSync(join(tmpdir(), 'mig0023-'))
    try {
      mkdirSync(join(dir, 'meta'))
      writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }))
      for (const e of before) copyFileSync(join('./drizzle', `${e.tag}.sql`), join(dir, `${e.tag}.sql`))

      const client = new PGlite({ extensions: { vector, pg_trgm } })
      const db = drizzle({ client })
      await migrate(db, { migrationsFolder: dir })

      // Before 0023 a new purpose is rejected — the reason the five sites were
      // never recorded.
      const preErr = await db.execute(sql`INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('rerank', 'gemini-3.5-flash', 0)`)
        .then(() => null, (e: unknown) => e)
      expect(causeMessage(preErr)).toMatch(/usage_events_purpose_chk/)

      for (const purpose of EXISTING_PURPOSES) {
        await db.execute(sql`INSERT INTO usage_events (purpose, model, input_tokens, cost_usd) VALUES (${purpose}, 'gemini-3.5-flash', 7, 0.5)`)
      }

      // Apply the rest (0023) from the real folder.
      await migrate(db, { migrationsFolder: './drizzle' })

      const kept = rowsOf<{ purpose: string; input_tokens: number }>(await db.execute(
        sql`SELECT purpose, input_tokens FROM usage_events ORDER BY id`))
      expect(kept).toEqual(EXISTING_PURPOSES.map(purpose => ({ purpose, input_tokens: 7 })))

      for (const purpose of [...EXISTING_PURPOSES, ...NEW_PURPOSES]) {
        await db.execute(sql`INSERT INTO usage_events (purpose, model, cost_usd) VALUES (${purpose}, 'gemini-3.5-flash', 0)`)
      }

      const err = await db.execute(sql`INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('bogus', 'gemini-3.5-flash', 0)`)
        .then(() => null, (e: unknown) => e)
      expect(causeMessage(err)).toMatch(/usage_events_purpose_chk/)

      // Exactly one purpose CHECK, and the token CHECK from 0019 is untouched.
      const checks = rowsOf<{ conname: string }>(await db.execute(
        sql`SELECT conname FROM pg_constraint WHERE conrelid = 'usage_events'::regclass AND contype = 'c' ORDER BY conname`)).map(r => r.conname)
      expect(checks).toEqual(['usage_events_purpose_chk', 'usage_events_tokens_nonneg_chk'])

      // Raw migration 0016's search objects are untouched.
      const idx = rowsOf<{ indexname: string }>(await db.execute(
        sql`SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks' ORDER BY indexname`)).map(r => r.indexname)
      expect(idx).toEqual(expect.arrayContaining(['idx_chunks_tsv', 'idx_chunks_trgm']))
      await client.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
