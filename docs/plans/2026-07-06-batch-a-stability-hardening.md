# Batch A — Stability & Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan — dispatch each task to a fresh subagent at the model tier named in the task header, verify its work against that task's steps (run the exact commands, confirm the expected output) before moving on, and never batch multiple tasks into one subagent. Each task ends green and committed.

**Goal:** Ship v4.41.0 — enable RLS + FK indexes on the two un-hardened tables, make summarization incremental and infrequent, and guarantee stuck document rows always reach a terminal status — with no UI changes and full unit coverage.

**Architecture:** Batch A touches three seams. (1) A Drizzle migration `0013` for the DB hardening (RLS on `artifact_versions`/`generated_images`, three FK indexes). (2) The summarization pipeline: a lower-bounded server window (`getMessagesForSummarization`), a route that folds only new messages and returns a 200 no-op when caught up, a client-side monotonic trigger gate, and toast removal. (3) Document-processing robustness: `maxDuration` exports, an `updated_at` bump on every status write, and a lazy stale-processing reaper called from the documents GET. Every change degrades gracefully and is backed by PGlite/jsdom unit tests that run the real migrations from `drizzle/`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (`postgres-js` / `pg-core`), Supabase Postgres + pgvector, Vitest 4 + PGlite (`@electric-sql/pglite`) + Testing Library (jsdom), AI SDK v6.

## Global Constraints

Bake these into every task verbatim:

- **Target release: v4.41.0.**
- **NO UI changes.** No component, token, layout, or copy is touched. Warm palette + Fraunces stay exactly as-is.
- **NO Prettier / single-quote-no-semicolon.** Match the file being edited: `src/db/schema.ts` uses **semicolons**; `actions.ts`, hooks, route handlers, and all test files use **single quotes, no semicolons**. Never reformat surrounding code.
- **Migration applied to live Supabase is user-gated.** CI applies `0013` automatically to its ephemeral pgvector Postgres; the production `DIRECT_URL=… npx drizzle-kit migrate` runs only on explicit user go.
- **Pages stay serial.** Bounded vision-page concurrency is deferred to Batch B (co-designed with RAM buffering). Do not add concurrency here.
- **`maxDuration = 800`** exported in `documents/process` + `documents/web-ingest` (fallback `300` if the plan rejects 800 at deploy).
- **Reaper threshold 20 min > `maxDuration` (~13.3 min)** so a still-running job is never reaped.
- **`SUMMARIZE_EVERY = 10`** (delta gate) exported from `useSummarization.ts`.
- **`STALE_PROCESSING_MINUTES = 20`** exported from `actions.ts`.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Conventional Commits 1.0, imperative lowercase, no trailing period.

Path alias `@/*` → `./src/*`. Single-file test = `npx vitest run <path>`; full suite = `npm test`. Verification gate = `npm run typecheck` → `npm run lint` → `npm run build` → `npm test`.

---

### Task 1: Migration 0013 — RLS + FK indexes  — [Model tier: FABLE]

**Files**
- Modify `src/db/schema.ts` — add `.enableRLS()` to `artifactVersions` (line ~153) and `generatedImages` (line ~208); add one index each to `artifacts` (callback line ~135), `documentRevisions` (callback line ~102), `memorySuggestions` (callback line ~222).
- Create `drizzle/0013_*.sql` (+ `drizzle/meta/0013_snapshot.json`, updated `drizzle/meta/_journal.json`) via `npx drizzle-kit generate`.
- Create `tests/unit/db/migration-0013.test.ts`.

**Interfaces**
- Consumes: `createTestDb`, `testDb` from `tests/helpers/test-db.ts` (runs real migrations from `drizzle/`, incl. the new 0013).
- Produces (SQL surface): indexes `idx_artifacts_project_id`, `idx_document_revisions_project_id`, `idx_memory_suggestions_chat_id`; `relrowsecurity = true` on `artifact_versions` + `generated_images`.

**Note on PGlite caching:** the WASM Postgres + migrations are built once per worker, but each `npx vitest run` spawns a fresh worker → `migrate` re-applies `drizzle/` as it exists *at that moment*. So the first run (before `generate`) has no 0013 and fails; the run after `generate` includes 0013 and passes. No stale cache across runs.

Steps:

