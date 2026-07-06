# Batch A — Stability & Security Hardening (design spec)

- **Date:** 2026-07-06
- **Status:** Approved (brainstorm complete) → ready for implementation plan
- **Target release:** v4.41.0
- **Source:** deep-dive audit (2026-07-06). This spec covers **Batch A only**; P1/P2/P3 batches are out of scope (see Follow-ups).

## Problem / context

The 2026-07-06 audit surfaced three verified stability/security issues that share a theme (things that silently degrade or get stuck as data grows) and are cohesive enough to ship as one hardening release:

1. **Live-DB RLS gap.** Supabase advisors report ERROR-level `rls_disabled_in_public` on `artifact_versions` and `generated_images` — the two tables added after the June RLS pass never got Row Level Security. Every other public table has RLS enabled (deny-all to PostgREST/anon). Three foreign-key columns are also unindexed (advisor `unindexed_foreign_keys`).
2. **Runaway re-summarization.** Past 30 messages, `useChatPersistence`'s `onFinish` triggers summarization on *every* assistant turn (`src/hooks/useChatPersistence.ts:136-139`), and `getMessagesForSummarization` (`src/app/actions.ts:264`) has no lower bound — it re-reads and re-summarizes the whole history from message 1 each time, and fires a "Conversation summarized" toast every exchange. Cost grows per-turn; toast spam is a visible UX bug.
3. **Document processing can get stuck forever.** `src/app/api/documents/process/route.ts` runs up to 30 serial page-render → Gemini vision calls with **no `maxDuration`** exported anywhere in the app. A platform timeout kills the function mid-run, bypassing every `catch`, leaving the `documents` row in `processing` permanently (no terminal status).

## Goals

- Bring `artifact_versions` and `generated_images` in line with the app's RLS pattern; index the three unindexed FKs.
- Make summarization incremental (fold only new messages into the existing summary) and infrequent (delta-gated), and stop the per-turn toast.
- Guarantee a document always reaches a terminal status: raise the function time budget and add a lazy reaper that flips genuinely-stuck `processing` rows to `error`.
- Ship green through the full verification gate with new unit coverage for each component.

## Non-goals (explicitly deferred)

- **Bounded vision-page concurrency** — deferred to Batch B, where it is co-designed with the "3× file-size RAM buffering" finding (adding concurrency alone risks OOM on Fluid Compute). Pages stay **serial** in Batch A.
- **Vercel Cron infrastructure** — the reaper is an opportunistic lazy sweep; no `vercel.json`/cron/`CRON_SECRET` is introduced.
- **DB connection-pool tuning, list-payload slimming, `useCallback` memoization, embed concurrency limiting, the two 1-line security fixes (SVG allow-list, login `next`)** — all Batch B/P1.
- **Dead-code sweep, docs fixes, `useLocalStorage` in-tab sync** — Batch C/P2.
- **Dependency currency (AI SDK v7, etc.)** — Batch D/P3.
- **Any UI change.** The warm palette + Fraunces typography are kept exactly as-is. No component, token, or layout is touched.

## Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Spec scope | **Batch A alone**; P3 directions captured as follow-ups |
| Summarization | **Incremental fold-in**, delta-gated (~20 new messages), toast removed |
| Stale-processing reaper | **Opportunistic lazy sweep** (no cron infra) |
| Archived chats (follow-up) | **Resurrect** — own spec later |
| Artifact renderers (follow-up) | **Warm re-skin** — own spec later |

## Design by component

### Component 1 — Migration `0013` (RLS + FK indexes)

**Authoring:** edit `src/db/schema.ts`, then `npx drizzle-kit generate` so the drizzle ledger + `drizzle/meta` snapshot stay in sync.

- `artifactVersions` and `generatedImages` table definitions get `.enableRLS()`.
- Add three indexes to the existing table definitions:
  - `artifacts` → `index('idx_artifacts_project_id').on(t.projectId)`
  - `documentRevisions` → `index('idx_document_revisions_project_id').on(t.projectId)`
  - `memorySuggestions` → `index('idx_memory_suggestions_chat_id').on(t.chatId)`

