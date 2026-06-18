# Chatlog — 2026-06-07 — Phase A: Claude provider

## How this started

The user asked what RAG system the app uses and to scan for improvements. The codebase scan found a **dual-source brute-force-cosine RAG**: message-memory embeddings + document chunks, both Gemini `gemini-embedding-001` (768-dim), stored as JSON text in SQLite, searched by loading every vector and looping cosine in JS. Improvements identified: native/binary vector storage, reranking, batched embeddings, better query construction, threshold tuning.

The conversation then expanded into a larger vision: turn Atelier Studio into a **Claude-powered construction-document workhorse** — upload construction PDFs/plans/images, extract info, produce Excel/Word reports — usable at work where claude.ai/Cowork/Code are disallowed (so the app wraps the Anthropic API with the user's own key). Gemini kept only for image generation and embeddings.

## The four-phase roadmap (agreed A→B→C→D)

- **Phase A — Claude as the chat provider** (this session). Done.
- **Phase B — RAG storage & retrieval upgrade.** Open decision: **Turso-native vectors** (`F32_BLOB` + vector index, zero migration) vs **Supabase Postgres + pgvector** (bigger migration, but stronger long-term: pgvector + Storage for Phase C docs/images + Auth). To be brainstormed properly with the Supabase skill/MCP.
- **Phase C — Construction plan / image extraction** (multimodal vision; highest risk — needs a spike).
- **Phase D — Artifacts: Excel (`exceljs`, already a dep) + Word (`docx`).**

## Phase A decisions (from brainstorming)

1. Model lineup: **Opus 4.8 (default), Sonnet 4.6, Haiku 4.5** + Nano Banana 2 image.
2. Claude **web search enabled** ("Claude does all the rest"; Gemini reduced to image generation).
3. Gemini **text** models retired from the picker.
4. Embeddings + image gen stay on Gemini (Anthropic has no embeddings API).
5. Housekeeping (title/summarize/classify) pinned to internal `gemini-3.5-flash`.
6. Provider via `@ai-sdk/anthropic` (sibling of `@ai-sdk/google`).

## Verified via Context7 (AI SDK v6)

- Web search: `createAnthropic({apiKey})` → `anthropic.tools.webSearch_20250305({ maxUses: 5 })` under `tools: { web_search }`.
- Thinking: AI SDK v6 only exposes budget-based thinking, which **Opus 4.8 rejects (400)** → Phase A ships Claude **without** thinking config (deferred).

## Three corrections the plan made to the approved spec

1. **No key-entry UI existed** → added a proper **API Keys** settings tab (both providers).
2. **Adaptive thinking OFF** in Phase A (the 400 issue above) — web search stays on.
3. **E2E can't test Claude in CI** (real Playwright server, no secrets) → Claude routing covered by unit tests; E2E stays key-independent.

## Implementation (subagent-driven, branch `phase-a-claude-provider`)

12 TDD tasks, each implemented by a fresh subagent with spec + code-quality review:

1. `@ai-sdk/anthropic@3.0.81` dependency.
2. `getAnthropicApiKey()` (DB-first, env fallback) + tests.
3. `anthropic-api-key` added to `SENSITIVE_KEYS` + tests.
4. `createProvider` Claude branch (web search; deep-think handling removed) + 5 tests.
5. `/api/models` lists Claude (Opus first) + Nano Banana, no Gemini text + tests.
6. `/api/chat` Claude routing + default fallback `claude-opus-4-8` + test.
7. `title`/`summarize` pinned to `gemini-3.5-flash`.
8. Persona combos repointed to the Claude lineup; labels updated.
9. Model-Defaults dropdown groups Claude + Image.
10. API Keys settings tab + `getApiKeyStatus()` (booleans only). Quality review caught a duplicate DB/env read → refactored to reuse `getGeminiApiKey`/`getAnthropicApiKey`.
11. Docs (this file, CLAUDE.md, CHANGELOG).
12. Verification gate + manual smoke (user runs with a real Anthropic key).

Note: a code-quality reviewer cited the *global* CLAUDE.md "no direct process.env" rule, which describes a different repo. The fix was accepted on its real merit (DRY / reuse cached accessors), not that rule. Brand-token nits (`bg-black/20`, label `htmlFor`) were declined — they match the sibling settings tabs and a brand migration is out of Phase A scope.

## Where embeddings/RAG stand (for Phase B)

Unchanged by Phase A. `src/lib/embeddings.ts` still does brute-force cosine over JSON-parsed vectors; `src/lib/providers.ts` still constructs the Gemini embedding model. Phase B is where the vector-store decision and reranking land.
