# Phase B — Supabase Postgres + pgvector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Frame implementers by **role** (Database / Backend / QA / Reviewer / Docs) per the saved agent-stack reference. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate the data layer from libSQL/SQLite (Turso) to Supabase Postgres, and replace brute-force JSON-cosine RAG with native pgvector (HNSW cosine) indexed search — same app behavior, fresh start.

**Architecture:** Drizzle ORM moves from `sqlite-core` to `pg-core` on the `postgres-js` driver (Supabase transaction pooler at runtime, `prepare: false`; direct connection for migrations). Embedding columns become `vector(768)` with HNSW `vector_cosine_ops` indexes; retrieval becomes an indexed SQL query via `cosineDistance`. Tests run on PGlite (in-process Postgres + `vector` extension) applying the same Drizzle migrations.

**Tech Stack:** Next.js 16, Drizzle ORM 0.45 (`pg-core`, `postgres-js`, `pglite`), `postgres`, `@electric-sql/pglite`, pgvector, Vitest, Playwright, Supabase.

---

## ⚠️ Migration red-zone (read before executing)

A DB migration is **atomic** — it cannot keep `tsc`/`build`/full-suite green at every step. Changing the `embedding` column type breaks `embeddings.ts`; switching the driver breaks `actions.ts` `.all()/.get()`. So:

- **Tasks 2–5 use TARGETED verification only** (drizzle-kit generate, a standalone harness test, or specific test files). Vitest transforms per-file without a project-wide typecheck, so a targeted test passes even while *other* files are mid-port.
- **Do NOT run `npm run build` or `npm test` (full) during Tasks 2–5** — they will fail by design. The full `tsc` + `build` + whole-suite gate runs in **Task 6** (integration) and **Task 9** (gate).
- Reviewers: judge Tasks 2–5 against their stated targeted verification, not the full suite.

---

## File structure

| File | Responsibility after Phase B |
|---|---|
| `package.json` | + `postgres`, `@electric-sql/pglite`; − `@libsql/client` (Task 6) |
| `drizzle.config.ts` | `postgresql` dialect; migrations from `DIRECT_URL` |
| `drizzle/` (new) | Generated migrations: `0000_enable_vector.sql` (extension) + `0001_*` (schema) |
| `src/db/schema.ts` | pg-core schema; `vector(768)` + HNSW indexes |
| `src/db/index.ts` | postgres-js connection (pooled, `prepare:false`) |
| `src/lib/embeddings.ts` | pgvector SQL search; stores `number[]` to vector columns |
| `src/app/actions.ts` | `.all()`→await, `.get()`→destructure (24 sites) |
| `src/lib/settings.ts` | one `.get()` site converted |
| `tests/helpers/test-db.ts` | PGlite + `vector` extension + migrate |
| `tests/unit/db/vector-search.test.ts` (new) | pgvector ordering/threshold test |
| `CLAUDE.md`, `CHANGELOG.md`, `docs/chatlog-*.md` | DB/deploy docs |

---

## Task 1: Dependencies (Backend role)

**Files:** `package.json` (+ lockfile)

- [ ] **Step 1: Install runtime + test Postgres deps**

Run: `npm install postgres @electric-sql/pglite`

- [ ] **Step 2: Verify they resolve and the build still passes** (nothing imports them yet)

