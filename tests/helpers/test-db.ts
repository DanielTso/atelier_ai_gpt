import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import * as schema from '@/db/schema'

let initPromise: Promise<void> | null = null
export let testDb: ReturnType<typeof drizzle<typeof schema>>

const TABLES = [
  'artifact_versions', 'artifacts', 'chat_topics', 'generated_images', 'message_attachments',
  'persona_usage', 'document_chunks', 'documents', 'memory_suggestions', 'message_embeddings',
  'usage_events', 'messages', 'chats', 'projects', 'settings',
]

/**
 * Returns a Postgres-compatible test DB. The PGlite instance + migrations are
 * created once per test file (Vitest isolates module state per file); each
 * later call TRUNCATEs all tables so tests stay isolated without a fresh WASM
 * Postgres per test.
 *
 * The init is memoized as a PROMISE and `testDb` is published only after
 * `migrate()` resolves: a caller that times out mid-boot (see vitest.config's
 * testTimeout) must not leave a half-migrated instance behind for the next
 * caller to TRUNCATE.
 */
export async function createTestDb() {
  if (!initPromise) {
    initPromise = (async () => {
      const client = new PGlite({ extensions: { vector, pg_trgm } })
      const db = drizzle({ client, schema })
      await migrate(db, { migrationsFolder: './drizzle' })
      testDb = db
    })().catch((err) => {
      initPromise = null
      throw err
    })
    await initPromise
    return testDb
  }
  await initPromise
  await testDb.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE;`))
  return testDb
}
