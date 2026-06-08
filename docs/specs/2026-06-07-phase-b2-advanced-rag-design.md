# Phase B2 — Advanced RAG (rerank · query-rewrite · MMR · tunable thresholds) + test speedup

**Status:** Approved design (2026-06-07) · **Program:** B2 polish on top of Phase B (Supabase Postgres + pgvector). Part of the Atelier Studio workhorse effort (A: Claude ✓ · B: pgvector ✓ · **B2: advanced RAG** · C: construction extraction · D: artifacts).

---

## Goal

Upgrade retrieval from "embed → pgvector top-k → inject" to a refined multi-stage pipeline:

**rewrite → embed → vector top-N → MMR (diversity) → rerank (precision) → top-k → inject**

Every new stage is **optional and degrades to the previous behavior** on any failure or missing key — the pipeline can never do worse than today's plain vector search. Plus a test-suite speedup. **No new providers/keys**: all LLM steps use the in-stack Gemini Flash (`gemini-3.5-flash`), same as the housekeeping routes.

**Unchanged:** Claude chat, the five-layer context assembly, the `vector(768)`/HNSW storage, and Gemini embeddings. B2 only changes *which candidates* get injected and *in what order*.

## Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Full basket: query-rewrite + rerank + MMR + tunable thresholds + test speedup | User chose comprehensive |
| 2 | All LLM stages use in-stack **Gemini Flash** (`gemini-3.5-flash`) | No new provider/key; matches housekeeping |
| 3 | Pipeline order: rewrite → embed → vector top-N (20) → MMR (λ 0.7) → rerank → top-k (docs 3 / msgs 5) | Retrieve wide, refine for diversity then precision |
| 4 | Every stage **best-effort with graceful fallback** | Never worse than plain vector search |
| 5 | Thresholds/top-N/top-k/λ/toggles live in `ragConfig.ts` with **env/DB overrides + defaults** | "Tuning" deliverable = configurable, since real-doc data isn't available yet |
| 6 | Two added Flash calls/message (rewrite + rerank), each individually toggleable | User accepted the ~1–2s latency tradeoff |
| 7 | Test speedup via **shared PGlite + TRUNCATE** between tests | ~40s → seconds; pure DX |

## New modules (bounded, independently testable)

| File | Responsibility | Interface |
|---|---|---|
| `src/lib/ragConfig.ts` | Single source of tunable RAG settings | `getRagConfig(): RagConfig` (reads env, falls back to defaults) |
| `src/lib/queryRewrite.ts` | Conversation → standalone retrieval query | `rewriteQuery(messages, opts?): Promise<string>` — Gemini Flash; **falls back to the last user message text** on any error/no key |
| `src/lib/rerank.ts` | LLM relevance-score candidates, reorder | `rerankCandidates<T>(query, candidates, topK): Promise<T[]>` — Gemini Flash structured scoring; **falls back to input order** on any error/no key |
| `src/lib/mmr.ts` | Pure-JS diversity selection over candidate vectors | `mmr<T>(queryVec, candidates, topK, lambda): T[]` — no I/O, deterministic |

`RagConfig` fields (with defaults): `docThreshold` 0.5, `msgThreshold` 0.7, `topN` 20, `docTopK` 3, `msgTopK` 5, `mmrLambda` 0.7, `rewriteEnabled` true, `rerankEnabled` true, `mmrEnabled` true. Env overrides e.g. `RAG_DOC_THRESHOLD`, `RAG_TOP_N`, `RAG_RERANK_ENABLED`.

## Changes to existing files

| File | Change |
|---|---|
| `src/lib/embeddings.ts` | `findSimilarMessages`/`findSimilarDocumentChunks` gain an optional `topN` and **also return each candidate's `embedding` vector** (for MMR). Defaults preserve current callers. Threshold/topN sourced from `ragConfig`. |
| `src/app/api/chat/route.ts` | Orchestrate the pipeline (rewrite → embed → retrieve top-N → MMR → rerank → top-k) in the existing semantic/document retrieval block, each stage in try/catch with fallback to the prior stage. Context injection unchanged. |
| `tests/helpers/test-db.ts` | Shared module-level PGlite + one migrate; `createTestDb()` runs `TRUNCATE <all tables> RESTART IDENTITY CASCADE` instead of constructing a new instance. |
| `src/lib/validation.ts` / others | No request-shape change (pipeline is server-internal). |
| `CLAUDE.md`, `CHANGELOG.md`, chatlog | Document the pipeline, config knobs, latency note. |

