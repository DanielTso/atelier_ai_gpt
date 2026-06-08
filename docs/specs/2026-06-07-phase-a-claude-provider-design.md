# Phase A — Add Claude as a Model Provider

**Status:** Approved design (2026-06-07) · **Author:** brainstormed with Claude Code
**Program:** Part 1 of a 4-phase effort to turn Atelier Studio into a Claude-powered construction-document workhorse.

---

## Program context (why this phase exists)

The umbrella goal: a private, work-usable wrapper for Claude that ingests construction
documents/plans/images, extracts information, and produces reports (Excel/Word artifacts) —
with Gemini retained only for image generation and embeddings. Four phases, each with its
own spec → plan → build → test cycle:

- **Phase A (this spec)** — Add Claude as the primary chat provider alongside Gemini.
- **Phase B** — Upgrade RAG storage & retrieval (vector store decision + reranking).
- **Phase C** — Construction plan / image extraction (multimodal, vision models).
- **Phase D** — Artifacts: generate downloadable Excel + Word reports.

Phases are sequenced A→B→C→D by dependency. This spec covers **A only**.

---

## Goal

After this phase, Atelier Studio uses Claude as its default chat brain:

- New chats default to **Claude Opus 4.8**.
- The model picker offers **Opus 4.8**, **Sonnet 4.6**, **Haiku 4.5**, and **Nano Banana 2** (image).
- Claude text models can **search the web** (Anthropic server-side web search).
- **Gemini text models are removed** from the picker.
- Gemini still runs **embeddings** and **image generation** invisibly.

## The architectural split (one sentence)

**Claude = brain** (chat, reasoning, web search). **Gemini = senses** (embeddings, image generation).
Embeddings *must* stay on Gemini because Anthropic exposes no embeddings API — therefore the RAG
pipeline is untouched by this phase, and Phase B's work is unaffected by the chat-model choice.

## Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Model lineup: Opus 4.8 (default), Sonnet 4.6, Haiku 4.5, Nano Banana 2 image | User chose "full tier, Opus default" |
| 2 | Claude text models get **web search** enabled | User: "Claude can do all the rest" incl. research |
| 3 | Gemini **text** models retired from the picker | User: "retire them, keep image only" |
| 4 | Embeddings + image gen stay on Gemini | Anthropic has no embeddings API; Nano Banana wanted |
| 5 | Housekeeping (title / summarize / classify) runs on **Gemini `gemini-3.5-flash`**, decoupled from the chat model | Cheap, fast, no Opus tokens on background tasks; `classify` already does this |
| 6 | Provider via **`@ai-sdk/anthropic`** (sibling of `@ai-sdk/google`) | App is built on the Vercel AI SDK; keeps `streamText`/`convertToModelMessages` unchanged |
| 7 | Adaptive thinking on Opus/Sonnet | Recommended for report-grade reasoning; exact AI SDK shape verified at plan time (see Risks) |

## Model IDs (authoritative — from the claude-api reference)

| Menu name | Model ID | Context | Price in/out per 1M |
|---|---|---|---|
| Claude Opus 4.8 (default) | `claude-opus-4-8` | 1M | $5 / $25 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | $3 / $15 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1 / $5 |
| Nano Banana 2 (image) | `gemini-3.1-flash-image` | — | (existing) |

Internal-only (not in picker): `gemini-3.5-flash` (housekeeping), `gemini-embedding-001` (embeddings).

## Scope — files to change

| File | Change |
|---|---|
| `package.json` | Add dependency `@ai-sdk/anthropic` |
| `src/lib/settings.ts` | Add `getAnthropicApiKey()` → DB key `anthropic-api-key`, env fallback `ANTHROPIC_API_KEY` |
| `src/app/actions.ts` | Add `anthropic-api-key` to the client-read blocklist alongside `gemini-api-key` (server-only secret) |
| `src/lib/providers.ts` | Add `claude-*` branch → Anthropic model + web-search tool + thinking config; keep Gemini image + internal Gemini text branches |
| `src/app/api/models/route.ts` | Return Claude models when Anthropic key present; Nano Banana when Gemini key present; drop Gemini text models; Opus 4.8 first |
| `src/app/api/generate-title/route.ts` | Pin to internal `gemini-3.5-flash` (stop using the chat model) |
| `src/app/api/summarize/route.ts` | Pin to internal `gemini-3.5-flash` (stop using the chat model) |
| `src/app/api/classify/route.ts` | No behavior change (already Gemini-pinned); confirm it tolerates a Claude `model` in the request body |
| Settings UI (`src/components/settings/*`) | Add an Anthropic API-key input beside the Gemini key field |
| Tests | Unit + E2E (see Testing); extend API-route mocks to cover `@ai-sdk/anthropic` |
| `CLAUDE.md` | Update provider routing, model IDs, env setup, AI SDK gotchas after verification |

