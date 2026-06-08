# Phase B — Migrate to Supabase Postgres + pgvector

**Status:** Approved design (2026-06-07) · **Program:** Part 2 of the 4-phase Atelier Studio workhorse effort (A: Claude provider ✓ · **B: Supabase + pgvector** · C: construction plan/image extraction · D: Excel/Word artifacts).

---

## Goal

Move the entire data layer from libSQL/SQLite (Turso) to **Supabase Postgres**, and replace the brute-force JSON-cosine RAG with **native pgvector** indexed similarity search. Same app behavior; the storage engine and retrieval path change underneath. Fresh start — no existing data is carried over.

**Unchanged:** Claude remains the chat brain; embeddings still come from Gemini `gemini-embedding-001` (768-dim). Only the *storage and search* of vectors changes — `generateEmbedding()` is untouched, and the public signatures of `findSimilarMessages` / `findSimilarDocumentChunks` stay identical so nothing above the data layer moves.

## Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Fresh start** — no data migration | Local DB is ~empty; avoids a migration/re-embed step |
| 2 | **Use the user's existing Supabase project** | Provide connection strings; enable pgvector |
| 3 | **Driver:** Drizzle on `postgres-js` (`postgres`), Supabase **pooler** (Supavisor, transaction mode, :6543) at runtime; **direct** connection (:5432) for migrations | Drizzle-recommended Supabase setup; pooled is serverless-safe on Vercel |
| 4 | **pgvector**: embedding columns → `vector(768)` with an **HNSW** index using `vector_cosine_ops` | Native ANN search replaces load-all-and-loop |
| 5 | **Introduce Drizzle migration files** (we currently `push` with none) | Versioned schema shared across dev/test/prod is the right call for Postgres |
| 6 | **Tests on PGlite** (`@electric-sql/pglite` + its `vector` extension) | In-process Postgres keeps CI secret-free and fast; no Docker |
| 7 | **Dev** points at the hosted Supabase project via `.env.local` | Zero Docker; revisit local Supabase stack in Phase C (Storage) |
| 8 | **Integer PKs via `GENERATED ALWAYS AS IDENTITY`** (IDs stay `number`); **not** UUIDs | Faster joins/indexes on a join-heavy schema; no `number→string` blast radius; enumeration not in the single-user threat model. Add a public `slug`/UUID column later only if untrusted multi-user exposure lands. |
| 9 | **Scope: platform migration + pgvector together; reranking deferred (Phase B2)** | Avoids touching embedding columns twice; reranking is a separable quality win |

## Scope — files changed

| File | Change |
|---|---|
| `package.json` | **+** `postgres`, `@electric-sql/pglite`; **−** `@libsql/client` (at cutover) |
| `drizzle.config.ts` | `dialect: "postgresql"`; `dbCredentials` from `DIRECT_URL`; migrations `out: ./drizzle` |
| `src/db/schema.ts` | **Full rewrite** `drizzle-orm/sqlite-core` → `pg-core`: identity PKs, `timestamp(..., { withTimezone: true })`, `boolean`, FK `.references(... { onDelete: 'cascade' })` preserved; both `embedding` columns → `vector('embedding', { dimensions: 768 })`; add HNSW indexes (`messageEmbeddings.embedding`, `documentChunks.embedding`) with `vector_cosine_ops` |
| `src/db/index.ts` | postgres-js connection (pooled `DATABASE_URL`); remove `PRAGMA foreign_keys` (Postgres enforces FKs natively) |
| `src/lib/embeddings.ts` | `findSimilarMessages` / `findSimilarDocumentChunks` become a single indexed SQL query each — `ORDER BY embedding <=> $query LIMIT k`, filtered by scope (`projectId`/`chatId`) and a cosine-similarity threshold via Drizzle's `cosineDistance`. Delete the load-all + JS `cosineSimilarity` path. `saveMessageEmbedding` / `updateChunkEmbedding` write `number[]` straight into the `vector` column (no `JSON.stringify`). |
| `src/app/actions.ts` | Mechanical sweep: libSQL `.all()` → `await` (returns array), `.get()` → `[0]`; `count()`, `onConflictDoUpdate`, `db.transaction`, `.returning()` port unchanged |
| `tests/helpers/test-db.ts` | PGlite-backed `createTestDb`: `new PGlite({ extensions: { vector } })` → `CREATE EXTENSION vector` → apply Drizzle migrations → return a `drizzle-orm/pglite` instance shaped like `@/db` |
| `src/db/schema.ts` consumers (tests) | The action/embedding tests run against the PGlite `testDb`; assertions stay, but any libSQL-specific expectations get updated |
| `CLAUDE.md`, `CHANGELOG.md` | DB section (Postgres/pgvector/migrations), env vars, deploy cutover, gotchas |

## Schema conversion rules (applied uniformly)

