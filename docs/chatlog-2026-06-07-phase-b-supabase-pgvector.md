# Chatlog — 2026-06-07 — Phase B: Supabase Postgres + pgvector

## How the direction was chosen

The original RAG scan flagged the brute-force JSON-cosine retrieval as the real bottleneck. When the user said they'd use the app "heavily for construction projects," I initially leaned toward Supabase. The user then clarified they're a **vibe coder optimizing for simplicity**, so I gave the honest senior-engineer counter-recommendation: **stay on Turso + native vectors** (smaller, safer, reversible; Vercel Blob covers Phase C files), because pgvector's real advantage is multi-tenant SaaS scale, not a solo workhorse.

The user heard the trade-off and **still chose Supabase + pgvector** — a deliberate, informed bet on future headroom. We proceeded with that.

## Locked decisions

- **Fresh start** (local DB was ~empty); **user already has a Supabase project**.
- **Integer PKs via `GENERATED ALWAYS AS IDENTITY`** (not UUIDs) — faster joins on a join-heavy schema, no `number→string` blast radius, enumeration not in the single-user threat model.
- **Drizzle on `postgres-js`** — pooled `DATABASE_URL` (`prepare:false`) at runtime, `DIRECT_URL` for migrations.
- **PGlite for tests** (in-process Postgres + `vector` extension) — keeps CI secret-free.
- **Combined scope**: platform migration + native pgvector together; **reranking deferred to Phase B2**.

## What shipped (branch `phase-b-supabase-pgvector`)

Executed via the role-based agent stack (Database / Backend / QA / Reviewer / Docs) with spec + code-quality review per task:

1. Deps: `postgres` (runtime), `@electric-sql/pglite` (dev).
2. `pg-core` schema (all 10 tables, identity PKs, `timestamptz`, `boolean`, `vector(768)` + HNSW cosine) + migrations (`0000_enable_vector` → `0001_init_schema`).
3. `postgres-js` connection + **PGlite test harness** (the highest-risk integration — proven 2/2 before anything else).
4. Ported the 24 `.all()`/`.get()` query sites in `actions.ts`/`settings.ts` (37 action tests green).
5. Native pgvector retrieval in `embeddings.ts` via Drizzle `cosineDistance` (signatures unchanged) + writers store `number[]` + a vector-search test.
6. Removed `@libsql/client`; full suite green.
7. Docs (this file, CLAUDE.md, CHANGELOG v4.0.0).

**Verification:** `tsc --noEmit` clean, **143/143 Vitest** green on Postgres/PGlite, build clean.

## Notable discoveries / decisions during execution

- **PGlite `^0.5.x` dropped the `./vector` export** — pinned to `^0.4.6` (test-only devDependency) where it works. Revisit if upgrading PGlite.
- **Test suite is ~40s now** (PGlite provisions a fresh Postgres per `createTestDb`). Acceptable; a shared-instance/truncate optimization is a possible B2 nicety.
- **`drizzle-kit generate` needs no DB connection** — migrations were authored without Supabase credentials; only `migrate` (deploy) needs `DIRECT_URL`.

## What's left for the user

- **Deploy cutover** (Task 8): provide the Supabase **pooled** (`DATABASE_URL`, :6543) and **direct** (`DIRECT_URL`, :5432) connection strings in `.env.local` + Vercel; remove `TURSO_*`; run `DIRECT_URL=... npx drizzle-kit migrate`.
- **Manual smoke** (Task 9): create a project, upload a construction PDF, confirm retrieval cites it, confirm chats persist + Phase A (Claude + Nano Banana) still work.

## Next: Phase B2 / C

- **B2 (optional):** reranking/MMR, query rewriting, threshold tuning, test-harness speedup.
- **C:** construction plan/image extraction (multimodal vision) — and Supabase Storage now becomes a natural fit for the uploaded files/images.