Run: `npm run build`
Expected: builds clean (these are additive; no source change yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(phase-b): add postgres + @electric-sql/pglite deps"
```

---

## Task 2: Postgres schema + drizzle config + migrations (Database role)

**Files:**
- Modify: `drizzle.config.ts`
- Modify: `src/db/schema.ts` (full rewrite)
- Create: `drizzle/0000_enable_vector.sql` (via generate --custom)

- [ ] **Step 1: Rewrite `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Direct (non-pooled) connection — migrations must not run through the pooler.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 2: Rewrite `src/db/schema.ts` to pg-core** (replace entire file)

```ts
import { pgTable, text, integer, boolean, timestamp, vector, index, uniqueIndex } from 'drizzle-orm/pg-core';

const idPk = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const createdAt = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow();

export const projects = pgTable('projects', {
  id: idPk(),
  name: text('name').notNull(),
  icon: text('icon'),
  defaultPersonaId: text('default_persona_id'),
  defaultModel: text('default_model'),
  createdAt: createdAt(),
});

export const chats = pgTable('chats', {
  id: idPk(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  archived: boolean('archived').notNull().default(false),
  systemPrompt: text('system_prompt'),
  summary: text('summary'),
  summaryUpToMessageId: integer('summary_up_to_message_id'),
  createdAt: createdAt(),
}, (table) => [
  index('idx_chats_project_id').on(table.projectId),
  index('idx_chats_created_at').on(table.createdAt),
  index('idx_chats_archived_project').on(table.projectId, table.archived, table.createdAt),
]);

export const messages = pgTable('messages', {
  id: idPk(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('idx_messages_chat_id').on(table.chatId),
  index('idx_messages_created_at').on(table.createdAt),
]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const messageEmbeddings = pgTable('message_embeddings', {
  id: idPk(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('idx_embeddings_chat_id').on(table.chatId),
  index('idx_embeddings_project_id').on(table.projectId),
  uniqueIndex('idx_embeddings_message_id').on(table.messageId),
  index('idx_embeddings_vector').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const documents = pgTable('documents', {
  id: idPk(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  charCount: integer('char_count').notNull(),
  chunkCount: integer('chunk_count').default(0),
  status: text('status').notNull().default('processing'),
  errorMessage: text('error_message'),
  createdAt: createdAt(),
}, (table) => [
  index('idx_documents_project_id').on(table.projectId),
]);

export const documentChunks = pgTable('document_chunks', {
  id: idPk(),
  documentId: integer('document_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  createdAt: createdAt(),
}, (table) => [
  index('idx_chunks_document_id').on(table.documentId),
  index('idx_chunks_project_id').on(table.projectId),
  index('idx_chunks_vector').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const personaUsage = pgTable('persona_usage', {
  id: idPk(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
  personaId: text('persona_id').notNull(),
  modelUsed: text('model_used'),
  messageCount: integer('message_count').default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_persona_usage_project_id').on(table.projectId),
  index('idx_persona_usage_chat_id').on(table.chatId),
]);

export const messageAttachments = pgTable('message_attachments', {
  id: idPk(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  mediaType: text('media_type').notNull(),
  dataUrl: text('data_url').notNull(),
  fileSize: integer('file_size').notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('idx_attachments_message_id').on(table.messageId),
  index('idx_attachments_chat_id').on(table.chatId),
]);

export const chatTopics = pgTable('chat_topics', {
  id: idPk(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),
  confidence: integer('confidence').default(50),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_chat_topics_chat_id').on(table.chatId),
  uniqueIndex('idx_chat_topics_chat_id_topic').on(table.chatId, table.topic),
]);
```

- [ ] **Step 3: Create the extension migration FIRST** (must precede vector-column tables)

Run: `npx drizzle-kit generate --custom --name enable_vector`
Then edit the generated `drizzle/0000_enable_vector.sql` to contain exactly:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 4: Generate the schema migration**

Run: `npx drizzle-kit generate --name init_schema`
Expected: creates `drizzle/0001_*.sql`.

- [ ] **Step 5: Verify the generated SQL is correct (targeted verification)**

Run: `grep -E "CREATE EXTENSION|vector\(768\)|USING hnsw|vector_cosine_ops" drizzle/*.sql`
Expected output includes: `CREATE EXTENSION IF NOT EXISTS vector;`, two `vector(768)` columns, and two `USING hnsw (... vector_cosine_ops)` indexes. Also confirm `0000` (extension) sorts before `0001` (tables).
Run: `npx tsc --noEmit src/db/schema.ts 2>&1 | head` — Expected: no errors *in schema.ts* (ignore errors in other files; this is the red zone).

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts src/db/schema.ts drizzle/
git commit -m "feat(phase-b): pg-core schema + pgvector migrations"
```

---

## Task 3: postgres-js connection + PGlite test harness (Database/QA role)

**Files:**
- Modify: `src/db/index.ts`
- Modify: `tests/helpers/test-db.ts`
- Create: `tests/unit/db/harness.test.ts`

- [ ] **Step 1: Rewrite `src/db/index.ts`**

```ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Supabase transaction pooler requires prepare:false (no prepared statements).
const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle({ client, schema });
```

- [ ] **Step 2: Rewrite `tests/helpers/test-db.ts` to PGlite**

```ts
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
```

> If the `@electric-sql/pglite/vector` import path errors at runtime, check the installed package's exports and adjust to the documented path (this is the one spot to verify live — prove it in Step 4 before continuing).

- [ ] **Step 3: Write the harness smoke test** — `tests/unit/db/harness.test.ts` (imports ONLY schema + test-db, so it runs green in the red zone)

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { projects, documents, documentChunks } from '@/db/schema'

describe('PGlite test harness', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates tables and round-trips a row (identity PK + timestamptz)', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'Site A' }).returning()
    expect(p.id).toBeGreaterThan(0)
    expect(p.createdAt).toBeInstanceOf(Date)
    const rows = await testDb.select().from(projects).where(eq(projects.id, p.id))
    expect(rows[0].name).toBe('Site A')
  })

  it('stores and orders by a pgvector column', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [d] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'f', mimeType: 't', fileSize: 1, charCount: 1,
    }).returning()
    const v = (base: number) => Array.from({ length: 768 }, (_, i) => (i === 0 ? base : 0))
    await testDb.insert(documentChunks).values([
      { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'near', embedding: v(1) },
      { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'far', embedding: v(-1) },
    ])
    const query = v(1)
    const rows = await testDb.select({
      content: documentChunks.content,
      dist: sql<number>`${documentChunks.embedding} <=> ${JSON.stringify(query)}::vector`,
    }).from(documentChunks).orderBy(sql`${documentChunks.embedding} <=> ${JSON.stringify(query)}::vector`)
    expect(rows[0].content).toBe('near')
  })
})
```

- [ ] **Step 4: Run the harness test (targeted verification — proves schema+migrations+pgvector on PGlite)**

Run: `npx vitest run tests/unit/db/harness.test.ts`
Expected: 2/2 PASS. If the `vector` extension or migration fails here, STOP and fix the harness before any other task — this is the highest-risk integration point.

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts tests/helpers/test-db.ts tests/unit/db/harness.test.ts
git commit -m "feat(phase-b): postgres-js connection + PGlite test harness"
```

---

## Task 4: Port `actions.ts` + `settings.ts` queries (Backend role)

**Files:** Modify `src/app/actions.ts`, `src/lib/settings.ts`

The pg/pglite query builder has no libSQL `.all()`/`.get()`. Apply two uniform transforms:

- **`.all()` → delete it.** `await db.select()...all()` → `await db.select()...` (pg returns an array directly). Sites in `src/app/actions.ts`: lines **10, 28, 34, 48, 70, 76, 111, 130, 178, 194, 251, 257, 261, 341, 356, 393, 425, 445, 463**.
- **`.get()` → return the first element.** Change `const result = await <query>.get()` to `const [result] = await <query>`. Sites: `src/lib/settings.ts:26`, and `src/app/actions.ts` lines **137, 164, 187, 295, 323**. (For any `.get()` whose result is used inline rather than assigned, wrap as `(await <query>)[0]`.)

> `.returning()`, `count()`, `db.transaction()`, `onConflictDoUpdate({ target })`, `eq/and/desc/inArray/isNull/lte/asc` all port unchanged.

- [ ] **Step 1: Convert every `.all()` site** in `src/app/actions.ts` (delete the trailing `.all()` on each listed line).

- [ ] **Step 2: Convert every `.get()` site** in `src/app/actions.ts` and `src/lib/settings.ts` to destructure the first element (`const [x] = await <query>`), per the list above.

- [ ] **Step 3: Run the action + settings test suites (targeted verification — now on PGlite)**

Run: `npx vitest run tests/unit/actions/ tests/unit/lib/settings.test.ts`
Expected: ALL PASS. These suites exercise nearly every ported query; a missed `.all()`/`.get()` fails loudly here.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions.ts src/lib/settings.ts
git commit -m "refactor(phase-b): port actions/settings queries to postgres"
```

---

## Task 5: pgvector search in `embeddings.ts` (Backend + QA role)

**Files:**
- Modify: `src/lib/embeddings.ts`
- Create: `tests/unit/db/vector-search.test.ts`

- [ ] **Step 1: Rewrite the storage + search internals of `src/lib/embeddings.ts`.** Keep `ensureEmbeddingModel`, `generateEmbedding`, and all exported function signatures unchanged. Replace the JSON-cosine implementations:

Replace the imports block at top:
```ts
import { embed } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { sql, and, eq, gt, desc, cosineDistance } from 'drizzle-orm'
import { db } from '@/db'
import { messageEmbeddings, documentChunks, documents } from '@/db/schema'
import { getGeminiApiKey } from './settings'
```

Delete `cosineSimilarity()` entirely. Replace `findSimilarMessages` and `findSimilarDocumentChunks` with indexed SQL:

```ts
export async function findSimilarMessages(
  queryEmbedding: number[],
  scope: { chatId?: number; projectId?: number },
  topK: number = 5,
  threshold: number = 0.7
): Promise<{ content: string; similarity: number; chatId: number; messageId: number }[]> {
  const similarity = sql<number>`1 - (${cosineDistance(messageEmbeddings.embedding, queryEmbedding)})`
  const scopeFilter = scope.projectId
    ? eq(messageEmbeddings.projectId, scope.projectId)
    : scope.chatId
      ? eq(messageEmbeddings.chatId, scope.chatId)
      : undefined
  return db.select({
    content: messageEmbeddings.content,
    similarity,
    chatId: messageEmbeddings.chatId,
    messageId: messageEmbeddings.messageId,
  }).from(messageEmbeddings)
    .where(scopeFilter ? and(scopeFilter, gt(similarity, threshold)) : gt(similarity, threshold))
    .orderBy(desc(similarity))
    .limit(topK)
}

export async function findSimilarDocumentChunks(
  queryEmbedding: number[],
  projectId: number,
  topK: number = 3,
  threshold: number = 0.5
): Promise<{ content: string; similarity: number; chunkId: number; documentId: number; filename: string }[]> {
  const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, queryEmbedding)})`
  return db.select({
    content: documentChunks.content,
    similarity,
    chunkId: documentChunks.id,
    documentId: documentChunks.documentId,
    filename: documents.filename,
  }).from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(and(eq(documentChunks.projectId, projectId), gt(similarity, threshold)))
    .orderBy(desc(similarity))
    .limit(topK)
}
```

- [ ] **Step 2: Update the writers** in `src/app/actions.ts` so embeddings store as `number[]` (not JSON). The vector column accepts a number array directly. In `saveMessageEmbedding` change `embedding: JSON.stringify(embedding)` → `embedding`. In `updateChunkEmbedding` change `.set({ embedding: JSON.stringify(embedding) })` → `.set({ embedding })`. Also drop the now-unused `JSON.parse` in `getDocumentChunksForProject`/`getEmbeddingsForProject` callers — but those live in `embeddings.ts` which no longer parses (the SQL returns scalars), so just confirm no `JSON.parse(embedding)` remains: `grep -n "JSON.parse" src/lib/embeddings.ts` → no matches.

- [ ] **Step 3: Write the vector-search test** — `tests/unit/db/vector-search.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { findSimilarDocumentChunks } from '@/lib/embeddings'
import { projects, documents, documentChunks } from '@/db/schema'