- [ ] **Write the failing test.** Create `tests/unit/db/migration-0013.test.ts` (single-quote, no-semicolon; mirrors `tests/unit/db/harness.test.ts`):
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest'
  import { sql } from 'drizzle-orm'
  import { createTestDb, testDb } from '../../helpers/test-db'

  // drizzle-orm/pglite's execute() returns { rows }, but postgres-js returns a bare
  // array. Normalize so this test asserts the same way regardless of driver shape.
  function rowsOf<T>(res: unknown): T[] {
    return ((res as { rows?: T[] }).rows ?? (res as T[]))
  }

  // Migration 0013 hardening: RLS on the two tables added after the June RLS pass,
  // plus three FK indexes flagged by Supabase's unindexed_foreign_keys advisor.
  describe('migration 0013 — RLS + FK indexes', () => {
    beforeEach(async () => { await createTestDb() })

    it('creates the three FK indexes', async () => {
      const res = await testDb.execute(sql`
        SELECT indexname FROM pg_indexes
        WHERE indexname IN (
          'idx_artifacts_project_id',
          'idx_document_revisions_project_id',
          'idx_memory_suggestions_chat_id'
        )
      `)
      const names = rowsOf<{ indexname: string }>(res).map(r => r.indexname).sort()
      expect(names).toEqual([
        'idx_artifacts_project_id',
        'idx_document_revisions_project_id',
        'idx_memory_suggestions_chat_id',
      ])
    })

    it('enables row-level security on artifact_versions and generated_images', async () => {
      const res = await testDb.execute(sql`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('artifact_versions', 'generated_images')
        ORDER BY relname
      `)
      const rows = rowsOf<{ relname: string; relrowsecurity: boolean }>(res)
      expect(rows).toEqual([
        { relname: 'artifact_versions', relrowsecurity: true },
        { relname: 'generated_images', relrowsecurity: true },
      ])
    })
  })
  ```

- [ ] **Run it — expect FAIL** (objects don't exist yet; migrate applied only 0000–0012):
  ```bash
  npx vitest run tests/unit/db/migration-0013.test.ts
  ```
  Expected: `FAIL … creates the three FK indexes` → `AssertionError: expected [] to deeply equal [ 'idx_artifacts_project_id', … ]`, and `… enables row-level security …` → expected `[]`/`false` rows to equal the `true` rows. `Tests  2 failed (2)`.

- [ ] **Edit `src/db/schema.ts` — add the three indexes (keep semicolons).** In `artifacts` (second-arg callback):
  ```ts
  }, (table) => [
    index('idx_artifacts_chat_id').on(table.chatId),
    index('idx_artifacts_project_id').on(table.projectId),
  ]);
  ```
  In `documentRevisions`:
  ```ts
  }, (table) => [
    index('idx_doc_revisions_document_id').on(table.documentId),
    index('idx_document_revisions_project_id').on(table.projectId),
  ]);
  ```
  In `memorySuggestions`:
  ```ts
  }, (table) => [
    // Covers the hot query: filter (project_id, status) + ORDER BY created_at DESC.
    index('idx_memory_suggestions_project_status').on(table.projectId, table.status, table.createdAt.desc()),
    index('idx_memory_suggestions_chat_id').on(table.chatId),
  ]);
  ```

- [ ] **Edit `src/db/schema.ts` — enable RLS on the two tables.** Chain `.enableRLS()` after the `pgTable(...)` call (before the `;`). `artifactVersions`:
  ```ts
  }, (table) => [
    index('idx_artifact_versions_artifact_id').on(table.artifactId),
  ]).enableRLS();
  ```
  `generatedImages`:
  ```ts
  }, (table) => [
    index('idx_generated_images_project_created').on(table.projectId, table.createdAt.desc()),
  ]).enableRLS();
  ```

- [ ] **Generate the migration:**
  ```bash
  npx drizzle-kit generate
  ```
  Expected: `[✓] Your SQL migration file ➜ drizzle/0013_<name>.sql 🚀` (note the actual `<name>`), plus an updated `drizzle/meta/_journal.json` (new entry `"tag": "0013_<name>"`) and a new `drizzle/meta/0013_snapshot.json`.

- [ ] **Eyeball the generated SQL — it must contain ONLY these 5 statements** (order may vary; `Read drizzle/0013_<name>.sql`):
  ```sql
  ALTER TABLE "artifact_versions" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "generated_images" ENABLE ROW LEVEL SECURITY;
  CREATE INDEX "idx_artifacts_project_id" ON "artifacts" USING btree ("project_id");
  CREATE INDEX "idx_document_revisions_project_id" ON "document_revisions" USING btree ("project_id");
  CREATE INDEX "idx_memory_suggestions_chat_id" ON "memory_suggestions" USING btree ("chat_id");
  ```
  **Fallback (hand-write):** if `generate` emits anything beyond these (snapshot drift), delete the generated `0013_*.sql`, hand-write it with exactly the 5 statements above (each followed by `--> statement-breakpoint` except the last), and hand-add the `_journal.json` entry + copy the prior snapshot to `0013_snapshot.json` with `isRLSEnabled: true` set on the two tables and the three indexes added. Re-run the test to confirm.

- [ ] **Re-run the test — expect PASS:**
  ```bash
  npx vitest run tests/unit/db/migration-0013.test.ts
  ```
  Expected: `✓ tests/unit/db/migration-0013.test.ts (2 tests)` → `Tests  2 passed (2)`.

- [ ] **Commit:**
  ```bash
  git add src/db/schema.ts drizzle/ tests/unit/db/migration-0013.test.ts
  git commit -m "feat(db): add migration 0013 — RLS on artifact_versions/generated_images + 3 FK indexes" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Incremental summarization window (server)  — [Model tier: FABLE]