The main chat route (`src/app/api/chat/route.ts`) needs **no structural change** — it is already
provider-agnostic (`createProvider()` → `streamText()` → `toUIMessageStreamResponse({ sendSources: true })`).
Claude web-search sources reuse the existing `source-url` chip rendering.

## Data flow (a Claude chat)

1. `page.tsx` sends `{ messages, model: "claude-opus-4-8", chatId }` to `POST /api/chat`.
2. `createProvider("claude-opus-4-8")` returns the Anthropic model object + web-search tool + thinking options.
3. The existing five-layer context (system + Gemini-embedded RAG + summary + recent 20) is built unchanged.
4. `streamText` streams text, thinking, and `source-url` parts; the client renders them as today.
5. Image input continues to flow through `convertToModelMessages` → Claude vision (sets up Phase C).

## Error handling & graceful degradation

- No Anthropic key → Claude models are absent from the picker (same pattern as Gemini today). If a
  Claude model is somehow selected without a key, return a clear "set your Anthropic key in Settings" error.
- Web-search failure degrades to plain reasoning (best-effort, like document retrieval today).
- Keys are independent: Gemini-only → images + embeddings still work; Anthropic-only → chat works (no image gen).

## Testing

- **Unit**
  - `getAnthropicApiKey()` — DB-first, env-fallback, cache behavior.
  - `createProvider()` Claude branch — returns an Anthropic model + web-search tool; throws without a key.
  - `models` route — Claude models appear iff Anthropic key present; image model iff Gemini key; no Gemini text models.
  - Extend existing API-route test mocks to register `@ai-sdk/anthropic`.
- **E2E (Playwright)**
  - Picker shows Opus / Sonnet / Haiku / Nano Banana, no Gemini text models.
  - Selecting Opus and sending a message streams a reply (provider mocked, as CI does today).
- **Verification gate (must pass, zero warnings):**
  `npm install && npm run lint && npm run build && npm test && npm run test:e2e`
  followed by a manual `npm run dev` smoke test (set an Anthropic key in Settings, send a Claude chat,
  confirm web-search sources render, confirm an image still generates via Nano Banana).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Exact `@ai-sdk/anthropic` v6 API for **web search** + **adaptive thinking** differs from memory | Verify both via Context7 during the writing-plans stage before coding; do not hardcode from memory. If adaptive-thinking config is unsupported/awkward in the SDK, ship Phase A with Claude working *without* an explicit thinking config (still functional) and treat thinking as a follow-up. |
| Opus 4.8 rejects `budget_tokens` (400) | Use adaptive thinking only; never send a fixed thinking budget. |
| API-route test mocks currently assume Gemini | Add an `@ai-sdk/anthropic` mock alongside the existing `@ai-sdk/google` mock. |
| Housekeeping routes silently break if they keep receiving a Claude `model` | Pin them server-side to `gemini-3.5-flash`; ignore the client-passed model for these tasks. |
| Work-policy: app calls the Anthropic API with the user's key | Out of engineering scope; user's decision. Noted, not blocking. |

## Non-goals (explicitly out of scope for Phase A)

- RAG storage/retrieval changes, vector DB selection, reranking (**Phase B**).
- Construction plan / image text extraction, OCR, vision pipelines (**Phase C**).
- Excel / Word artifact generation, report builder UI (**Phase D**).
- Removing Gemini embeddings or image generation.
- Multi-user auth.

## Definition of done

- [ ] `@ai-sdk/anthropic` installed; build clean.
- [ ] Anthropic key configurable via Settings and `ANTHROPIC_API_KEY`; never readable by client code.
- [ ] Picker shows Opus 4.8 (default) / Sonnet 4.6 / Haiku 4.5 / Nano Banana 2; no Gemini text models.
- [ ] A Claude chat streams a reply end-to-end, with web-search sources rendering as chips.
- [ ] Nano Banana 2 still generates images; embeddings still run on Gemini.
- [ ] Title / summarize / classify run on `gemini-3.5-flash` regardless of chat model.
- [ ] Full verification gate passes with zero warnings; manual smoke test done.
- [ ] `CLAUDE.md` and `CHANGELOG.md` updated; session chatlog written.
