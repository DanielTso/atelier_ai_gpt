# Audit Remediation (Phase 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the release-blocking findings from the 2026-09-01 audit in the order that keeps them cheap — everything that must land before migration `0018` is applied, then everything that must land before the six local commits are pushed.

**Architecture:** Two phases. Phase 1 changes only pricing, schema and migrations (Sonnet 5 standing rate; indexes + CHECK constraints on `usage_events`; RLS declared in code for every table; anon grants revoked) and ends with the user-gated `drizzle-kit migrate`. Phase 2 fixes the red test gate, declares four phantom dependencies, patches `next` for the proxy-bypass advisory, and makes the chat route's usage capture survive aborts and client disconnects. Phase 3 (user-facing fixes: wrong-chat write, archived chats, duplicate re-save, hybrid page anchors, PDF quotes, storage sweeps) is a separate plan.

**Tech Stack:** Next.js 16 App Router · AI SDK v6 (`ai@6.0.230`) · Drizzle ORM 0.45 + drizzle-kit 0.31 · Supabase Postgres 17 + pgvector · Vitest 4 with PGlite.

**Spec:** `docs/audits/2026-09-01-codebase-audit.md` — §1 (top ten), §2.2 C1/C2, §2.3 D3/D4 + S3, §2.6 Q1, §2.7 K1, §4 (release order). Finding ids below refer to that document.

## Global Constraints

- **Code style:** hand-written **single-quote, no-semicolon** in `src/` and `tests/` — match the surrounding file exactly (`src/db/schema.ts` uses semicolons; keep them there). **Never run `prettier --write`** (no config exists; it would reformat whole files).
- **Commits:** Conventional Commits 1.0, imperative lowercase description, no trailing period. Commit locally to `master`. **Never push** — the push is a user decision at the end of Task 10.
- **Verification gate** (per CLAUDE.md): `npm run typecheck` (0 errors) → `npm run lint` (0 errors; 24 baseline warnings) → `rm -rf .next && npm run build` → `npm test`. Run the full gate in Tasks 7 and 10; run the targeted commands each task names otherwise.
- **Migrations:** author with `npx drizzle-kit generate`; **never `npx drizzle-kit push`** (it introspects live and would drop `document_chunks.content_tsv`, the two GIN indexes and the out-of-band RLS flags). Applying to Supabase is **user-gated** (Task 4 only). Migrate **before** pushing.
- **Environment:** `.env.local` has a UTF-8 BOM on line 1 and points `DATABASE_URL`/`DIRECT_URL` at **production**. Unit tests use PGlite and must never need it. Do not start `next dev`.
- **Model tiers** (per task, from `feedback_model_tiering_by_criticality`): **Fable** = DB/migrations/auth/chat-route critical path; **Sonnet** = mechanical edits and dependency bumps; **Opus** = docs.
- **Repo scratch:** throwaway files go in the session scratchpad, never in the repo.

---

## Phase 1 — before migration `0018` is applied

### Task 1: Sonnet 5 standing rate (C2) — tier: Fable

**Files:**
- Modify: `src/lib/models/pricing.ts:14-19`
- Modify: `tests/unit/lib/models/pricing.test.ts:19-24`
- Modify: `tests/unit/lib/models/registry.test.ts:577-579`

**Interfaces:**
- Consumes: `resolvePricing(modelId, family, overrides)` (existing, unchanged signature).
- Produces: `EXACT_PRICING['claude-sonnet-5'] === { inputPerMTok: 3, outputPerMTok: 15 }`. Later tasks and the running app freeze this into `usage_events.cost_usd`.

- [ ] **Step 1: Change the two tests to expect the standing rate**

In `tests/unit/lib/models/pricing.test.ts` replace lines 19–24 with:

```ts
  it('uses the exact-id table when there is no override', () => {
    // Claude Sonnet 5 standing rate: 3/15 (the 2/10 introductory window ended 2026-08-31).
    expect(resolvePricing('claude-sonnet-5', 'sonnet', {})).toEqual({
      inputPerMTok: 3, outputPerMTok: 15, estimated: false,
    })
  })
```

In `tests/unit/lib/models/registry.test.ts` replace lines 577–579 with:

```ts
      // EXACT_PRICING (pricing.ts) and STATIC_SEED (seed.ts) both carry the
      // 3/15 standing rate — the 2/10 introductory window ended 2026-08-31.
      expect(sonnet5?.pricing).toEqual({ inputPerMTok: 3, outputPerMTok: 15, estimated: false })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/models/pricing.test.ts tests/unit/lib/models/registry.test.ts`
Expected: 2 failures — both `expected { inputPerMTok: 2, outputPerMTok: 10, … } to equal { inputPerMTok: 3, outputPerMTok: 15, … }`.

- [ ] **Step 3: Fix the pricing table and its comment**

In `src/lib/models/pricing.ts` replace lines 14–19 with:

```ts
  // Standing rate. The $2/$10 introductory window ended 2026-08-31 — this
  // table has NO date logic, so an expiring rate must be edited by hand on the
  // day it expires (or corrected without a deploy via the
  // `model-pricing-overrides` settings row). Costs are frozen into DB rows at
  // write time; a stale entry here mis-prices history permanently.
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/models`
Expected: all files pass (0 failures).

- [ ] **Step 5: Commit**

```bash
git add src/lib/models/pricing.ts tests/unit/lib/models/pricing.test.ts tests/unit/lib/models/registry.test.ts
git commit -m "fix(pricing): sonnet 5 standing rate after the introductory window"
```

---

### Task 2: `usage_events` indexes + CHECK constraints (D3, D4) — tier: Fable

**Files:**
- Modify: `src/db/schema.ts:1` (import), `src/db/schema.ts:251-254` (table extras)
- Create: `drizzle/0019_usage_events_indexes_checks.sql` (generated) + `drizzle/meta/0019_snapshot.json` (generated) + `drizzle/meta/_journal.json` entry (generated)
- Test: `tests/unit/db/migration-0019.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` / `testDb` from `tests/helpers/test-db.ts` (runs every migration in `drizzle/` against PGlite).
- Produces: indexes `idx_usage_events_created_at`, `idx_usage_events_project_id`; constraints `usage_events_purpose_chk` (six allowed purposes) and `usage_events_tokens_nonneg_chk`. Task 9's CLAUDE.md edit names them.

- [ ] **Step 1: Write the failing migration test**