**Files**
- Modify `src/app/actions.ts` — `getMessagesForSummarization` (line 264); add `gt` to the drizzle import (line 5).
- Modify `src/app/api/summarize/route.ts` — read `chat.summaryUpToMessageId ?? 0` as the lower bound (line 35); empty window → 200 no-op (lines 37–42).
- Modify `tests/unit/actions/context.test.ts` — add a lower-bound test.
- Modify `tests/unit/api/summarize-route.test.ts` — update the empty-window test to 200; add an incremental-window test; add `updateChatSummary` to the imports.

**Interfaces**
- Produces: `getMessagesForSummarization(chatId: number, upToMessageId: number, fromMessageId = 0)` → messages in `(fromMessageId, upToMessageId]`, `ORDER BY created_at ASC`.
- Consumes: `chat.summaryUpToMessageId` (nullable int on `chats`), `updateChatSummary(chatId, summary, cutoffMessageId)` (already advances the cutoff).

Steps:

- [ ] **Write the failing actions test.** In `tests/unit/actions/context.test.ts`, add inside the `describe`:
  ```ts
  it('getMessagesForSummarization respects the fromMessageId lower bound', async () => {
    const [m1] = await saveMessage(chatId, 'user', 'First')
    await saveMessage(chatId, 'assistant', 'Second')
    const [m3] = await saveMessage(chatId, 'user', 'Third')

    // Window (m1, m3] excludes m1.
    const msgs = await getMessagesForSummarization(chatId, m3.id, m1.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('Second')
    expect(msgs[1].content).toBe('Third')
  })
  ```

- [ ] **Run it — expect FAIL** (third arg ignored; still returns 3 including `First`):
  ```bash
  npx vitest run tests/unit/actions/context.test.ts
  ```
  Expected: `AssertionError: expected length 3 to be 2` (or `msgs[0].content` is `'First'`).

- [ ] **Edit `src/app/actions.ts` — add `gt` to the import** (line 5, currently `eq, desc, isNull, isNotNull, and, lte, asc, count, inArray, sql`):
  ```ts
  import { eq, desc, isNull, isNotNull, and, lte, gt, asc, count, inArray, sql } from 'drizzle-orm'
  ```

- [ ] **Edit `getMessagesForSummarization`** (line 264) — add the `fromMessageId` param + lower bound:
  ```ts
  export async function getMessagesForSummarization(chatId: number, upToMessageId: number, fromMessageId = 0) {
    // Fold only messages in (fromMessageId, upToMessageId]. `fromMessageId` defaults to
    // 0 (backwards-compatible: 0 < every identity PK) so existing callers are unchanged;
    // the summarize route passes chat.summaryUpToMessageId so each fold is incremental.
    return await db.select()
      .from(messages)
      .where(and(
        eq(messages.chatId, chatId),
        gt(messages.id, fromMessageId),
        lte(messages.id, upToMessageId),
      ))
      .orderBy(asc(messages.createdAt))
  }
  ```

- [ ] **Re-run the actions test — expect PASS** (both the new lower-bound test and the existing "returns messages up to cutoff" test, which uses the default `fromMessageId=0`):
  ```bash
  npx vitest run tests/unit/actions/context.test.ts
  ```
  Expected: `Tests  N passed (N)` (all green, including the backwards-compat default).

- [ ] **Write the failing route tests.** In `tests/unit/api/summarize-route.test.ts`, add `updateChatSummary` to the actions import (currently `createProject, createChat, saveMessage, getChatWithContext`):
  ```ts
  import {
    createProject,
    createChat,
    saveMessage,
    getChatWithContext,
    updateChatSummary,
  } from '@/app/actions'
  ```
  Replace the existing `it('returns 400 when no messages to summarize', …)` block (currently asserting 400 / `'No messages'`) with a 200 no-op assertion:
  ```ts
  it('returns a 200 no-op when the window is empty (already up to date)', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: chat.id, cutoffMessageId: 999 }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.summarizedMessageCount).toBe(0)
  })
  ```
  Add an incremental-window test after it:
  ```ts
  it('folds only messages after summaryUpToMessageId', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    await saveMessage(chat.id, 'user', 'One')
    const [m2] = await saveMessage(chat.id, 'assistant', 'Two')
    await saveMessage(chat.id, 'user', 'Three')
    const [m4] = await saveMessage(chat.id, 'assistant', 'Four')
    // Pretend we already summarized through m2.
    await updateChatSummary(chat.id, 'Earlier summary', m2.id)

    const POST = await importRoute()
    const res = await POST(makeRequest({ chatId: chat.id, cutoffMessageId: m4.id }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // Only m3 and m4 are in (m2, m4]; m1/m2 excluded by the lower bound.
    expect(data.summarizedMessageCount).toBe(2)

    const updated = await getChatWithContext(chat.id)
    expect(updated!.summaryUpToMessageId).toBe(m4.id)
  })
  ```