## Data flow (`/api/chat` retrieval block, after)

1. **Rewrite** (Flash): last ~3 turns + latest question → standalone query. Fallback: raw last user text.
2. **Embed** the (rewritten) query — Gemini, unchanged; one vector shared by both retrievers.
3. **Vector top-N** (pgvector HNSW, N=`topN`): messages (project/chat-scoped) + doc chunks (project-scoped), each with its embedding.
4. **MMR** (λ=`mmrLambda`): drop near-duplicate/overlapping chunks, keep diverse-yet-relevant set. Skipped if `mmrEnabled` false.
5. **Rerank** (Flash): score survivors vs the query, reorder. Skipped if `rerankEnabled` false or no key.
6. **Top-k**: docs→`docTopK` (3), msgs→`msgTopK` (5); injected exactly as today.

## Error handling

Best-effort per stage: rewrite fails → raw query; vector retrieval fails → empty (as today); MMR off/throws → vector order; rerank off/no-key/throws → MMR order. The existing outer `try/catch` (embedding unavailable → skip semantic context) remains the backstop.

## Testing

- **Unit:** `mmr` (diversity + near-dup removal on crafted vectors); `rerank` (mocked Flash reorders; failure → passthrough order); `queryRewrite` (mocked Flash → standalone; failure → fallback to last user text); `ragConfig` (defaults; env override parsing incl. boolean toggles).
- **Integration:** chat-route test — pipeline wires together; when a stage throws, retrieval still returns (fallback) and the response streams.
- **Test speedup:** the entire existing suite stays green and runs materially faster; assert `createTestDb()` yields isolated state per test (TRUNCATE resets identity + data).
- **Gate (zero warnings):** `npm install && npm run lint && npm run build && npm test && npm run test:e2e` + manual `npm run dev` smoke.

## Execution model (role-based)

Per the saved agent-stack reference, around this spec: **Backend** (ragConfig, queryRewrite, rerank, mmr, embeddings widening, chat-route wiring), **QA/Breaker** (the four module test suites + the integration test + the PGlite test-speedup), **Reviewer** (per-task spec + code-quality gates), **Docs** (CLAUDE.md/CHANGELOG/chatlog). Frontend unused (no UI; config-UI deferred).

## Sequencing

ragConfig → mmr (pure, easiest) → queryRewrite → rerank → embeddings widening (+embeddings returned) → chat-route pipeline wiring → test-db speedup → docs → gate.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Added latency (2 Flash calls/msg) | Each stage toggleable via `ragConfig`; user accepted tradeoff |
| Building tuning blind (no real docs yet) | Thresholds are *configurable with defaults*, not hard-tuned; stages degrade so they can't hurt |
| Exact Gemini Flash structured-output API (for rerank scoring) differs from memory | Verify `generateObject`/Zod-with-`@ai-sdk/google` via Context7 during writing-plans before coding |
| Shared-PGlite test isolation bugs (state leak between tests) | TRUNCATE … RESTART IDENTITY CASCADE in `beforeEach`; a test asserts isolation |
| MMR needs candidate embeddings | `embeddings.ts` returns vectors for the candidate set (extra column in the select) |

## Non-goals (B2)

- Config UI for the knobs (env/DB only for now).
- New providers/keys (Cohere rerank, cross-encoders) — Gemini Flash only.
- Changing chunking, the embedding model, or the storage schema.
- Real-data threshold tuning (done later, once construction docs are loaded).

## Definition of done

- [ ] `ragConfig.ts`, `queryRewrite.ts`, `rerank.ts`, `mmr.ts` exist, each unit-tested, each degrading gracefully.
- [ ] `embeddings.ts` retrieves top-N and returns candidate embeddings; thresholds/topN from `ragConfig`.
- [ ] `/api/chat` runs rewrite → MMR → rerank → top-k, every stage with fallback; behavior with all toggles off == current plain vector search.
- [ ] Test suite green **and** materially faster via shared PGlite + TRUNCATE.
- [ ] Full gate passes zero-warning; manual smoke done.
- [ ] `CLAUDE.md` (pipeline + config knobs + latency note), `CHANGELOG.md`, chatlog updated.