Create `tests/unit/db/migration-0019.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

// drizzle-orm/pglite's execute() returns { rows }, but postgres-js returns a bare
// array. Normalize so this test asserts the same way regardless of driver shape.
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

// Migration 0019 (audit D3/D4): the rollup filters created_at alone and the
// project_id FK is SET NULL on project delete — both need their own index; and
// purpose/token columns get CHECKs so a typo can never silently drop rows.
describe('migration 0019 — usage_events indexes + CHECKs', () => {
  beforeEach(async () => { await createTestDb() })

  it('creates the created_at and project_id indexes', async () => {
    const res = await testDb.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'usage_events'
        AND indexname IN ('idx_usage_events_created_at', 'idx_usage_events_project_id')
    `)
    const names = rowsOf<{ indexname: string }>(res).map(r => r.indexname).sort()
    expect(names).toEqual(['idx_usage_events_created_at', 'idx_usage_events_project_id'])
  })

  it('rejects an unknown purpose', async () => {
    await expect(testDb.execute(sql`
      INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('bogus', 'claude-opus-4-8', 0)
    `)).rejects.toThrow(/usage_events_purpose_chk/)
  })

  it('accepts every documented purpose', async () => {
    for (const purpose of ['chat', 'artifact-regenerate', 'summarize', 'generate-title', 'classify', 'memory-suggest']) {
      await testDb.execute(sql`
        INSERT INTO usage_events (purpose, model, cost_usd) VALUES (${purpose}, 'claude-opus-4-8', 0)
      `)
    }
    const res = await testDb.execute(sql`SELECT count(*)::int AS n FROM usage_events`)
    expect(rowsOf<{ n: number }>(res)[0].n).toBe(6)
  })

  it('rejects negative token counts and negative cost', async () => {
    await expect(testDb.execute(sql`
      INSERT INTO usage_events (purpose, model, output_tokens, cost_usd) VALUES ('chat', 'claude-opus-4-8', -5, 0)
    `)).rejects.toThrow(/usage_events_tokens_nonneg_chk/)
    await expect(testDb.execute(sql`
      INSERT INTO usage_events (purpose, model, cost_usd) VALUES ('chat', 'claude-opus-4-8', -0.01)
    `)).rejects.toThrow(/usage_events_tokens_nonneg_chk/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/db/migration-0019.test.ts`
Expected: FAIL — index test expects 2 names and gets `[]`; the reject tests resolve instead of throwing.

- [ ] **Step 3: Declare the indexes and CHECKs in the schema**

In `src/db/schema.ts` line 1, add `check` to the pg-core import and import `sql`:

```ts
import { pgTable, text, integer, boolean, timestamp, vector, index, uniqueIndex, jsonb, numeric, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

Replace the `usageEvents` extras (lines 251–254, the array after `(table) => [`) with:

```ts
}, (table) => [
  index('idx_usage_events_chat_id').on(table.chatId),
  index('idx_usage_events_model_created').on(table.model, table.createdAt),
  // Audit D3: the monthly rollup filters created_at alone (unservable by the
  // composite above), and project_id is SET NULL on project delete — without
  // this index every project delete seq-scans the fastest-growing table.
  index('idx_usage_events_created_at').on(table.createdAt),
  index('idx_usage_events_project_id').on(table.projectId),
  // Audit D4: purpose is the only free-text enum a rollup groups on. Keep in
  // sync with the UsagePurpose union in src/lib/usage.ts.
  check('usage_events_purpose_chk', sql`${table.purpose} in ('chat', 'artifact-regenerate', 'summarize', 'generate-title', 'classify', 'memory-suggest')`),
  check('usage_events_tokens_nonneg_chk', sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.cacheReadTokens} >= 0 and ${table.cacheCreationTokens} >= 0 and ${table.costUsd} >= 0`),
]).enableRLS();
```

- [ ] **Step 4: Generate the migration and inspect it**

Run: `npx drizzle-kit generate --name=usage_events_indexes_checks`
Expected: creates `drizzle/0019_usage_events_indexes_checks.sql`, `drizzle/meta/0019_snapshot.json`, and appends an `idx: 19` entry to `drizzle/meta/_journal.json`.

Run: `cat drizzle/0019_usage_events_indexes_checks.sql`
Expected: exactly four statements — `ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_purpose_chk" CHECK (…)`, `ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tokens_nonneg_chk" CHECK (…)`, `CREATE INDEX "idx_usage_events_created_at" …`, `CREATE INDEX "idx_usage_events_project_id" …`. If it contains anything else (a DROP, an unrelated ALTER), stop: the schema edit touched something it shouldn't — `git diff src/db/schema.ts` and fix before continuing.

Run: `npx drizzle-kit check`
Expected: `Everything's fine 🐶🔥`

- [ ] **Step 5: Run the migration test and the existing DB suite**

Run: `npx vitest run tests/unit/db tests/unit/lib/usage.test.ts tests/unit/actions/usage-rollups.test.ts`
Expected: all pass, including the new 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/0019_usage_events_indexes_checks.sql drizzle/meta/0019_snapshot.json drizzle/meta/_journal.json tests/unit/db/migration-0019.test.ts
git commit -m "feat(db): index usage_events by created_at and project_id; add purpose and non-negative checks"
```

---

### Task 3: RLS declared for every table + anon grants revoked (S3) — tier: Fable

**Files:**
- Modify: `src/db/schema.ts` — table closers at lines 16, 31, 42, 48, 63, 87, 108, 124, 147, 177, 192, 203, 270 (13 tables)
- Create: `drizzle/0020_enable_rls_all_tables.sql` (generated) + snapshot + journal entry
- Create: `drizzle/0021_revoke_anon_grants.sql` (custom, hand-written) + journal entry
- Modify: `CLAUDE.md` — the Migrations bullet's parenthetical `(Legacy `npx drizzle-kit push` is no longer the workflow.)`
- Test: `tests/unit/db/migration-0020.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` / `testDb`.
- Produces: `relrowsecurity = true` on all 16 tables from the migration chain alone (no dashboard step). `0021` is a no-op on PGlite/CI (no `anon` role) and revokes on Supabase.

- [ ] **Step 1: Write the failing migration test**

Create `tests/unit/db/migration-0020.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[]))
}