- [ ] **Run the route tests — expect FAIL** (route still passes 2-arg call + returns 400 on empty):
  ```bash
  npx vitest run tests/unit/api/summarize-route.test.ts
  ```
  Expected: empty-window test → `expected 400 to be 200`; incremental test → `expected 4 to be 2` (all four messages folded because the lower bound isn't applied).

- [ ] **Edit `src/app/api/summarize/route.ts`** — pass the lower bound + return 200 on empty. Replace lines 34–42 (the `getMessagesForSummarization` call through the empty-length `400` block). **This file uses semicolons — match it:**
  ```ts
    // Fold only messages newer than what the existing summary already covers.
    const fromMessageId = chat.summaryUpToMessageId ?? 0;
    const messagesToSummarize = await getMessagesForSummarization(chatId, cutoffMessageId, fromMessageId);

    if (messagesToSummarize.length === 0) {
      // Already up to date — not an error. Silent no-op.
      return new Response(JSON.stringify({ success: true, summarizedMessageCount: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  ```

- [ ] **Re-run the route tests — expect PASS:**
  ```bash
  npx vitest run tests/unit/api/summarize-route.test.ts
  ```
  Expected: `Tests  N passed (N)` (empty window → 200 no-op; incremental window folds 2; `summaryUpToMessageId` advanced to `m4.id`; the existing 400-invalid-body and 404-not-found tests still pass).

- [ ] **Commit:**
  ```bash
  git add src/app/actions.ts src/app/api/summarize/route.ts tests/unit/actions/context.test.ts tests/unit/api/summarize-route.test.ts
  git commit -m "feat(summarize): fold only new messages and 200 no-op when caught up" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Trigger gate + toast removal (hooks)  — [Model tier: OPUS]

**Files**
- Modify `src/hooks/useSummarization.ts` — export `SUMMARIZE_EVERY = 10`; remove the `toast.success` (and the now-unused `toast` import + `response` handling).
- Modify `src/hooks/useChatPersistence.ts` — add `lastSummarizedCountRef` to the opts interface + destructure + monotonic gate + deps; import `SUMMARIZE_EVERY`.
- Modify `src/app/page.tsx` — create `lastSummarizedCountRef` and pass it into `useChatPersistence` (interface change → required for typecheck).
- Modify `tests/hooks/useChatPersistence.test.ts` — extend `makeOpts` with `lastSummarizedCountRef`; add the delta-gate test.

**Interfaces**
- Produces: `SUMMARIZE_EVERY` (number) from `useSummarization.ts`. `UseChatPersistenceOpts` gains `lastSummarizedCountRef: RefObject<Map<number, number>>`.
- Consumes: existing `SUMMARIZATION_THRESHOLD`; the existing `lastSuggestedAtRef` monotonic pattern (mirror it exactly).

Steps:

- [ ] **Write the failing hook test.** In `tests/hooks/useChatPersistence.test.ts`, extend `makeOpts`. Add `lastSummarizedCount?: Map<number, number>` to its `overrides` type, destructure it with a default, build the ref, and add it to the returned object:
  ```ts
  function makeOpts(overrides: {
    chatId?: number | null
    projectId?: number | null
    lastSavedAssistantId?: string | null
    lastSuggestedAt?: Map<number, number>
    lastSummarizedCount?: Map<number, number>
  } = {}) {
    const {
      chatId = 1,
      projectId = null,
      lastSavedAssistantId = null,
      lastSuggestedAt = new Map(),
      lastSummarizedCount = new Map(),
    } = overrides

    const activeChatIdRef = { current: chatId }
    const activeProjectIdRef = { current: projectId }
    const lastSavedAssistantIdRef = { current: lastSavedAssistantId }
    const lastSuggestedAtRef = { current: lastSuggestedAt }
    const lastSummarizedCountRef = { current: lastSummarizedCount }
    // Cast mocks to the required dispatch types — the actual type doesn't matter in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setMessages = vi.fn() as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setArtifacts = vi.fn() as any
    const triggerSummarization = vi.fn().mockResolvedValue(undefined)
    const maybeGenerateTitle = vi.fn()

    return {
      activeChatIdRef,
      activeProjectIdRef,
      lastSavedAssistantIdRef,
      lastSuggestedAtRef,
      lastSummarizedCountRef,
      setMessages,
      setArtifacts,
      triggerSummarization,
      maybeGenerateTitle,
    }
  }
  ```
  Add the delta-gate test inside the `describe`:
  ```ts
  it('(c) fires summarization at most once per SUMMARIZE_EVERY new messages past the threshold', async () => {
    const opts = makeOpts({ chatId: 12 })
    const { result } = renderHook(() => useChatPersistence(opts))

    // First finish past the threshold → fires, records the count.
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 1) // 31, delta 31
    await act(async () => { await result.current({ message: makeMessage({ id: 'a' }) }) })
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(1)

    // A few messages later (delta < SUMMARIZE_EVERY) → does NOT fire again.
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 10) // 40, delta 9
    await act(async () => { await result.current({ message: makeMessage({ id: 'b' }) }) })
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(1)

    // Once the delta reaches SUMMARIZE_EVERY → fires again.
    mockGetMessageCount.mockResolvedValue(SUMMARIZATION_THRESHOLD + 21) // 51, delta 20
    await act(async () => { await result.current({ message: makeMessage({ id: 'c' }) }) })
    expect(opts.triggerSummarization).toHaveBeenCalledTimes(2)
  })
  ```
  Add `SUMMARIZE_EVERY` to the `useSummarization` import at the top of the test:
  ```ts
  import { SUMMARIZATION_THRESHOLD, SUMMARIZE_EVERY } from '@/hooks/useSummarization'
  ```

- [ ] **Run it — expect FAIL** (`SUMMARIZE_EVERY` is not exported yet → import is `undefined`; and the un-gated hook fires on every finish, so the second `toHaveBeenCalledTimes(1)` fails at 2):
  ```bash
  npx vitest run tests/hooks/useChatPersistence.test.ts
  ```
  Expected: either a TypeScript/undefined error on `SUMMARIZE_EVERY`, or `AssertionError: expected "triggerSummarization" to have been called 1 times, but got 2`.

- [ ] **Edit `src/hooks/useSummarization.ts` — export `SUMMARIZE_EVERY`** after `MESSAGES_TO_KEEP` (line 8):
  ```ts
  export const SUMMARIZATION_THRESHOLD = 30
  export const MESSAGES_TO_KEEP = 10
  // Delta gate: past the threshold, fold at most once per this many NEW messages
  // (the server window is now incremental, so each fold is cheap). Imported by
  // useChatPersistence's onFinish trigger.
  export const SUMMARIZE_EVERY = 10
  ```

- [ ] **Edit `src/hooks/useSummarization.ts` — remove the toast** (silent housekeeping, like embed/title/memory). Remove the `import { toast } from 'sonner'` line (line 2) and replace the whole `try`/`catch` block (lines 28–40) so the `response` var is dropped (no unused-var lint) and `console.error` is kept:
  ```ts
        try {
          await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, cutoffMessageId, model: selectedModelRef.current }),
          })
        } catch (error) {
          console.error('[Summarization] Error:', error)
        }
  ```

- [ ] **Edit `src/hooks/useChatPersistence.ts` — import `SUMMARIZE_EVERY`** (line 13):
  ```ts
  import { SUMMARIZATION_THRESHOLD, SUMMARIZE_EVERY } from '@/hooks/useSummarization'
  ```

- [ ] **Edit `UseChatPersistenceOpts`** — add the ref after `lastSuggestedAtRef` (line 25):
  ```ts
    lastSuggestedAtRef: RefObject<Map<number, number>>
    lastSummarizedCountRef: RefObject<Map<number, number>>
  ```
  Add it to the destructure block (after `lastSuggestedAtRef`, ~line 46):
  ```ts
      lastSuggestedAtRef,
      lastSummarizedCountRef,
  ```

- [ ] **Edit the trigger gate** (lines 135–139) — monotonic delta gate mirroring the auto-memory gate below it:
  ```ts
        // Check if summarization is needed. Monotonic delta-gate (mirrors the
        // auto-memory gate below): past the threshold, fold at most once per
        // SUMMARIZE_EVERY new messages instead of on every turn.
        const messageCount = await getMessageCount(currentChatId)
        const lastSummarized = lastSummarizedCountRef.current.get(currentChatId) ?? 0
        if (messageCount > SUMMARIZATION_THRESHOLD && messageCount - lastSummarized >= SUMMARIZE_EVERY) {
          lastSummarizedCountRef.current.set(currentChatId, messageCount)
          triggerSummarization(currentChatId, messageCount).catch(() => {})
        }
  ```
  Add `lastSummarizedCountRef` to the `useCallback` deps array (line 174):
  ```ts
      [activeChatIdRef, activeProjectIdRef, lastSavedAssistantIdRef, lastSuggestedAtRef, lastSummarizedCountRef, setMessages, setArtifacts, triggerSummarization, maybeGenerateTitle]
  ```

- [ ] **Edit `src/app/page.tsx` — create and pass the ref.** After `lastSuggestedAtRef` (line 162):
  ```ts
    const lastSuggestedAtRef = useRef<Map<number, number>>(new Map())
    // Summarization: per-chat message count at the last fold. Monotonic delta-gate
    // (count - last >= SUMMARIZE_EVERY) so a long chat folds infrequently, not per turn.
    const lastSummarizedCountRef = useRef<Map<number, number>>(new Map())
  ```
  Pass it into the `useChatPersistence({ … })` opts (after `lastSuggestedAtRef`, line 188):
  ```ts
      lastSuggestedAtRef,
      lastSummarizedCountRef,
  ```

- [ ] **Re-run the hook test — expect PASS:**
  ```bash
  npx vitest run tests/hooks/useChatPersistence.test.ts
  ```
  Expected: `Tests  N passed (N)` (the delta-gate test fires 1→1→2; the existing threshold tests still pass — 31 with delta 31 ≥ 20 fires; 30 is below threshold).

- [ ] **Typecheck** (the interface change ripples to `page.tsx`):
  ```bash
  npm run typecheck
  ```
  Expected: no output, exit 0.

- [ ] **Commit:**
  ```bash
  git add src/hooks/useSummarization.ts src/hooks/useChatPersistence.ts src/app/page.tsx tests/hooks/useChatPersistence.test.ts
  git commit -m "feat(summarize): delta-gate the client trigger and drop the success toast" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: maxDuration + updated_at bump  — [Model tier: SONNET]