- `integer('id').primaryKey({ autoIncrement: true })` → `integer('id').primaryKey().generatedAlwaysAsIdentity()`
- FK columns: `integer('x_id').references(() => t.id, { onDelete: 'cascade' })` (unchanged shape; pg enforces)
- `integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())` → `timestamp('created_at', { withTimezone: true }).defaultNow()`
- `integer('archived', { mode: 'boolean' }).notNull().default(false)` → `boolean('archived').notNull().default(false)`
- `text('embedding')` (JSON 768) → `vector('embedding', { dimensions: 768 })` (nullable on `documentChunks` until processed)
- All existing `index(...)`/`uniqueIndex(...)` preserved; **add** two HNSW vector indexes.

## Data flow (retrieval, after)

`/api/chat` → `generateEmbedding(query)` (Gemini, unchanged) → `findSimilarDocumentChunks` / `findSimilarMessages` each run one indexed SQL query (`WHERE projectId=… ORDER BY embedding <=> $query LIMIT k`, filtered by the cosine threshold) → identical return shape → unchanged five-layer context assembly. Document threshold stays cosine ≥ 0.5 (top-3); message threshold cosine ≥ 0.7 (top-5) — expressed as `1 - (embedding <=> query) >= threshold`.

## Deployment cutover

- Provision: enable `pgvector` on the Supabase project; run `drizzle-kit migrate` against the **direct** connection.
- Vercel: replace `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` with `DATABASE_URL` (pooled) and `DIRECT_URL` (direct); redeploy.
- postgres-js runs on Node (Fluid Compute) — no Edge.

## Testing strategy

The existing Vitest suite is the safety net and must stay green after porting to PGlite (it already exercises server actions + embeddings). New tests: (a) a **pgvector similarity test** — insert known vectors, assert ordering + threshold filtering; (b) a **migration-apply test** — migrations (incl. `CREATE EXTENSION vector` + HNSW index) apply cleanly to a fresh PGlite. CI keeps `lint → build → vitest → playwright`, still secret-free (PGlite needs no DB; E2E stays key-independent as in Phase A).

**Verification gate (zero warnings):** `npm install && npm run lint && npm run build && npm test && npm run test:e2e`, then a manual `npm run dev` smoke against the real Supabase project (create a project, upload a doc, confirm retrieval cites it, confirm a chat persists).

## Execution model (role-based agent stack)

Per the saved Coding Sessions Agent Stack Reference, Phase B executes via role-framed subagents around this spec as the single source of truth: **Database** (schema rewrite, migrations, pgvector + HNSW), **Backend** (`actions.ts` sweep, `embeddings.ts` query rewrite, connection), **QA/Breaker** (PGlite harness, vector ordering/threshold + migration-apply tests), **Reviewer** (per-task spec + code-quality gates), **Docs/DevOps** (env/connection cutover, CLAUDE.md/CHANGELOG, deploy). Frontend role is unused (no UI change). Each task hands off changed files + assumptions + integration notes; review gates run before merge.

## Sequencing

deps → schema rewrite → drizzle config + connection → generate migrations + PGlite test harness (**prove on one table first** — highest-risk setup) → port `actions.ts` → pgvector search in `embeddings.ts` → full suite green → docs → deploy cutover.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| PGlite + migrations (extension + HNSW index) setup is fiddly | Prove the harness on one table before porting the rest; verify `vector` extension loads in PGlite |
| `actions.ts` `.all()/.get()` sweep misses a call | Full existing test suite on PGlite fails loudly on any broken query |
| Timestamp/boolean semantic drift | Schema-conversion rules applied uniformly; tests assert behavior |
| Exact Drizzle pgvector / pglite / `cosineDistance` API differs from memory | Verify via Context7 + the Supabase skill during writing-plans before coding |
| Deploy cutover (pooled vs direct URL confusion) | Documented split: pooled at runtime, direct for migrations |

## Non-goals (Phase B)

- Reranking / MMR / query rewriting (**Phase B2**).
- Supabase Storage, Auth, Realtime (Storage arrives with **Phase C**).
- Data migration from Turso (fresh start).
- Any UI/provider change (Claude + the picker stay exactly as Phase A left them).

## Definition of done

- [ ] Drizzle on Postgres (`postgres-js`), pooled runtime + direct migrations; `@libsql/client` removed.
- [ ] All 10 tables on Postgres with identity PKs, `timestamptz`, `boolean`, cascade FKs; pgvector enabled.
- [ ] Both embedding columns are `vector(768)` with HNSW cosine indexes; retrieval is indexed SQL (no JS load-all).
- [ ] `findSimilarMessages` / `findSimilarDocumentChunks` keep their signatures; chat retrieval behaves as before.
- [ ] Vitest suite ported to PGlite and green; new pgvector + migration-apply tests pass.
- [ ] Full gate passes zero-warning; manual dev smoke against real Supabase done.
- [ ] `CLAUDE.md` + `CHANGELOG.md` updated; deploy cutover documented; session chatlog written.
