import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

describe('hybrid search infrastructure', () => {
  beforeEach(async () => { await createTestDb() })

  it('has pg_trgm and the content_tsv generated column', async () => {
    const r: unknown = await testDb.execute(sql`
      INSERT INTO projects (name) VALUES ('p') RETURNING id`)
    const rows = Array.isArray(r) ? r : (r as { rows: { id: number }[] }).rows
    const projectId = rows[0].id
    await testDb.execute(sql`
      INSERT INTO documents (project_id, filename, mime_type, file_size, char_count)
      VALUES (${projectId}, 'plans.pdf', 'application/pdf', 1, 1)`)
    await testDb.execute(sql`
      INSERT INTO document_chunks (document_id, project_id, chunk_index, content)
      VALUES (1, ${projectId}, 0, 'Storm drain schedule sheet SW-101 general notes')`)
    const q: unknown = await testDb.execute(sql`
      SELECT id FROM document_chunks
      WHERE content_tsv @@ websearch_to_tsquery('english', 'storm drain')
        AND content ILIKE '%SW-101%'`)
    const hits = Array.isArray(q) ? q : (q as { rows: unknown[] }).rows
    expect(hits.length).toBe(1)
  })
})