const vec = (base: number) => Array.from({ length: 768 }, (_, i) => (i === 0 ? base : 0))

describe('findSimilarDocumentChunks (pgvector)', () => {
  beforeEach(async () => { await createTestDb() })

  it('returns the nearest chunk above threshold, scoped to project', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const [d] = await testDb.insert(documents).values({
      projectId: p.id, filename: 'spec.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 1,
    }).returning()
    await testDb.insert(documentChunks).values([
      { documentId: d.id, projectId: p.id, chunkIndex: 0, content: 'near', embedding: vec(1) },
      { documentId: d.id, projectId: p.id, chunkIndex: 1, content: 'opposite', embedding: vec(-1) },
    ])
    const results = await findSimilarDocumentChunks(vec(1), p.id, 3, 0.5)
    expect(results[0].content).toBe('near')
    expect(results[0].filename).toBe('spec.pdf')
    expect(results.find(r => r.content === 'opposite')).toBeUndefined() // below threshold
  })

  it('returns nothing for an unrelated project scope', async () => {
    const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
    const results = await findSimilarDocumentChunks(vec(1), p.id + 999, 3, 0.5)
    expect(results).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run the embeddings + vector tests (targeted)**

Run: `npx vitest run tests/unit/db/vector-search.test.ts tests/unit/lib/embeddings.test.ts`
Expected: PASS. (The existing `embeddings.test.ts` may assert on the old `cosineSimilarity` export — if so, update it to test the new SQL-based behavior via `testDb`, or delete assertions that tested the deleted helper. Keep coverage of real behavior, not the removed function.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings.ts src/app/actions.ts tests/unit/db/vector-search.test.ts tests/unit/lib/embeddings.test.ts
git commit -m "feat(phase-b): native pgvector retrieval (HNSW cosine)"
```

---

## Task 6: Integration — full green + remove libSQL (Backend/QA role)

**Files:** `package.json`, plus any test fixups surfaced here

- [ ] **Step 1: Run the FULL gate locally** (red zone ends here)

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: typecheck clean, 0 lint errors, **entire Vitest suite green**. Fix any straggler test that still assumed SQLite semantics (e.g. a hardcoded `JSON.parse`, or a chat-route test mock that referenced libSQL).

- [ ] **Step 2: Remove the now-unused libSQL dependency**

Run: `npm uninstall @libsql/client`
Then `grep -rn "@libsql/client\|drizzle-orm/libsql" src tests` → expect **no matches** (all converted).

- [ ] **Step 3: Re-run the gate after removal**

Run: `npx tsc --noEmit && npm test`
Expected: still all green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tests/
git commit -m "chore(phase-b): drop @libsql/client; full suite green on postgres"
```

---

## Task 7: Documentation (Docs role)

**Files:** `CLAUDE.md`, `CHANGELOG.md`, `docs/chatlog-2026-06-07-phase-b-supabase-pgvector.md` (new)

- [ ] **Step 1: Update `CLAUDE.md`** — Database section: Postgres via Supabase (`postgres-js`, pooled `prepare:false` runtime + `DIRECT_URL` migrations), Drizzle migrations in `drizzle/`, pgvector `vector(768)` + HNSW. Update the "Context Pipeline" embeddings note (retrieval is now indexed SQL via `cosineDistance`, not brute-force). Update Testing section: PGlite test harness (`createTestDb` applies migrations + loads `vector`). Update env: `DATABASE_URL` + `DIRECT_URL` replace `TURSO_*`.

- [ ] **Step 2: Update `CHANGELOG.md`** — add a `[4.0.0]` entry (breaking: DB engine change) summarizing the Supabase/pgvector migration, PGlite tests, fresh start, libSQL removal.

- [ ] **Step 3: Write `docs/chatlog-2026-06-07-phase-b-supabase-pgvector.md`** — decisions (Supabase chosen over Turso-native for future headroom; integer identity PKs; PGlite tests; reranking deferred to B2), and the migration outline.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md docs/chatlog-2026-06-07-phase-b-supabase-pgvector.md
git commit -m "docs(phase-b): document Supabase/pgvector migration"
```

---

## Task 8: Deploy cutover runbook (Docs/DevOps role — user-executed)

**Files:** none (a runbook to follow with the user's Supabase credentials)

> This task is **run by the user** with their Supabase project. The agent prepares and documents it; it does not need secrets.

- [ ] **Step 1:** In the Supabase dashboard, confirm the `vector` extension is available (it ships with Supabase; the `0000` migration enables it).
- [ ] **Step 2:** Get two connection strings from Supabase → Project Settings → Database: the **pooled** (Transaction, port 6543) URL → `DATABASE_URL`, and the **direct** (port 5432) URL → `DIRECT_URL`. Put both in `.env.local` (gitignored) and in the Vercel project env. Remove `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- [ ] **Step 3:** Apply migrations to Supabase: `DIRECT_URL=... npx drizzle-kit migrate`.
- [ ] **Step 4:** `npm run dev` and smoke-test (below).

---

## Task 9: Verification gate + manual smoke

**Files:** none

- [ ] **Step 1: Full automated gate**

Run: `npm install && npm run lint && npm run build && npm test && npm run test:e2e`
Expected: all green, zero warnings. (PGlite needs no secrets; E2E stays key-independent.)

- [ ] **Step 2: Manual smoke against real Supabase** (`npm run dev`, after Task 8):
  - Create a project; upload a construction PDF → it processes to "ready".
  - Ask a question answerable from the doc → the reply cites it (document retrieval via pgvector works).
  - Send several messages, reload → chats/messages/attachments persist (Postgres round-trips).
  - Confirm a Claude chat + a Nano Banana image still work (Phase A intact).

- [ ] **Step 3: Tag (after gate + smoke pass)**

```bash
git tag -a phase-b -m "Phase B: Supabase Postgres + pgvector"
```

---

## Self-review (plan author)

**Spec coverage:** deps (T1) · postgres-js + pooled/direct (T2/T3) · pgvector vector(768)+HNSW (T2) · migrations introduced (T2) · PGlite tests (T3) · integer identity PKs (T2) · schema conversion rules (T2) · indexed retrieval keeping signatures (T5) · actions sweep (T4) · libSQL removal (T6) · docs (T7) · deploy cutover (T8) · gate (T9). ✅

**Red-zone honesty:** Tasks 2–5 explicitly use targeted verification; full `tsc`/`build`/suite reserved for T6/T9. Vitest's per-file transform makes targeted tests valid mid-migration. ✅

**Placeholder scan:** every code step shows complete code; the actions sweep gives an exact line-number checklist rather than "similar to". ✅

**Type consistency:** `vector('embedding', { dimensions: 768 })`, `cosineDistance`, `gt(similarity, threshold)`, `createTestDb`/`testDb`, identity PK helper used identically across tasks. ✅

**To verify live during execution (flagged, not guessed):** the `@electric-sql/pglite/vector` import path and `drizzle-orm/pglite/migrator` (proven in T3 Step 4 before anything else proceeds).