**Files**
- Modify `src/app/api/documents/process/route.ts` — add `export const maxDuration = 800` (top of file, after imports).
- Modify `src/app/api/documents/web-ingest/route.ts` — add `export const maxDuration = 800` (top of file, after imports).
- Modify `src/app/actions.ts` — `updateDocumentStatus` (line 468): add `updatedAt: new Date()` to `.set(...)`.
- Modify `tests/unit/actions/documents-storage.test.ts` — add an `updated_at` bump test.

**Interfaces**
- Produces: `maxDuration` route segment config (Next.js reads this to set the function time budget). `updateDocumentStatus` now advances `documents.updated_at` on every status write.

Steps:

- [ ] **Write the failing test.** In `tests/unit/actions/documents-storage.test.ts`, add inside the `describe`:
  ```ts
  it('updateDocumentStatus bumps updated_at', async () => {
    const { createUploadingDocument, updateDocumentStatus, getDocumentById } = await import('@/app/actions')
    const [project] = await createProject('Bump Project')
    const [doc] = await createUploadingDocument({ projectId: project.id, filename: 'b.pdf', mimeType: 'application/pdf', fileSize: 10 })

    const before = Date.now()
    await updateDocumentStatus(doc.id, 'processing')
    const after = await getDocumentById(doc.id)

    expect(after?.updatedAt).toBeInstanceOf(Date)
    expect(after!.updatedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })
  ```

