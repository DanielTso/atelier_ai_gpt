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

// Migration 0022 (audit D2): the unique (document_id, chunk_index) index.
// Production may already hold duplicate chunk rows from the concurrent-ingest
// race, and a bare CREATE UNIQUE INDEX would fail on them. This test migrates a
// fresh database to 0021, seeds duplicates the way the race left them, then
// applies the real 0022 file and checks it de-duplicates before indexing.
describe('migration 0022 — unique chunk index with de-duplication', () => {
  it('removes duplicate chunk rows, fixes chunk_count, then enforces uniqueness', async () => {
    const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf-8')) as Journal
    const before = journal.entries.filter(e => e.idx < 22)
    expect(journal.entries.some(e => e.idx === 22)).toBe(true)

    // A migrations folder that stops at 0021.
    const dir = mkdtempSync(join(tmpdir(), 'mig0022-'))
    try {
      mkdirSync(join(dir, 'meta'))
      writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }))
      for (const e of before) copyFileSync(join('./drizzle', `${e.tag}.sql`), join(dir, `${e.tag}.sql`))

      const client = new PGlite({ extensions: { vector, pg_trgm } })
      const db = drizzle({ client })
      await migrate(db, { migrationsFolder: dir })

      const v = (x: number) => `[${new Array(768).fill(x).join(',')}]`
      await db.execute(sql`INSERT INTO projects (id, name) OVERRIDING SYSTEM VALUE VALUES (1, 'P')`)
      // Doc 1: the race left two chunk sets (indexes 0-2 twice) and chunk_count 6.
      // Doc 2: healthy, 2 chunks. Doc 3: no duplicates but a drifted chunk_count
      // the migration must leave alone (it only repairs documents it de-duplicates).
      await db.execute(sql`INSERT INTO documents (id, project_id, filename, mime_type, file_size, char_count, chunk_count, status) OVERRIDING SYSTEM VALUE VALUES
        (1, 1, 'a.pdf', 'application/pdf', 1, 0, 6, 'ready'),
        (2, 1, 'b.pdf', 'application/pdf', 1, 0, 2, 'ready'),
        (3, 1, 'c.pdf', 'application/pdf', 1, 0, 9, 'ready')`)
      // For index 0 the lower id has NO embedding: the embedded copy must win.
      // For indexes 1 and 2 both copies are embedded: the lowest id wins.
      await db.execute(sql.raw(`INSERT INTO document_chunks (id, document_id, project_id, chunk_index, content, embedding) OVERRIDING SYSTEM VALUE VALUES
        (10, 1, 1, 0, 'first-0', NULL),
        (11, 1, 1, 1, 'first-1', '${v(0.1)}'),
        (12, 1, 1, 2, 'first-2', '${v(0.1)}'),
        (13, 1, 1, 0, 'second-0', '${v(0.2)}'),
        (14, 1, 1, 1, 'second-1', '${v(0.2)}'),
        (15, 1, 1, 2, 'second-2', '${v(0.2)}'),
        (20, 2, 1, 0, 'b-0', '${v(0.3)}'),
        (21, 2, 1, 1, 'b-1', '${v(0.3)}'),
        (30, 3, 1, 0, 'c-0', '${v(0.4)}')`))

      // Apply the rest (0022) from the real folder.
      await migrate(db, { migrationsFolder: './drizzle' })

      const chunks = rowsOf<{ id: number; document_id: number; chunk_index: number }>(await db.execute(
        sql`SELECT id, document_id, chunk_index FROM document_chunks ORDER BY id`))
      expect(chunks.map(c => c.id)).toEqual([11, 12, 13, 20, 21, 30])

      const docs = rowsOf<{ id: number; chunk_count: number }>(await db.execute(
        sql`SELECT id, chunk_count FROM documents ORDER BY id`))
      expect(docs).toEqual([{ id: 1, chunk_count: 3 }, { id: 2, chunk_count: 2 }, { id: 3, chunk_count: 9 }])

      // The index now refuses a second row for the same (document_id, chunk_index).
      await expect(db.execute(sql`INSERT INTO document_chunks (document_id, project_id, chunk_index, content) VALUES (1, 1, 0, 'dup')`))
        .rejects.toThrow()

      // Raw migration 0016's search objects are untouched.
      const idx = rowsOf<{ indexname: string }>(await db.execute(
        sql`SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks' ORDER BY indexname`)).map(r => r.indexname)
      expect(idx).toEqual(expect.arrayContaining(['idx_chunks_tsv', 'idx_chunks_trgm', 'uq_chunks_document_chunk']))
      const tsv = rowsOf<{ n: number }>(await db.execute(
        sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'document_chunks' AND column_name = 'content_tsv'`))
      expect(tsv[0].n).toBe(1)
      await client.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