// Migration 0020 (audit S3): RLS used to be enabled on 12 tables only in the
// live Supabase dashboard — invisible to schema.ts and the migrations, so a
// fresh environment came up anon-readable. Now every table declares it.
describe('migration 0020 — RLS on every public table', () => {
  beforeEach(async () => { await createTestDb() })

  it('enables row-level security on all 16 app tables', async () => {
    const res = await testDb.execute(sql`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `)
    const rows = rowsOf<{ relname: string; relrowsecurity: boolean }>(res)
    expect(rows.map(r => r.relname)).toEqual([
      'artifact_versions', 'artifacts', 'chat_topics', 'chats', 'document_chunks', 'document_revisions',
      'documents', 'generated_images', 'memory_suggestions', 'message_attachments', 'message_embeddings',
      'messages', 'persona_usage', 'projects', 'settings', 'usage_events',
    ])
    expect(rows.every(r => r.relrowsecurity)).toBe(true)
  })

  it('still lets the table owner read and write (no policies needed)', async () => {
    // PGlite connects as the owner, exactly like the app's `postgres` role on
    // Supabase — owners bypass RLS, so zero policies is the intended state.
    await testDb.execute(sql`INSERT INTO projects (name) VALUES ('rls-owner-check')`)
    const res = await testDb.execute(sql`SELECT count(*)::int AS n FROM projects`)
    expect(rowsOf<{ n: number }>(res)[0].n).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/db/migration-0020.test.ts`
Expected: FAIL on `rows.every(r => r.relrowsecurity)` — 13 tables are `false`.

- [ ] **Step 3: Chain `.enableRLS()` on the 13 remaining tables**

In `src/db/schema.ts`, change each of these closers (the line numbers are pre-edit; each edit is one line):

| Table | Line | Change |
|---|---|---|
| `projects` | 16 | `});` → `}).enableRLS();` |
| `chats` | 31 | `]);` → `]).enableRLS();` |
| `messages` | 42 | `]);` → `]).enableRLS();` |
| `settings` | 48 | `});` → `}).enableRLS();` |
| `messageEmbeddings` | 63 | `]);` → `]).enableRLS();` |
| `documents` | 87 | `]);` → `]).enableRLS();` |
| `documentRevisions` | 108 | `]);` → `]).enableRLS();` |
| `documentChunks` | 124 | `]);` → `]).enableRLS();` |
| `artifacts` | 147 | `]);` → `]).enableRLS();` |
| `personaUsage` | 177 | `]);` → `]).enableRLS();` |
| `messageAttachments` | 192 | `]);` → `]).enableRLS();` |
| `chatTopics` | 203 | `]);` → `]).enableRLS();` |
| `memorySuggestions` | 270 | `]);` → `]).enableRLS();` |

`artifactVersions`, `generatedImages`, `usageEvents` already have it. Verify with `grep -c "enableRLS" src/db/schema.ts` → `16`.

- [ ] **Step 4: Generate the RLS migration and inspect it**

Run: `npx drizzle-kit generate --name=enable_rls_all_tables`
Expected: `drizzle/0020_enable_rls_all_tables.sql` containing exactly 13 lines of the form `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;` separated by `--> statement-breakpoint`, and nothing else.

- [ ] **Step 5: Write the custom revoke migration**

Run: `npx drizzle-kit generate --custom --name=revoke_anon_grants`
Expected: an empty `drizzle/0021_revoke_anon_grants.sql` plus a journal entry.

Replace the file's contents with:

```sql
-- Audit S3, belt-and-braces behind RLS: the app never uses PostgREST (every
-- read goes through server actions on the table-owning `postgres` role), so
-- the browser-shipped anon key needs no table grants at all. Guarded so the
-- same migration is a no-op on PGlite (tests) and the CI pgvector service,
-- where the Supabase roles do not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
```

- [ ] **Step 6: Run the DB suite (the migrator applies 0019–0021 on PGlite)**

Run: `npx vitest run tests/unit/db tests/unit/actions`
Expected: all pass, including the 2 new tests. If `0021` errors on PGlite, the guard is wrong — the `DO` block must be the file's only statement.

Run: `npx drizzle-kit check`
Expected: `Everything's fine 🐶🔥`

- [ ] **Step 7: Record the `push` prohibition in CLAUDE.md**

In `CLAUDE.md`, in the **Database → Migrations** bullet, replace the parenthetical

```
(Legacy `npx drizzle-kit push` is no longer the workflow.)
```

with

