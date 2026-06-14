import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import * as schema from '@/db/schema'

let client: PGlite | null = null
export let testDb: ReturnType<typeof drizzle<typeof schema>>

const TABLES = [
  'chat_topics', 'message_attachments', 'persona_usage', 'document_chunks',
  'documents', 'message_embeddings', 'messages', 'chats', 'projects', 'settings',
]

/**
 * Returns a Postgres-compatible test DB. The PGlite instance + migrations are
 * created once (expensive); each call TRUNCATEs all tables so tests stay isolated
 * while avoiding a fresh WASM Postgres per test.
 */
export async function createTestDb() {
  if (!client) {
    client = new PGlite({ extensions: { vector } })
    testDb = drizzle({ client, schema })
    await migrate(testDb, { migrationsFolder: './drizzle' })
  } else {
    await testDb.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE;`))
  }
  return testDb
}
