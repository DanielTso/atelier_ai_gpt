import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/db/schema'

export let testDb: ReturnType<typeof drizzle<typeof schema>>

export async function createTestDb() {
  // In-process Postgres with the pgvector extension loaded.
  const client = new PGlite({ extensions: { vector } })
  testDb = drizzle({ client, schema })
  // Apply the same migrations as prod (0000 enable vector → 0001 schema).
  await migrate(testDb, { migrationsFolder: './drizzle' })
  return testDb
}
