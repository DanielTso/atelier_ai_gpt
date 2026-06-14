# Chatlog — 2026-06-07 — Phase B2: Advanced RAG

## Decisions

- User chose the **full basket** (rewrite + rerank + MMR + tunable thresholds + test speedup) despite my flag that most RAG tuning is best done with real data.
- Engineering response: build the data-dependent parts (thresholds) as **configurable with sane defaults**, not hard-tuned; make **every stage best-effort/degrading** so the pipeline can never retrieve worse than plain vector search. Defer actual threshold tuning until real construction docs are loaded.
- **No new providers/keys** — rewrite + rerank run on in-stack Gemini Flash via the proven `generateText`+parse+fallback pattern (same as the `classify` route), avoiding any new structured-output API risk.
- Rewrite + rerank add two Flash calls/message (~1–2s); each is env-toggleable for latency control.

## Pipeline

`retrieveContext()` (`src/lib/retrieval.ts`): query-rewrite → embed → vector top-N (20) → MMR (λ 0.7) → LLM rerank → top-k (docs 3 / msgs 5). New modules: `ragConfig`, `queryRewrite`, `rerank`, `mmr`. `embeddings.ts` widened to return candidate vectors for MMR. Chat route's inline retrieval block replaced by one `retrieveContext()` call.

## Execution (subagent-driven, branch `phase-b2-advanced-rag`)

9 role-framed tasks, TDD throughout; additive (no migration red-zone):

1. `ragConfig` (env + defaults) — 3 tests.
2. `mmr` pure function — 3 tests (near-dup suppression).
3. `queryRewrite` — 3 tests (rewrite + no-key/error fallback).
4. `rerank` — 3 tests (reorder + unparseable/no-key fallback).
5. `embeddings.ts` returns candidate embeddings for MMR.
6. `retrieval.ts` orchestrator + chat wiring — 3 tests; chat route slimmed 45→5 lines. Full review: READY.
7. Shared-PGlite + TRUNCATE test speedup — suite ~40s → ~15s.
8. Docs.
9. Gate.

**Verification:** full suite **158 tests green** (143 prior + 15 new), tsc clean. Each LLM stage degrades gracefully; with all toggles off the pipeline == plain pgvector top-k.

## Notes / what's next

- Thresholds are configurable defaults, not data-tuned — once real construction docs are loaded and retrieval misses something, tune via `RAG_*` env vars (no code change).
- Possible future: surface the `RAG_*` knobs in the Settings UI; tune thresholds against real data; consider a dedicated reranker (Cohere/cross-encoder) if Flash rerank proves insufficient.
- **Phase C** is the next big one: construction plan/image extraction (multimodal vision) — Supabase Storage for the uploaded files/images.