- [ ] **Run it — expect FAIL** (`updatedAt` is null after create and never set by `updateDocumentStatus`):
  ```bash
  npx vitest run tests/unit/actions/documents-storage.test.ts
  ```
  Expected: `AssertionError: expected null to be an instance of Date`.

- [ ] **Edit `updateDocumentStatus`** (line 473–476) — add the bump:
  ```ts
    return await db.update(documents)
      .set({ status, ...updates, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning()
  ```

- [ ] **Re-run the test — expect PASS:**
  ```bash
  npx vitest run tests/unit/actions/documents-storage.test.ts
  ```
  Expected: `Tests  N passed (N)` (the new bump test + the existing storage tests).

- [ ] **Edit `src/app/api/documents/process/route.ts`** — add after the imports (after line 11, before `const MIN_TEXT`):
  ```ts
  // A 30-page vision run is serial (bounded concurrency deferred to Batch B), so give
  // the function a generous budget. Pairs with the stale-processing reaper: even if the
  // platform still kills the function, a stuck row is flipped to error on the next list.
  export const maxDuration = 800
  ```

- [ ] **Edit `src/app/api/documents/web-ingest/route.ts`** — add after the imports (after line 9, before `export async function POST`):
  ```ts
  // Tavily extract + chunk + embed can run long on a large page; give it headroom.
  export const maxDuration = 800
  ```

- [ ] **Typecheck** (route segment config must be a valid `number` literal export):
  ```bash
  npm run typecheck
  ```
  Expected: no output, exit 0.

- [ ] **Commit:**
  ```bash
  git add src/app/api/documents/process/route.ts src/app/api/documents/web-ingest/route.ts src/app/actions.ts tests/unit/actions/documents-storage.test.ts
  git commit -m "feat(documents): export maxDuration and bump updated_at on status writes" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Stale-processing reaper  — [Model tier: OPUS]

**Files**
- Modify `src/app/actions.ts` — add `export const STALE_PROCESSING_MINUTES = 20` + `export async function reapStaleProcessing(projectId?: number)` (place after `getProjectDocuments`, ~line 483). Reuses the already-imported `and`, `eq`, `sql`.
- Modify `src/app/api/documents/route.ts` — import `reapStaleProcessing`; call it at the top of the `GET` handler before listing.
- Create `tests/unit/actions/reap-stale-processing.test.ts`.

**Interfaces**
- Produces: `reapStaleProcessing(projectId?: number)` → updates `documents` rows where `status='processing'` and `COALESCE(updated_at, created_at) < now() - (20 * interval '1 minute')` (optionally scoped to `projectId`), setting `status='error'`, `error_message='Processing timed out'`, `updated_at=now()`; returns the reaped rows.
- Consumes: `documents` table; `and`/`eq`/`sql` from drizzle-orm.

Steps:

- [ ] **Write the failing test.** Create `tests/unit/actions/reap-stale-processing.test.ts` (mirrors the PGlite actions pattern; direct `testDb.insert` with backdated timestamps):
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest'
  import { createTestDb, testDb } from '../../helpers/test-db'
  import { projects, documents } from '@/db/schema'

  vi.mock('@/db', () => ({
    get db() {
      return testDb
    },
  }))

  import { reapStaleProcessing, getDocumentById } from '@/app/actions'

  const OLD = new Date(Date.now() - 30 * 60 * 1000)  // 30 min ago (stale)
  const FRESH = new Date(Date.now() - 2 * 60 * 1000)  // 2 min ago (still running)

  async function insertDoc(projectId: number, over: Partial<typeof documents.$inferInsert>) {
    const [d] = await testDb.insert(documents).values({
      projectId, filename: 'f.pdf', mimeType: 'application/pdf', fileSize: 1, charCount: 0,
      ...over,
    }).returning()
    return d
  }

  describe('reapStaleProcessing', () => {
    beforeEach(async () => { await createTestDb() })

    it('flips a stale processing row to error and leaves fresh/ready rows untouched', async () => {
      const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
      const stale = await insertDoc(p.id, { status: 'processing', updatedAt: OLD })
      const fresh = await insertDoc(p.id, { status: 'processing', updatedAt: FRESH })
      const ready = await insertDoc(p.id, { status: 'ready', updatedAt: OLD })

      await reapStaleProcessing()

      const staleAfter = await getDocumentById(stale.id)
      expect(staleAfter?.status).toBe('error')
      expect(staleAfter?.errorMessage).toBe('Processing timed out')
      expect((await getDocumentById(fresh.id))?.status).toBe('processing')
      expect((await getDocumentById(ready.id))?.status).toBe('ready')
    })

    it('reaps a legacy row with null updated_at via the created_at fallback', async () => {
      const [p] = await testDb.insert(projects).values({ name: 'P' }).returning()
      const legacy = await insertDoc(p.id, { status: 'processing', updatedAt: null, createdAt: OLD })

      await reapStaleProcessing()

      expect((await getDocumentById(legacy.id))?.status).toBe('error')
    })

    it('respects the projectId filter', async () => {
      const [a] = await testDb.insert(projects).values({ name: 'A' }).returning()
      const [b] = await testDb.insert(projects).values({ name: 'B' }).returning()
      const inA = await insertDoc(a.id, { status: 'processing', updatedAt: OLD })
      const inB = await insertDoc(b.id, { status: 'processing', updatedAt: OLD })

      await reapStaleProcessing(a.id)

      expect((await getDocumentById(inA.id))?.status).toBe('error')
      expect((await getDocumentById(inB.id))?.status).toBe('processing')
    })
  })
  ```

