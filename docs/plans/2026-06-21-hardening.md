# Hardening & Cleanup — Phased Plan (2026-06-21)

Targeted remediation from a four-dimension read-only audit (security, performance, robustness, code-health) of v4.10.0. **Not** a rewrite — the app is otherwise solid (parameterized SQL, confined secrets, Zod on every POST, no SSRF/eval). Full execution detail + per-item code lives in the session scratch plan; this is the repo-tracked summary.

**Decisions:** (1) lightweight access gate now (full per-user auth deferred to its own project); (2) targeted fixes only — defer the large `page.tsx` (1201 lines) / `actions.ts` (674 lines) decomposition.

Each phase is its own release: implement → gate (`npm run lint` 0 errors, `npx tsc --noEmit`, `npm run build`, `npm test`) → commit → merge `--no-ff` → tag.

## Phase 1 / v4.11.0 — Security ✅
- **Access gate** (`middleware.ts` + `/login` + `/api/auth` + `lib/auth.ts`): HMAC httpOnly cookie, off unless `APP_ACCESS_PASSWORD` set.
- Model allow-list (`z.enum(MODEL_IDS)`); derive document-process `storagePath` server-side (no client trust); `apiError` no prod detail + unify 3 routes; security headers/CSP; signed-URL TTL 3600→300s; xlsx injection guard.

## Phase 2 / v4.12.0 — Robustness & correctness
- Atomic `acceptSuggestion` (transaction + SQL append) + cancel rail debounce on accept (fixes `projects.memory` lost-update race).
- Document-replace: insert-new-then-delete-old in a transaction + set `error` status on mid-flight failure.
- Add `error.tsx`/`global-error.tsx`/`not-found.tsx`; Zod-validate classify LLM JSON; monotonic memory-suggest trigger; artifact orphan-blob guard; storage signed-URL failure logging; shared `uiMessageSchema`.

## Phase 3 / v4.13.0 — Performance
- RAG: parallelize message/document branches + skip query-rewrite on first turn (biggest time-to-first-token win).
- `Promise.all` independent awaits in `memory/suggest` + `chat` routes + `onFinish`.
- Bound `getAllArtifacts` (no LIMIT today); memoized `<MessageRow>` so streaming re-parses only the active row; `memory_suggestions` index `(project_id, status, created_at)` (migration `0009`, gated).

## Phase 4 / v4.14.0 — Code health
- Delete dead actions (`getAllEmbeddings`, `getEmbeddingsForChat/Project`); collapse `getChatWithSummary` alias.
- Shared `extractText`/`toArtifactSummary`/`signedUrlOrNull` helpers; dedup `Project`/`Chat` interfaces; add `typecheck` script + CI wiring; console-log context tags; triage untracked files; stabilize the flaky exceljs render test timeout.

## Deferred
Full per-user auth (Clerk + ownerId); `page.tsx`/`actions.ts` decomposition; RAG result caching; `MessagesList` virtualization.