**Expected generated SQL** (verify the diff before applying — it must contain *only* these):
```sql
ALTER TABLE "artifact_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generated_images" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "idx_artifacts_project_id" ON "artifacts" USING btree ("project_id");
CREATE INDEX "idx_document_revisions_project_id" ON "document_revisions" USING btree ("project_id");
CREATE INDEX "idx_memory_suggestions_chat_id" ON "memory_suggestions" USING btree ("chat_id");
```

**Why safe:** RLS-enabled-no-policy denies PostgREST/anon but the app connects via `DATABASE_URL` (table-owner role) which bypasses RLS — proven by the 13 existing tables that already run this exact pattern with the app working. No policy is added.

**Implementation note:** drizzle's snapshots currently record `isRLSEnabled: false` for all tables (the 13 live RLS-enabled tables were enabled out-of-band), so `generate` should emit changes for *only* the two `.enableRLS()` additions + three indexes. If `generate` tries to emit anything else, hand-write `drizzle/0013_*.sql` + snapshot instead.

**Apply:** `DIRECT_URL=… npx drizzle-kit migrate` against live Supabase is **user-gated** (production DB change). CI applies it automatically against its ephemeral pgvector Postgres.

### Component 2 — Incremental summarization

**Files:** `src/hooks/useChatPersistence.ts`, `src/hooks/useSummarization.ts`, `src/app/actions.ts`, `src/app/api/summarize/route.ts`.

- **Trigger gate** (`useChatPersistence.ts`, near line 136): introduce a monotonic `lastSummarizedCountRef` (a `Map<number, number>` by chatId, mirroring the existing `lastSuggestedAtRef` auto-memory gate in the same callback). Fire only when `messageCount > SUMMARIZATION_THRESHOLD && messageCount - lastSummarized >= SUMMARIZE_EVERY`. On the summarize call, set `lastSummarizedCountRef[chatId] = messageCount`. `SUMMARIZE_EVERY = 20` is exported from `useSummarization.ts` (alongside `SUMMARIZATION_THRESHOLD`/`MESSAGES_TO_KEEP`) and imported by `useChatPersistence.ts`. A page reload resets the ref to 0 → at most one extra fold on the next finish, which is cheap because the server window is now incremental.
- **Incremental window** (`actions.ts:264`): change `getMessagesForSummarization(chatId, upToMessageId, fromMessageId = 0)` and add `gt(messages.id, fromMessageId)` to the `and(...)`. `fromMessageId` defaults to 0 (backwards-compatible with any other caller/tests).
- **Route** (`api/summarize/route.ts`): read `chat.summaryUpToMessageId ?? 0` and pass it as `fromMessageId`, so only messages in `(summaryUpToMessageId, cutoffMessageId]` are folded. The existing prompt already prepends `chat.summary` as *"Previous conversation summary … New messages to incorporate:"* — folding is already the prompt shape. If the window is empty, return a **200 no-op** (`{ success: true, summarizedMessageCount: 0 }`) instead of the current 400 — "already up to date" is not an error. `updateChatSummary` already advances `summaryUpToMessageId`.
- **Toast** (`useSummarization.ts:36`): remove the `toast.success(...)`; keep `console.error` on failure. Summarization becomes silent housekeeping, consistent with embed/title/memory.

### Component 3 — Document-processing robustness

**Files:** `src/app/api/documents/process/route.ts`, `src/app/api/documents/web-ingest/route.ts`, `src/app/actions.ts`, `src/app/api/documents/route.ts`.

- **`maxDuration`:** `export const maxDuration = 800` in `documents/process` and `documents/web-ingest`. (Supabase/Vercel Pro plan; 800s covers a 30-page vision run. If the plan rejects 800 at deploy, fall back to 300.)
- **`updated_at` bump** (`actions.ts:468` `updateDocumentStatus`): add `updatedAt: new Date()` to the `.set(...)` so the row's clock advances on every status write (it currently never does; `documents.updated_at` has no auto-update default). Required for an accurate reaper clock.
- **Lazy reaper:** new server action `reapStaleProcessing(projectId?: number)` in `actions.ts`:
  ```
  UPDATE documents
  SET status = 'error', error_message = 'Processing timed out', updated_at = now()
  WHERE status = 'processing'
    AND COALESCE(updated_at, created_at) < now() - interval '20 minutes'
    [AND project_id = $projectId]
  ```
  `COALESCE(updated_at, created_at)` handles legacy rows whose `updated_at` is null. `STALE_PROCESSING_MINUTES = 20` (> `maxDuration` ≈ 13.3 min) so a still-running job is never reaped.