- [ ] **Run it — expect FAIL** (`reapStaleProcessing` is not exported yet):
  ```bash
  npx vitest run tests/unit/actions/reap-stale-processing.test.ts
  ```
  Expected: `SyntaxError: The requested module '@/app/actions' does not provide an export named 'reapStaleProcessing'` (or a TypeError on calling `undefined`).

- [ ] **Edit `src/app/actions.ts`** — add the constant + function after `getProjectDocuments` (line 483). `and`, `eq`, `sql` are already imported:
  ```ts
  // A 'processing' row older than this (by its last status write, falling back to
  // created_at for legacy rows) is treated as stuck — a platform timeout killed the
  // function mid-run, bypassing every catch. 20 min > maxDuration (~13.3 min) so a
  // still-running job is never reaped.
  export const STALE_PROCESSING_MINUTES = 20

  // Opportunistic lazy sweep (no cron infra): flip genuinely-stuck 'processing' rows to
  // a terminal 'error' so a killed function never leaves a row stuck forever. Called from
  // GET /api/documents before listing; one indexed UPDATE, negligible cost.
  export async function reapStaleProcessing(projectId?: number) {
    return await db.update(documents)
      .set({ status: 'error', errorMessage: 'Processing timed out', updatedAt: new Date() })
      .where(and(
        eq(documents.status, 'processing'),
        sql`coalesce(${documents.updatedAt}, ${documents.createdAt}) < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})`,
        projectId ? eq(documents.projectId, projectId) : undefined,
      ))
      .returning()
  }
  ```
  (`make_interval(mins => $1)` types the bound param as `int` via the function signature — robust across postgres-js/PGlite, unlike a bare `$1 * interval '1 minute'` whose param type PG must guess.)

- [ ] **Re-run the test — expect PASS:**
  ```bash
  npx vitest run tests/unit/actions/reap-stale-processing.test.ts
  ```
  Expected: `Tests  3 passed (3)` (stale→error, fresh/ready untouched, legacy null→error via COALESCE, projectId scoping honored).

- [ ] **Edit `src/app/api/documents/route.ts` — import the reaper** (line 2):
  ```ts
  import { getProjectDocuments, getDocumentById, deleteDocument, getDocumentRevisions, reapStaleProcessing } from '@/app/actions'
  ```

- [ ] **Wire it into `GET`** — after the `projectId` validation (line 12), before `getProjectDocuments`:
  ```ts
      if (!projectId || isNaN(projectId)) {
        return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
      }
      // Lazy reaper: surface genuinely-stuck 'processing' rows as 'error' the next time
      // this project's documents are listed (a platform timeout can bypass every catch).
      await reapStaleProcessing(projectId)
      const docs = await getProjectDocuments(projectId)
  ```

- [ ] **Typecheck:**
  ```bash
  npm run typecheck
  ```
  Expected: no output, exit 0.