```
**`npx drizzle-kit push` is FORBIDDEN in this repo** — it introspects the live DB and would emit DROPs for `document_chunks.content_tsv` + `idx_chunks_tsv`/`idx_chunks_trgm` (raw migration `0016`, invisible to `schema.ts`) and, before `0020`, `DISABLE ROW LEVEL SECURITY` for the tables whose RLS lived only in the dashboard. Always `generate` → `migrate`.
```

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/0020_enable_rls_all_tables.sql drizzle/0021_revoke_anon_grants.sql drizzle/meta/0020_snapshot.json drizzle/meta/_journal.json tests/unit/db/migration-0020.test.ts CLAUDE.md
git commit -m "feat(db): declare row-level security on every table and revoke anon grants"
```

(`--custom` migrations have no snapshot; if `git status` shows a `0021_snapshot.json`, add it too.)

---

### Task 4: Apply migrations `0018`–`0021` to Supabase — tier: Fable · **USER-GATED**

**Files:**
- Modify: `CLAUDE.md` — the `usage_events` bullet's `(**authored, NOT yet applied to Supabase**)` and the Migrations bullet's `Applied to Supabase: `0000`–`0017`; **`0018` authored, pending apply**`
- Create (scratchpad only): `verify-migrations.mjs`

**Interfaces:**
- Consumes: the four migration files from Tasks 2–3 plus the pre-existing `0018_dapper_morg.sql`.
- Produces: `drizzle.__drizzle_migrations` = 22 rows; `public.usage_events` exists with 4 indexes + 2 CHECKs; `relrowsecurity = true` on 16 tables; `anon`/`authenticated` hold no table grants.

- [ ] **Step 1: STOP and get explicit approval**

This step writes to the production database. Do not proceed until the user has approved running the migrate. Show them: `git log --oneline 6d1449a..HEAD` and `ls drizzle/00{18,19,20,21}*.sql`.

- [ ] **Step 2: Apply**

`drizzle.config.ts` resolves `process.env.DIRECT_URL || DATABASE_URL`, but drizzle-kit does **not** load `.env.local` itself, and that file has a UTF-8 BOM on line 1. `.env.local`'s `DIRECT_URL` is the session pooler on :5432 (the direct host is IPv6-only). Run from the repo root in git bash:

```bash
DIRECT_URL="$(sed '1s/^\xEF\xBB\xBF//' .env.local | grep '^DIRECT_URL=' | cut -d= -f2- | tr -d '"\r')" npx drizzle-kit migrate
```

Expected: four `applied` lines, `0018_dapper_morg` → `0021_revoke_anon_grants`, no errors. If it reports `0017` as applied too, stop — the journal or the live table is not what the audit verified.

- [ ] **Step 3: Verify read-only**

Write to the scratchpad (not the repo) `verify-migrations.mjs`:

```js
import postgres from 'C:/Users/dnlts/OneDrive/Documents/01_Projects/01_Coding/03_atelier_ai_gpt/node_modules/postgres/src/index.js'
import { readFileSync } from 'node:fs'
const env = readFileSync('C:/Users/dnlts/OneDrive/Documents/01_Projects/01_Coding/03_atelier_ai_gpt/.env.local', 'utf8').replace(/^\uFEFF/, '')
const url = env.split(/\r?\n/).find(l => l.startsWith('DIRECT_URL=')).slice('DIRECT_URL='.length).replace(/^"|"$/g, '')
const sql = postgres(url, { prepare: false, max: 1 })
console.log('migrations:', (await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n)
console.log('usage_events:', (await sql`select to_regclass('public.usage_events')::text as t`)[0].t)
console.log('usage_events indexes:', (await sql`select indexname from pg_indexes where tablename='usage_events' order by 1`).map(r => r.indexname))
console.log('usage_events checks:', (await sql`select conname from pg_constraint where conrelid='public.usage_events'::regclass and contype='c' order by 1`).map(r => r.conname))
console.log('rls off on:', (await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`).map(r => r.relname))
console.log('anon/authenticated table grants:', (await sql`select count(*)::int as n from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')`)[0].n)
await sql.end({ timeout: 5 })
```

Run: `node <scratchpad>/verify-migrations.mjs`
Expected:
```
migrations: 22
usage_events: usage_events
usage_events indexes: [ 'idx_usage_events_chat_id', 'idx_usage_events_created_at', 'idx_usage_events_model_created', 'idx_usage_events_project_id', 'usage_events_pkey' ]
usage_events checks: [ 'usage_events_purpose_chk', 'usage_events_tokens_nonneg_chk' ]
rls off on: []
anon/authenticated table grants: 0
```

- [ ] **Step 4: Update the two migration-status lines in CLAUDE.md**

In the `usage_events` bullet change `(**authored, NOT yet applied to Supabase**)` to `(**applied to Supabase 2026-09-11**, together with `0019` indexes/CHECKs)`.

In the Migrations bullet change

```
Applied to Supabase: `0000`–`0017`; **`0018` authored, pending apply** (see above — apply before the next deploy).
```

to

```
Applied to Supabase: `0000`–`0021` (verified 2026-09-11: `drizzle.__drizzle_migrations` = 22 rows).
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record migrations 0018-0021 applied to supabase"
```

---

## Phase 2 — before the local commits are pushed

### Task 5: Fix the red test gate (Q1) — tier: Sonnet

**Files:**
- Modify: `tests/helpers/test-db.ts:9-31`
- Modify: `tests/unit/lib/keywordSearch.test.ts:1,10-11,25-26,49-50,98-99`
- Modify: `vitest.config.ts:10-18`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createTestDb()` is safe to call from any context; an aborted first call can no longer poison later calls in the same file.

- [ ] **Step 1: Reproduce the failure**

Run: `npx vitest run tests/unit/lib`
Expected (on this machine, under parallel load): `tests/unit/lib/keywordSearch.test.ts` fails — first `Test timed out in 5000ms`, then `relation "artifact_versions" does not exist`. If it happens to pass, run it twice more; the audit reproduced it 3/3 on the full suite.

- [ ] **Step 2: Make the helper publish only after migrations finish**

Replace lines 9–31 of `tests/helpers/test-db.ts` (from `let client` through the end of `createTestDb`) with:

```ts
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
```

- [ ] **Step 3: Move `createTestDb()` into `beforeEach` in the keyword test**

In `tests/unit/lib/keywordSearch.test.ts`:

Line 1 → `import { describe, it, expect, vi, beforeEach } from 'vitest'`

Delete line 11 (`  await createTestDb()` inside `seed()`) and line 26 (the same line inside `seedTwoDocs()`).

After line 49 (`describe('findChunksByKeyword', () => {`) insert:

```ts
  beforeEach(async () => { await createTestDb() })

```

After line 98 (`describe('findChunksByKeyword oversized queries', () => {`) insert the same `beforeEach` line.

- [ ] **Step 4: Give test bodies the same budget hooks already have**

In `vitest.config.ts` replace lines 14–17 with:

```ts
    // PGlite's WASM + `vector` extension can take ~12–15s to initialize on a
    // cold/slow runner. createTestDb() runs in beforeEach (hookTimeout), but a
    // test body that touches the DB first still pays the boot cost under
    // parallel load — cover both.
    hookTimeout: 30000,
    testTimeout: 15000,
```

- [ ] **Step 5: Verify the fix twice under full parallel load**

Run: `npx vitest run tests/unit/lib/keywordSearch.test.ts`
Expected: 8/8 pass.

Run: `npm test` (twice)
Expected: `Test Files 143 passed (143)`, `Tests 991 passed (991)` both runs (985 + 4 from Task 2 + 2 from Task 3), 0 failures.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/test-db.ts tests/unit/lib/keywordSearch.test.ts vitest.config.ts
git commit -m "test: memoize pglite init and stop calling createTestDb from test bodies"
```

---

### Task 6: Declare the four phantom dependencies (K1) — tier: Sonnet

**Files:**
- Modify: `package.json` (`dependencies` + `devDependencies`), `package-lock.json`
- Modify: `src/lib/remarkCitations.ts:8-10`

**Interfaces:**
- Consumes: installed versions `@shikijs/themes@4.3.1`, `@shikijs/langs@4.3.1`, `unist-util-visit@5.1.0`, `@types/mdast@4.0.4` (must match `shiki@4.3.1` — pin the same minor).
- Produces: the four imports in `src/lib/highlighter.ts:38-68` and `src/lib/remarkCitations.ts:11-12` resolve from declared deps, not hoisted transitives.

- [ ] **Step 1: Confirm the pre-state**

Run: `grep -c "shikijs\|unist-util-visit\|@types/mdast" package.json`
Expected: `0`.

- [ ] **Step 2: Install with exact versions**

Run (OneDrive lock contention → if `EBUSY`/`EPERM`, pause sync and retry):

```bash
npm install @shikijs/themes@4.3.1 @shikijs/langs@4.3.1 unist-util-visit@5.1.0
npm install -D @types/mdast@4.0.4
```

Expected: `package.json` gains `"@shikijs/langs": "^4.3.1"`, `"@shikijs/themes": "^4.3.1"`, `"unist-util-visit": "^5.1.0"` under `dependencies` and `"@types/mdast": "^4.0.4"` under `devDependencies`. `npm ls @shikijs/themes @shikijs/langs unist-util-visit @types/mdast` shows all four at top level with no `invalid`/`extraneous`.

- [ ] **Step 3: Correct the comment that documented the transitive dependence**

In `src/lib/remarkCitations.ts` replace lines 8–10 with:

```ts
// `unist-util-visit` and `@types/mdast` are declared dependencies (audit K1 —
// they used to resolve only as hoisted transitives of react-markdown).
```

- [ ] **Step 4: Verify nothing else moved and the consumers still work**

Run: `git diff --stat package-lock.json` — expect a small diff (the four packages gain root entries; no version changes elsewhere). If unrelated packages changed version, revert with `git checkout -- package.json package-lock.json`, run `npm ci` (the audit noted five extraneous `@emnapi/*`-family packages in local `node_modules`, which can make `npm install` re-resolve), then rerun Step 2 exactly as written — the intent is only to declare, never to update.

Run: `npx tsc --noEmit && npx vitest run tests/unit/lib/remarkCitations.test.ts tests/hooks`
Expected: 0 type errors; all tests pass (the shiki-backed `CodeBlock` path is exercised by the hook suite).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/remarkCitations.ts
git commit -m "build: declare shiki, unist-util-visit and mdast packages imported directly"
```

---

### Task 7: Patch `next` for the proxy-bypass advisory (S1) — tier: Sonnet

**Files:**
- Modify: `package.json` (`next`, `eslint-config-next`), `package-lock.json`

**Interfaces:**
- Consumes: `next@16.2.11` and `eslint-config-next@16.2.11` (both published; the smallest change that leaves the `>=16.0.0 <16.2.11` advisory range). `16.3.4` is the in-range latest and a fine follow-up, but not for a pre-push hotfix.
- Produces: `npm audit --omit=dev` no longer lists `next`.

- [ ] **Step 1: Bump both packages together**

```bash
npm install next@16.2.11 eslint-config-next@16.2.11
```

Expected: `package.json` shows `"next": "^16.2.11"` and `"eslint-config-next": "^16.2.11"`; `npm ls next eslint-config-next` shows 16.2.11 for both. The `overrides.eslint-plugin-react-hooks: "7.0.1"` block stays as is.

- [ ] **Step 2: Confirm the advisory is closed**

Run: `npm audit --omit=dev --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log('next listed:', 'next' in (a.vulnerabilities||{}));console.log(a.metadata.vulnerabilities)})"`
Expected: `next listed: false`. The entries that remain are the ones the audit deferred: `pdfjs-dist` (direct; Phase 3) and the transitive `sharp` / `postcss` / `image-size` / `nanoid` / `brace-expansion` chains. If `next` is still listed, the range in the audit payload has moved — read it and pick the first patched 16.2.x.

- [ ] **Step 3: Run the full gate cold**

```bash
npm run typecheck
npm run lint
rm -rf .next && npm run build
npm test
```

Expected: 0 type errors · 0 lint errors (24 warnings) · build compiles with no warnings and the same 24-route table · `Test Files 143 passed`, `Tests 991 passed`. A Next minor/patch can change proxy or build behavior — if the build or `tests/unit/proxy.test.ts` breaks, stop and report the exact error rather than working around it.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): bump next to 16.2.11 for the app-router proxy bypass advisory"
```

---

### Task 8: Usage capture survives aborts and client disconnects (C1) — tier: Fable

**Files:**
- Modify: `src/lib/usage.ts` (add `sumUsage`)
- Modify: `src/app/api/chat/route.ts:1,198-250`
- Test: `tests/unit/lib/usage.test.ts` (new `describe('sumUsage')`)
- Test: `tests/unit/api/chat-route.test.ts:13-16` (mock gains `consumeStream`) + one new `it`

**Interfaces:**
- Consumes: `recordUsage({ chatId, projectId, purpose, model, usage })` (existing); AI SDK `streamText` options `abortSignal`, `onAbort({ steps })` where each `steps[i].usage` is a `LanguageModelUsage`; `result.consumeStream()`; `after(fn)` from `next/server` (throws `\`after\` was called outside a request scope` when there is no request — e.g. in unit tests).
- Produces: `export function sumUsage(usages: Array<LanguageModelUsage | undefined>): LanguageModelUsage | undefined` in `src/lib/usage.ts`. The chat route always ends a generation with exactly one `recordUsage` call — on finish, on abort, or on client disconnect.

- [ ] **Step 1: Write the failing `sumUsage` tests**

Append to `tests/unit/lib/usage.test.ts` (top-level, after the existing describes) and extend the import on the `from '@/lib/usage'` line to include `sumUsage`:

```ts
describe('sumUsage', () => {
  it('returns undefined when there is nothing to sum', () => {
    expect(sumUsage([])).toBeUndefined()
    expect(sumUsage([undefined, undefined])).toBeUndefined()
  })

  it('adds every field across steps, keeping the fresh/cache split intact', () => {
    const step1 = {
      inputTokens: 1300, outputTokens: 400, totalTokens: 1700,
      inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 200, cacheWriteTokens: 100 },
      outputTokenDetails: { textTokens: 400, reasoningTokens: 0 },
    } as LanguageModelUsage
    const step2 = {
      inputTokens: 50, outputTokens: 10, totalTokens: 60,
      inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 10, reasoningTokens: 0 },
    } as LanguageModelUsage
    expect(sumUsage([step1, undefined, step2])).toEqual({
      inputTokens: 1350, outputTokens: 410, totalTokens: 1760,
      inputTokenDetails: { noCacheTokens: 1050, cacheReadTokens: 200, cacheWriteTokens: 100 },
      outputTokenDetails: { textTokens: 410, reasoningTokens: 0 },
    })
    // The summed object must feed usageTokens() unchanged: fresh = noCacheTokens.
    expect(usageTokens(sumUsage([step1, step2])).inputTokens).toBe(1050)
  })

  it('keeps a field undefined only when every step lacks it', () => {
    const a = { inputTokens: 10, inputTokenDetails: {}, outputTokenDetails: {} } as LanguageModelUsage
    const b = { inputTokens: 5, outputTokens: 3, inputTokenDetails: {}, outputTokenDetails: {} } as LanguageModelUsage
    const sum = sumUsage([a, b])!
    expect(sum.inputTokens).toBe(15)
    expect(sum.outputTokens).toBe(3)
    expect(sum.totalTokens).toBeUndefined()
    expect(sum.inputTokenDetails.cacheReadTokens).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/lib/usage.test.ts`
Expected: FAIL — `sumUsage is not a function` / not exported.

- [ ] **Step 3: Implement `sumUsage`**

In `src/lib/usage.ts`, after `usageTokens()` (after line 64), add:

```ts
// Add two optional counts: undefined only when BOTH are absent, so a field no
// step reported stays absent instead of becoming a misleading 0.
function addCounts(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined
  return (a ?? 0) + (b ?? 0)
}

/**
 * Sum the usage of several completed steps into one LanguageModelUsage (the
 * shape recordUsage/usageTokens already consume). Used by the chat route's
 * onAbort — the SDK hands it `steps[]` (each with its own usage) but no
 * totalUsage, since the run never finished. Undefined when no step has usage.
 */
export function sumUsage(usages: Array<LanguageModelUsage | undefined>): LanguageModelUsage | undefined {
  const present = usages.filter((u): u is LanguageModelUsage => u != null)
  if (present.length === 0) return undefined
  return present.reduce((acc, u) => ({
    inputTokens: addCounts(acc.inputTokens, u.inputTokens),
    outputTokens: addCounts(acc.outputTokens, u.outputTokens),
    totalTokens: addCounts(acc.totalTokens, u.totalTokens),
    inputTokenDetails: {
      noCacheTokens: addCounts(acc.inputTokenDetails?.noCacheTokens, u.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: addCounts(acc.inputTokenDetails?.cacheReadTokens, u.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: addCounts(acc.inputTokenDetails?.cacheWriteTokens, u.inputTokenDetails?.cacheWriteTokens),
    },
    outputTokenDetails: {
      textTokens: addCounts(acc.outputTokenDetails?.textTokens, u.outputTokenDetails?.textTokens),
      reasoningTokens: addCounts(acc.outputTokenDetails?.reasoningTokens, u.outputTokenDetails?.reasoningTokens),
    },
  }))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/lib/usage.test.ts`
Expected: all pass, including the 3 new tests.

- [ ] **Step 5: Write the failing route test**

In `tests/unit/api/chat-route.test.ts`, replace lines 13–16 (the two mocks) with:

```ts
const mockToUIMessageStreamResponse = vi.fn<(...args: unknown[]) => Response>(() => new Response('streamed', { status: 200 }))
const mockConsumeStream = vi.fn().mockResolvedValue(undefined)
const mockStreamText = vi.fn().mockReturnValue({
  toUIMessageStreamResponse: (...args: unknown[]) => mockToUIMessageStreamResponse(...args),
  consumeStream: (...args: unknown[]) => mockConsumeStream(...args),
})
```

Then add this test inside `describe('POST /api/chat', …)`, directly after the existing `'passes totalUsage to recordUsage from onFinish'`-style test that ends at line ~510:

```ts
  it('wires abortSignal, onAbort and consumeStream so a stopped or disconnected turn still records usage', async () => {
    const project = await createProject('P')
    const chat = await createChat('c', project.id)

    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'claude-opus-4-8',
      chatId: chat.id,
    })
    expect(response.status).toBe(200)

    const options = mockStreamText.mock.calls[0][0] as {
      abortSignal?: AbortSignal
      onAbort?: (e: { steps: { usage: unknown }[] }) => void
    }
    // The request's own signal — Next aborts it when the client disconnects.
    expect(options.abortSignal).toBeInstanceOf(AbortSignal)
    expect(typeof options.onAbort).toBe('function')
    // Draining server-side is what guarantees onFinish/onAbort fire at all.
    expect(mockConsumeStream).toHaveBeenCalledOnce()

    const step = (n: number) => ({
      inputTokens: n, outputTokens: n, totalTokens: 2 * n,
      inputTokenDetails: { noCacheTokens: n, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: n, reasoningTokens: 0 },
    })
    options.onAbort!({ steps: [{ usage: step(100) }, { usage: step(20) }] })

    // Outside a Next request scope `after()` throws and the route falls back to
    // a direct call, so the write is observable synchronously here.
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith({
      chatId: chat.id,
      projectId: project.id,
      purpose: 'chat',
      model: 'claude-opus-4-8',
      usage: {
        inputTokens: 120, outputTokens: 120, totalTokens: 240,
        inputTokenDetails: { noCacheTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 120, reasoningTokens: 0 },
      },
    })
  })
```

Also extend the `@/lib/usage` `vi.doMock` inside `postChat` (line ~126) so the route's new import resolves:

```ts
    vi.doMock('@/lib/usage', async () => {
      const real = await vi.importActual<typeof import('@/lib/usage')>('@/lib/usage')
      return {
        recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
        sumUsage: real.sumUsage,
      }
    })
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/unit/api/chat-route.test.ts`
Expected: the new test FAILS on `expect(options.abortSignal).toBeInstanceOf(AbortSignal)` (undefined). Every existing test still passes.

- [ ] **Step 7: Wire the route**

In `src/app/api/chat/route.ts`:

Line 1 → `import { streamText, convertToModelMessages, stepCountIs, APICallError, type UIMessage, type LanguageModelUsage } from 'ai';`

After line 15 (`import { recordUsage } from '@/lib/usage';`) change it to:

```ts
import { after } from 'next/server';
import { recordUsage, sumUsage } from '@/lib/usage';
```

Replace the block from `const result = streamText({` (line 198) through the closing `});` of `toUIMessageStreamResponse` (line 250) with:

```ts
    // Usage capture (spec C6). Best-effort: a usage-write failure must never
    // fail the chat turn. `after()` keeps the Vercel function alive until the
    // insert lands instead of racing the freeze; outside a request scope (unit
    // tests, other runtimes) it throws, so fall back to fire-and-forget.
    const persistUsage = (usage: LanguageModelUsage | undefined) => {
      const write = () => recordUsage({ chatId: chatId ?? null, projectId, purpose: 'chat', model: modelName, usage }).catch(() => {});
      try {
        after(write);
      } catch {
        void write();
      }
    };

    const result = streamText({
      model: selectedModel,
      system: systemPrompt, // System instruction is always first, never trimmed
      messages: modelMessages,
      ...(tools && { tools }),
      ...(providerOptions && { providerOptions }),
      // Multi-step tool loop: without this streamText stops after ONE step, so the
      // model could never continue writing after a generate_image/generate_artifact
      // call (it would tease a visual and die mid-reply). 12 steps allows an
      // image-heavy experience (each image is a step); server-side web_search
      // doesn't consume steps.
      stopWhen: stepCountIs(12),
      // A generate_artifact HTML page is written as tool-call INPUT tokens — the
      // provider default (~4k) truncates the call mid-JSON and the build silently
      // never executes (seen live: "Building document…" stuck forever). 32k covers
      // a large page + prose across every Claude model in the picker.
      maxOutputTokens: 32000,
      // Cancel the upstream generation when the client goes away (Stop button,
      // tab close, network drop) — otherwise Anthropic keeps generating, and
      // billing, to maxOutputTokens for a response nobody receives.
      abortSignal: req.signal,
      // An aborted run never reaches onFinish and has no totalUsage; sum the
      // steps that did complete so the tokens already billed are still recorded.
      onAbort: ({ steps }) => {
        persistUsage(sumUsage(steps.map(s => s.usage)));
      },
      // Citation-compliance log (server-side; visible in Vercel logs). Plain
      // streamText onFinish — NOT the createUIMessageStream wrapper, which
      // masks route 500s (documented trap, see the 07-12 handoff).
      onFinish: ({ text, totalUsage }) => {
        // markers = parseable (canonical grammar); loose = cite-intended tokens
        // that fail the grammar (near-misses the renderer normalizes or strips).
        // Fresh regexes from .source — never match on the shared /g exports.
        const markers = (text.match(new RegExp(CITE_RE.source, 'g')) ?? []).length;
        const loose = (text.match(new RegExp(LOOSE_CITE_RE.source, 'g')) ?? []).length - markers;
        console.log('[cite-compliance]', JSON.stringify({ chatId, grounded, docCtx: !!documentContext, markers, loose }));
        // totalUsage is summed across the 12-step tool loop — never a single step's.
        persistUsage(totalUsage);
      },
    });

    // Drain the stream server-side regardless of the client: without this the
    // recorded-transform `flush` that calls onFinish never runs on a cancelled
    // response, and the usage row is silently lost (audit C1).
    void result.consumeStream();

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      // streamText() is synchronous — a provider error (e.g. Fable's 30-day
      // retention requirement, or a per-model thinking/effort combination the
      // registry doesn't model) is never thrown into the surrounding try/catch;
      // it's routed here instead. The default onError returns the generic
      // string below to avoid leaking server details, which is exactly what
      // masked these provider 400s before this fix. Only a genuine provider
      // API error with a 400 status gets its (truncated) message surfaced —
      // everything else stays generic. This is a residual gap, accepted by
      // design: capability derivation (C4) can't cover every org-level rule.
      onError: (error) => {
        if (APICallError.isInstance(error) && error.statusCode === 400) {
          return String(error.message).slice(0, 300);
        }
        return 'An error occurred.';
      },
    });
```

- [ ] **Step 8: Run the route tests and the type check**

Run: `npx tsc --noEmit && npx vitest run tests/unit/api/chat-route.test.ts tests/unit/lib/usage.test.ts`
Expected: 0 type errors; all tests pass including the new one. If the existing `onFinish` wiring test now fails because `mockRecordUsage` was called via the `after` fallback — it shouldn't (same synchronous fallback), but if it does, the difference is that `persistUsage` is now invoked, not `recordUsage` directly; the assertion on arguments is unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/lib/usage.ts src/app/api/chat/route.ts tests/unit/lib/usage.test.ts tests/unit/api/chat-route.test.ts
git commit -m "fix(chat): record usage on abort and drain the stream on client disconnect"
```

---

### Task 9: CHANGELOG + CLAUDE.md for Phases 1–2 — tier: Opus

**Files:**
- Modify: `CHANGELOG.md:5` (insert a new entry above `## [4.54.0]`)
- Modify: `CLAUDE.md` — Database `usage_events` bullet; Security paragraph; Testing "once per worker" sentence; Model Registry pricing sentence; Cost capture bullet

**Interfaces:**
- Consumes: the commits from Tasks 1–8.
- Produces: docs that a new session can trust (the audit's §3 counted 25 doc-vs-code mismatches; this task closes the ones these changes touch, not the whole list).

- [ ] **Step 1: Add the CHANGELOG entry**

Insert directly above `## [4.54.0] - Unreleased — Dynamic Model Registry + Cost Visibility`:

```markdown
## [4.55.0] - Unreleased — Audit remediation, phases 1–2

Source: `docs/audits/2026-09-01-codebase-audit.md` (§4 release order). Plan: `docs/plans/2026-09-11-audit-remediation.md`. Everything that had to land before migration `0018` was applied and before the local commits were pushed. Phase 3 (user-facing fixes) is a separate plan.

### Fixed

- **Sonnet 5 pricing** (audit C2) — `EXACT_PRICING` still carried the $2/$10 introductory rate after its 2026-08-31 expiry; the file has no date logic, so the comment's "reverting automatically" was false. Now $3/$15, with the comment stating that expiring rates are hand-edited. Rows written from 2026-09-01 until this fix under-report Sonnet 5 spend by 33% and are frozen — none existed, since `usage_events` had not yet been applied.
- **Usage capture on abort/disconnect** (audit C1) — `POST /api/chat` passed no `abortSignal`, no `onAbort`, and never called `consumeStream()`, so every Stop, tab close or provider error mid-stream lost its `usage_events` row and left Anthropic generating to `maxOutputTokens`. Now: `abortSignal: req.signal` cancels upstream; `onAbort` records the completed steps' usage (new `sumUsage()` in `src/lib/usage.ts`); `consumeStream()` drains server-side; the insert runs inside Next's `after()` so it never races the function freeze (falls back to fire-and-forget outside a request scope).
- **Red test gate** (audit Q1) — `keywordSearch.test.ts` called `createTestDb()` from test bodies (5 s default timeout, not the 30 s hook timeout) and `tests/helpers/test-db.ts` published `testDb` before `migrate()` resolved, so a timed-out boot poisoned the rest of the file (`relation "artifact_versions" does not exist`). Init is now a memoized promise published after migrate; `testTimeout: 15000`.

### Changed

- **`usage_events` schema** (audit D3/D4) — migration `0019`: indexes on `created_at` (the monthly rollup's filter) and `project_id` (the SET NULL FK), plus `usage_events_purpose_chk` (six purposes) and `usage_events_tokens_nonneg_chk`.
- **Row-level security declared in code** (audit S3) — migration `0020` enables RLS on all 13 tables that previously had it only via the Supabase dashboard; `0021` revokes `anon`/`authenticated` table grants (guarded no-op where those roles don't exist). The app connects as the owning `postgres` role and bypasses RLS; zero policies is intended. **`drizzle-kit push` is now documented as forbidden.**
- **Dependencies** — `next` 16.2.10 → 16.2.11 (GHSA-6gpp-xcg3-4w24, App Router proxy bypass — `src/proxy.ts` is the app's only auth) with `eslint-config-next` in lockstep; `@shikijs/themes`, `@shikijs/langs`, `unist-util-visit`, `@types/mdast` declared explicitly (audit K1 — they were imported directly but resolved only as hoisted transitives).

### Migrations

- `0018`–`0021` applied to Supabase 2026-09-11 (`drizzle.__drizzle_migrations` = 22).
```

- [ ] **Step 2: Update the five CLAUDE.md passages**

(a) Database → `usage_events` bullet: change `+ indexes on `chat_id` and `(model, created_at)`` to `+ indexes on `chat_id`, `(model, created_at)`, `created_at`, `project_id` and CHECKs `usage_events_purpose_chk` / `usage_events_tokens_nonneg_chk` (migration `0019`)`.

(b) Security paragraph: append this sentence after `…(add a Vercel WAF rule for a hard guarantee).`:

```
**Database exposure model:** every `public` table has row-level security enabled with zero policies (migration `0020` — declared in `schema.ts` via `.enableRLS()`, no longer a dashboard-only setting) and `anon`/`authenticated` hold no table grants (`0021`), so the browser-shipped `NEXT_PUBLIC_SUPABASE_ANON_KEY` cannot read or write app tables through PostgREST. The app itself is unaffected: it connects as the table-owning `postgres` role, which bypasses RLS.
```

(c) Model Registry → Pricing bullet: change `— e.g. Sonnet 5's introductory $2/$10 rate through 2026-08-31, reverting to $3/$15 after)` to `— e.g. Sonnet 5 at the $3/$15 standing rate; the table has no date logic, so an expiring rate must be hand-edited on the day, or corrected without a deploy via the override row)`.

(d) Model Registry → Cost capture bullet: append after `…never fails the request that generated the tokens.`:

```
In `/api/chat` the write goes through `after()` from `next/server` (fire-and-forget fallback outside a request scope), `streamText` gets `abortSignal: req.signal` + an `onAbort` that records the completed steps via `sumUsage()`, and `result.consumeStream()` drains the stream server-side — so a Stop, tab close, or mid-stream provider error still yields exactly one usage row and cancels the upstream generation.
```

(e) Testing → PGlite paragraph: change `are created **once per worker**; each `createTestDb()` then `TRUNCATE … RESTART IDENTITY CASCADE`s all tables for isolation — so the suite runs ~15s (was ~40s when it spun a fresh instance per test).` to `are created **once per test file** (Vitest's forks pool isolates module state per file — ~9 s per DB file, ~65 s for the whole suite); each later `createTestDb()` in that file `TRUNCATE … RESTART IDENTITY CASCADE`s all tables for isolation. Always call it from `beforeEach` (covered by `hookTimeout: 30000`); `testTimeout` is 15 s.`

- [ ] **Step 3: Verify the docs don't contradict the code**

Run: `grep -n "2/10\|introductory" CLAUDE.md src/lib/models/pricing.ts` — expect only the pricing.ts comment that explains the window ended.
Run: `grep -n "once per worker" CLAUDE.md` — expect no matches.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog and claude.md for audit remediation phases 1-2"
```

---

### Task 10: Final gate, handoff, and the push decision — tier: Opus · **USER-GATED push**

**Files:**
- Create: `docs/SESSION_HANDOFF_2026-09-11.md`
- Modify: `CLAUDE.md:3` (the "currently `docs/SESSION_HANDOFF_2026-09-01.md`" pointer)

- [ ] **Step 1: Run the full gate cold**

```bash
npm run typecheck
npm run lint
rm -rf .next && npm run build
npm test
```

Expected: 0 / 0 errors (24 warnings) / clean build / `143 files, 995 tests` green (985 baseline + 4 from Task 2 + 2 from Task 3 + 3 from Task 8's `sumUsage` + 1 from Task 8's route test). Record the exact numbers for the handoff.

- [ ] **Step 2: Write the handoff**

Create `docs/SESSION_HANDOFF_2026-09-11.md` following the shape of `docs/SESSION_HANDOFF_2026-09-01.md` (TL;DR · what shipped · findings that will bite · next session · carried items · quick links). It must state: the audit commit and report path; Tasks 1–9 as shipped commits with hashes (`git log --oneline 6d1449a..HEAD`); migrations `0018`–`0021` **applied** (with the verify output); the gate numbers; that **the commits are local and unpushed** pending approval; and that Phase 3 is the next plan (list its eight items from the audit's §4 "With the release" row). Update `CLAUDE.md` line 3 to point at the new handoff.

- [ ] **Step 3: Commit**

```bash
git add docs/SESSION_HANDOFF_2026-09-11.md CLAUDE.md
git commit -m "docs: session handoff for 2026-09-11"
```

- [ ] **Step 4: STOP — ask for push approval**

Show `git log --oneline origin/master..master` (expect 6 pre-existing + ~10 new commits) and ask the user whether to `git push origin master`. Pushing auto-deploys to Vercel. Do not push without an explicit yes. After the push: confirm CI green, then run the live smoke from the 09-01 handoff's checklist step 3 (send a chat message → `usage_events` row with a plausible `cost_usd` → Settings → Usage renders spend → chat context menu shows the cost line).

---

## Not in this plan (Phase 3 — separate plan)

From the audit's §4 "With the release" row, each a contained, independently testable change: F1 wrong-chat write on mid-stream switch (the one Critical), F2 archived chats unreachable, F3 duplicate re-save/re-embed on open, X1 hybrid page anchors + `pageRangeFor` seed, X5 PDF curly quotes, X4 storage sweeps on project/chat delete, F6 error banner on Home, C3 alias canonicalization. Write it after Task 10, with the same tier tags.