- **Trigger point:** call `await reapStaleProcessing(projectId)` at the top of `GET /api/documents?projectId=` before listing, so a stuck row surfaces as `error` the next time that project is opened. One indexed `UPDATE`; negligible cost.

## Data / migration summary

- One new migration `drizzle/0013_*.sql` (+ meta snapshot): 2 RLS enables, 3 FK indexes.
- No table/column additions. `documents.updated_at` already exists (schema.ts:79); its write behavior changes (now bumped on status update).

## Verification gate

`npm run typecheck` (0) → `npm run lint` (0 errors; ≤ baseline warnings) → `npm run build` → `npm test` (incl. new tests) → CI runs `drizzle-kit migrate` + Playwright. No UI/e2e surface changes.

## Test plan (unit, Vitest / PGlite)

1. **`getMessagesForSummarization` window** — with `fromMessageId` set, returns only messages in `(from, upTo]`; default `fromMessageId=0` preserves old behavior.
2. **Summarize route** (extend `tests/unit/api/summarize-route.test.ts`) — passes `chat.summaryUpToMessageId` as the lower bound; empty window returns 200 no-op (not 400); `updateChatSummary` called with the new cutoff.
3. **Trigger gate** (`tests/hooks/useChatPersistence.test.ts`) — summarization fires once per `SUMMARIZE_EVERY` new messages past threshold, not every turn.
4. **`reapStaleProcessing`** — flips a `processing` row older than the threshold to `error`; leaves a fresh `processing` row, `ready`, and `error` rows untouched; respects the optional `projectId` filter.
5. **`updateDocumentStatus`** — bumps `updated_at`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| RLS enable breaks app reads | Proven-safe: 13 existing tables run the identical enable-no-policy pattern; app role bypasses RLS. No policy added. |
| `drizzle-kit generate` emits unexpected diffs (snapshot drift) | Eyeball generated SQL; hand-write `0013` + snapshot if it contains anything beyond the 2 enables + 3 indexes. |
| `maxDuration = 800` exceeds plan cap | Fall back to 300; the reaper still guarantees terminal status either way. |
| Reaper reaps a legitimately long job | Threshold (20 min) > `maxDuration` (~13.3 min); a job that long is already platform-killed. |
| Trigger-gate ref resets on reload | Harmless — one cheap incremental fold; server window bounds the cost. |

## Definition of done

- Migration `0013` authored, generated SQL verified to contain only the intended statements, applied to live Supabase (user-gated), drizzle ledger in sync; advisors re-run show the two RLS ERRORs and three FK-index INFOs cleared.
- Summarization fires ≤ once per 20 new messages, folds only new messages, no success toast; verified in a long chat.
- A force-stuck `processing` row flips to `error` on the next documents-list fetch; `process`/`web-ingest` export `maxDuration`.
- Full gate green with the five new/extended tests. Shipped as v4.41.0 (branch → gate → user go → merge/tag/push/release → CI → Supabase migration on confirm).

## Follow-ups captured (separate specs, not this batch)

- **Resurrect archived chats** — add an Archived list/section so the existing (currently unreachable) archive/restore chain is usable.
- **Warm-re-skin artifact renderers** — update `src/lib/artifacts/style.ts` `BRAND` to the warm palette (terracotta `#C96442` / clay `#6B4A38` / warm ink) so generated XLSX/DOCX/PDF/PPTX match the app; fix the false "mirrored from globals.css" comment.
- Remaining audit batches: **B** (P1 quick-wins), **C** (P2 dead-code + docs), **D** (P3 dependency currency).