- [ ] **Commit:**
  ```bash
  git add src/app/actions.ts src/app/api/documents/route.ts tests/unit/actions/reap-stale-processing.test.ts
  git commit -m "feat(documents): reap stale processing rows on list" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Verification gate + release prep  — [Model tier: FABLE]

**Files**
- Modify `CHANGELOG.md` — add the `[4.41.0]` entry at the top (below the header, above `[4.40.1]`).
- No product code. This task runs the gate and documents the release; it does **not** execute the release (all release actions are user-gated).

**Interfaces**
- Consumes: the whole tree from Tasks 1–5.
- Produces: a green gate + a `[4.41.0]` changelog entry + a written, user-gated release checklist.

Steps:

- [ ] **Run the full verification gate, in order:**
  ```bash
  npm run typecheck
  npm run lint
  npm run build
  npm test
  ```
  Expected: `typecheck` → exit 0, no output. `lint` → 0 errors (warnings ≤ the existing baseline). `build` → `✓ Compiled successfully` / route table printed. `npm test` → all suites green, e.g. `Test Files  N passed (N)` / `Tests  M passed (M)` including the new `migration-0013`, `reap-stale-processing`, the extended `context`, `summarize-route`, `documents-storage`, and `useChatPersistence` tests. If anything fails, fix in place (do not `.skip`) and re-run the gate clean before continuing.

- [ ] **Add the CHANGELOG entry.** Insert directly below line 3 (the `All notable changes…` line), above `## [4.40.1]`:
  ```markdown
  ## [4.41.0] - 2026-07-06 — Stability & security hardening (Batch A)

  A cohesive hardening release from the 2026-07-06 audit: RLS + FK indexes on the two tables added after the June RLS pass, incremental/infrequent summarization, and a guarantee that stuck document rows reach a terminal status. No UI changes.

  ### Fixed

  - **Runaway re-summarization.** Past the 30-message threshold, `onFinish` used to fire summarization on *every* assistant turn and re-fold the whole history from message 1, plus a "Conversation summarized" toast each time. Now the client fires at most once per **20** new messages (monotonic delta gate), the server folds only messages after `summary_up_to_message_id` (an empty window is a **200 no-op**, not a 400), and the toast is gone (silent housekeeping like embed/title/memory).
  - **Documents stuck in `processing` forever.** A platform timeout mid-vision-run could bypass every `catch`, leaving the row non-terminal. Routes now export `maxDuration = 800`, `updateDocumentStatus` bumps `updated_at` on every write, and a lazy reaper flips genuinely-stuck `processing` rows (older than **20 min**) to `error` on the next documents-list fetch.

  ### Security

  - **RLS enabled on `artifact_versions` and `generated_images`** (deny-all to PostgREST/anon, matching the 13 other public tables; the app's owner role bypasses RLS — no policy added), clearing the two ERROR-level `rls_disabled_in_public` advisors.
  - **Three unindexed foreign keys indexed** — `idx_artifacts_project_id`, `idx_document_revisions_project_id`, `idx_memory_suggestions_chat_id` — clearing the `unindexed_foreign_keys` advisors.

  ### Notes

  - **DB migration `0013`** (2 RLS enables + 3 FK indexes). Applied to live Supabase **user-gated** (`DIRECT_URL=… npx drizzle-kit migrate`); CI applies it automatically to its ephemeral pgvector Postgres. Re-run Supabase advisors after applying to confirm the two RLS ERRORs and three FK-index INFOs are cleared.
  - No UI change. Bounded vision-page concurrency stays **deferred to Batch B** (pages remain serial).
  ```

- [ ] **Commit the changelog:**
  ```bash
  git add CHANGELOG.md
  git commit -m "docs: add v4.41.0 changelog (Batch A stability & security hardening)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Document the release checklist (do NOT execute — every step is user-gated).** Present this to the user for explicit go before running anything:
  1. **Confirm the gate is green** (Task 6 first step) on `feat/batch-a-hardening`.
  2. **Merge to master:** `git checkout master && git merge --no-ff feat/batch-a-hardening`.
  3. **Bump version:** `npm version minor` (4.40.1 → **4.41.0**; writes `package.json` + creates the `v4.41.0` tag).
  4. **Push:** `git push origin master --follow-tags` (production deploys automatically on push to `master`).
  5. **GitHub release:** `gh release create v4.41.0 --title "v4.41.0 — Stability & security hardening" --notes-file` (or `--notes` from the changelog body).
  6. **Apply migration to live Supabase** (production DB change — explicit go required): `DIRECT_URL=… npx drizzle-kit migrate`. Then re-run Supabase advisors and confirm the RLS + FK-index findings cleared. If the plan rejects `maxDuration = 800` at deploy, fall back to `300` in both routes and redeploy — the reaper still guarantees a terminal status either way.

---

## Definition of done (from the spec)

- Migration `0013` authored, generated SQL verified to contain only the 2 RLS enables + 3 indexes, drizzle ledger in sync; applied to live Supabase (user-gated) with advisors cleared.
- Summarization fires ≤ once per 10 new messages, folds only new messages, no success toast.
- A force-stuck `processing` row flips to `error` on the next documents-list fetch; `process`/`web-ingest` export `maxDuration`.
- Full gate green with the five new/extended test surfaces (`migration-0013`, `context` lower-bound, `summarize-route` 200-no-op + incremental, `documents-storage` bump, `reap-stale-processing`, `useChatPersistence` delta-gate). Shipped as v4.41.0.
