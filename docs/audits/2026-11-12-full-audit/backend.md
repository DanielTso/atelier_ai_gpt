# Back-end correctness audit — Atelier Studio

Repo `C:\dev\atelier_ai_gpt`, branch `master`, HEAD `b64850c`. Read-only lane. Date 2026-11-12.

## Summary

The server code is in decent shape where the September remediation touched it (cost ledger abort handling, Sonnet 5 price, `usage_events` indexes/CHECKs and RLS are all verified fixed), but this pass found 26 new defects, three of them High. The worst: (1) pressing Stop (or losing the connection) while a tool is executing leaves an unfinished tool call in the client history, and every later send in that session dies in the AI SDK with "An error occurred." until the page is reloaded; (2) moving a chat to another project updates only `chats.project_id`, so deleting the old project cascade-deletes the moved chat's artifacts and embeddings; (3) `read_document` windows (up to 100k chars each) are replayed in full on every later turn of a live session. Below those sit a set of Medium defects in retrieval (MMR throws away the RRF fusion; a failed summarize fold opens a silent context gap; session messages are re-injected as "previous conversations"), artifacts (regenerate silently truncates at 8,000 output tokens; nested list items vanish from DOCX/PDF/PPTX) and document replace (a failed replace marks a healthy document as errored). Of the previously reported back-end items, 4 are fixed, 1 is partly fixed and 28 are still open, including all of the Audit Phase 3 list (X1, X4, X5, C3, C5).

Verification done: `npm run typecheck` 0 errors; ESLint over `src/lib`, `src/app/api`, `src/app/actions.ts`, `src/db` 0 errors / 1 warning. Probes were run from `C:\tmp\audit-2026-11-12\backend-scratch\` (Vitest against in-process PGlite with `@/db` mocked, plus one plain Node script against the installed `ai@6.0.230`). Nothing connected to the production database or called an external API. Nothing in the repo was modified (`git status` clean).

CONFIRMED means reproduced by a probe or traced end to end in code. PLAUSIBLE means the code path is real but the trigger depends on timing, an outage or model behaviour that was not executed.

## Findings

| ID | Sev | Status | Location | Defect |
|---|---|---|---|---|
| B1 | High | CONFIRMED | `src/app/api/chat/route.ts:197` | An interrupted tool call (`input-available`) in client history makes every later send throw `MissingToolResultsError`; session is dead until reload |
| B2 | High | CONFIRMED | `src/app/actions.ts:232` | `moveChatToProject` leaves artifacts, embeddings and persona usage on the old project; deleting that project cascade-deletes them |
| B3 | High | CONFIRMED | `src/app/api/chat/route.ts:108,157-160,197` | Tool outputs (`read_document` windows, up to 100k chars each) are re-sent in full on every later turn of a live session |
| B4 | Medium | CONFIRMED | `src/app/api/chat/route.ts:157-159` | Any failed summarize fold leaves messages in neither the summary nor the last-20 tail |
| B5 | Medium | CONFIRMED | `src/lib/retrieval.ts:75-85` | MMR re-ranks by vector similarity and discards the RRF order; a chunk found by both legs is dropped while a keyword-only chunk survives |
| B6 | Medium | CONFIRMED | `src/app/api/artifacts/[id]/regenerate/route.ts:50` | Regenerate caps output at 8,000 tokens with no `finishReason` check; a truncated document is saved as the current version |
| B7 | Medium | CONFIRMED | `src/lib/artifacts/markdown.ts:42-50,85` | Nested list items (and lists inside blockquotes) are silently dropped from DOCX/PDF/PPTX |
| B8 | Medium | CONFIRMED | `src/app/api/documents/process/route.ts:65,77,117,164` | A failed replace (download, extraction, empty text, no embedding provider) marks the healthy existing document `error` |
| B9 | Medium | CONFIRMED | `src/lib/retrieval.ts:37,49` | Messages sent in the current session are never excluded from semantic retrieval; the conversation is re-injected as "previous conversations" |
| B10 | Medium | CONFIRMED | `src/lib/retrieval.ts:30` | An embedding failure discards the keyword leg too, so document context is null during a Gemini outage |
| B11 | Medium | PLAUSIBLE | `src/lib/queryRewrite.ts:19`, `rerank.ts:27`, `embeddings.ts:51`, `embedChunks.ts:17-30` | No timeout or fast-fail on any Gemini call; an outage adds retry latency to every chat turn and can run a large ingest into the platform kill |
| B12 | Medium | CONFIRMED | `src/lib/models/registry.ts:203-206,283-288`, `src/app/actions.ts:401-403` | A transient `/v1/models` failure silently re-routes chats to the seed default and makes `updateProjectDefaults` null a valid model |
| B13 | Medium | CONFIRMED | `src/app/api/embed/route.ts:57-65` | Embed failures return 200 with no retry, no marker and no backfill path; long messages are sent to the embedder uncapped |
| B14 | Medium | CONFIRMED | `src/lib/artifacts/tool.ts:22-34`, `render.ts:23-34` | `generate_artifact` does not check type against content shape: an xlsx with string content renders an empty workbook and reports success |
| B15 | Low | CONFIRMED | `src/app/actions.ts:1033-1050` | `acceptSuggestion` ignores status: a double accept appends the fact twice, and a dismissed suggestion can be accepted |
| B16 | Low | CONFIRMED | `src/app/actions.ts:553-557`, `src/app/api/classify/route.ts:93-95` | Duplicate topic or fractional confidence from the model throws on insert; topics are never cached and the model is re-billed each call |
| B17 | Low | CONFIRMED | `src/lib/artifacts/toDocx.ts:56-62,72,78` | All ordered lists share one numbering instance (second list continues at 3); code-block newlines collapse in DOCX |
| B18 | Low | CONFIRMED | `src/lib/artifacts/toXlsx.ts:11,24` | Invalid, duplicate or over-31-char sheet names throw and fail the whole artifact; the formula guard writes a visible apostrophe on "-" and negative strings |
| B19 | Low | CONFIRMED | `src/lib/models/registry.ts:83`, `pricing.ts:89-97` | Dated-only catalog ids miss `EXACT_PRICING` and alias-keyed overrides: cost rows are flagged estimated and an override is silently ignored |
| B20 | Low | CONFIRMED | `src/lib/image/tool.ts:31-32`, `src/app/api/images/generate/route.ts:44-54` | Generated images are uploaded before any DB row exists; an aborted turn or failed insert orphans the object |
| B21 | Low | CONFIRMED | `src/lib/ingest.ts:26-35`, `src/app/actions.ts:594-603` | Ingest sets status `error` with no `errorMessage`; a stale `error_message` is never cleared on a later success |
| B22 | Low | PLAUSIBLE | `src/app/api/summarize/route.ts:74-77` | An empty model reply overwrites the existing summary with `''` and still advances the boundary |
| B23 | Low | PLAUSIBLE | `src/app/actions.ts:313-314,331-332`, `src/lib/models/registry.ts:245-247` | Settings cache is cleared before the write commits; a concurrent read re-caches the old key for 5 minutes |
| B24 | Low | PLAUSIBLE | `src/lib/auth.ts:120-131` | File-path signatures are tied to the gate state and secret; enabling the gate or rotating the secret permanently breaks images embedded in HTML artifacts |
| B25 | Low | CONFIRMED | `src/app/api/documents/upload-url/route.ts:42-47`, `process/route.ts:213` | Upload-url leaves an orphan `uploading` row if signing fails; the replace abort path sets `ready` even when the document was `error` before |
| B26 | Low | CONFIRMED | `src/app/api/memory/suggest/route.ts:64-67` | Prompt is built with `String.replace`, so `$&`, `$'`, `` $` `` and `$$` in project memory are interpreted as replacement patterns |

## Finding detail

### B1 — Interrupted tool call bricks the chat session (High, CONFIRMED)

**Scenario.** User asks for an image (or a document sweep, or an artifact). While the tool is executing the user presses Stop, the tab loses the network, or the function hits `maxDuration`. The assistant message in `useChat` state keeps a tool part in state `input-available`. The user types the next message.

**Evidence.**
- `src/app/page.tsx:253-262` uses `DefaultChatTransport` with no `prepareSendMessagesRequest`; the full message array is posted as-is. No code strips incomplete tool parts (the only `setMessages` calls are load, clear and the image-append in `useChatPersistence.ts:91`).
- `src/app/api/chat/route.ts:197` calls `convertToModelMessages(contextMessages)` without `ignoreIncompleteToolCalls`. In `node_modules/ai/dist/index.mjs:8878-8884` that option is the only thing that filters `input-available` parts; without it a `tool-call` is emitted with no `tool-result`.
- `node_modules/ai/dist/index.mjs:1382-1418` then throws `MissingToolResultsError` before the provider is called.
- Probe `C:\tmp\audit-2026-11-12\backend-scratch\sdk-probe.mjs` (installed SDK, mock model): model messages come out as `assistant: [text, tool-call]` followed by `user`, the provider is called 0 times, and the stream body is `{"type":"error","errorText":"…AI_MissingToolResultsError: Tool result is missing for tool call call_1."}`.
- The route's `onError` (`route.ts:308-313`) only surfaces `APICallError` with status 400, so the user sees "An error occurred." on every send. A reload fixes it because history is rebuilt from text-only DB rows.
- Not executed in a browser. The provider-executed `web_search` variant is PLAUSIBLE only: the SDK check skips provider-executed calls, so that one would reach Anthropic and fail there.

**Minimal fix.** `convertToModelMessages(contextMessages, { ignoreIncompleteToolCalls: true })`. Optionally also drop such parts client-side on stop/error.

### B2 — Moving a chat leaves its children on the old project (High, CONFIRMED)

**Scenario.** Chat in project A has an artifact and embedded messages. User moves it to project B (`page.tsx:1087`), later deletes project A.

**Evidence.** `moveChatToProject` (`actions.ts:232-234`) updates `chats.project_id` only. `artifacts.project_id`, `message_embeddings.project_id` and `persona_usage.project_id` all reference `projects` with `ON DELETE CASCADE` (`schema.ts:55,130,169`). Probe `db.probe.test.ts`:

```
AFTER MOVE artifact.projectId 1 expected 2
AFTER MOVE embeddings in B 0 in A 1
AFTER DELETE A: chat survives true artifact null embeddings total 0 messages 1
```

So the chat survives in B but its artifact (and versions, by cascade) and embeddings are gone, and the Storage objects are orphaned. Before any delete, retrieval is also wrong: `findSimilarMessages` scopes by `project_id` (`embeddings.ts:83-87`), so the moved chat's history is invisible in B and still retrievable from A. The same applies to a standalone chat moved into a project (rows keep `project_id = NULL`).

**Minimal fix.** Do the move in one transaction that also updates `project_id` on `artifacts`, `message_embeddings`, `persona_usage` (and `usage_events` if spend should follow the chat) where `chat_id = $1`.

### B3 — Tool outputs replayed on every later turn (High, CONFIRMED)

**Scenario.** In a project chat the user asks a set-wide question; Claude calls `read_document` five times (5 × 100k chars ≈ 125k tokens). The user then asks three short follow-ups in the same session.

**Evidence.** The client posts its whole message array (see B1). The route takes it verbatim (`route.ts:108`), slices only when a summary exists (`:157-159`), and converts it including tool parts with their outputs (`:197`; the SDK emits a `tool-result` for every `output-available` part, `index.mjs:9049-9066`). Nothing stubs or caps old tool outputs. `docs/architecture/rag-pipeline.md` says "Tool outputs are not persisted … no stubbing needed", which is true only across a reload. Each follow-up therefore re-bills the full windows as input, and a 12-step sweep (up to 1.2M chars) will exceed a 200k-token context on the next turn. The replay is traced; the context-overflow failure was not executed.

**Minimal fix.** Before `convertToModelMessages`, replace the `output` of `read_document` parts in all but the current turn with a short stub (document id, offsets, "re-read if needed"). A token budget over `contextMessages` (prior C4) would cover the general case.

### B4 — Context gap after a failed summarize fold (Medium, CONFIRMED)

**Scenario.** Chat has a summary covering messages 1–22. At message count 42 the next fold fails (Gemini outage: credits were out from 2026-10-16). The user keeps chatting.

**Evidence.** `route.ts:157-159` sends `summary + last 20` whenever `chat.summary` is non-null, without looking at `summaryUpToMessageId`. The client sets `lastSummarizedCountRef` before the call and never rolls it back or checks `res.ok` (`useChatPersistence.ts:142-144`, `useSummarization.ts:36-44`), so the next attempt is 10 messages later. At message 51 the tail is 32–51 and the summary still ends at 22: messages 23–31 are in neither layer. The gap grows by 10 per failed fold and nothing reports it. The comment at `useSummarization.ts:9-14` documents the invariant but only for the success path.

**Minimal fix.** Server side: count messages with `id > summaryUpToMessageId` and send `max(20, thatCount)` (bounded). Client side: only advance the gate on a 2xx.

### B5 — MMR discards the RRF fusion (Medium, CONFIRMED)

**Scenario.** Query "what does SW-101 show". The chunk containing "SW-101" is rank 1 in the keyword leg and rank 15 in the vector leg.

**Evidence.** `retrieval.ts:75` fuses, then `:80-82` runs `mmr()` over every candidate that has an embedding. `mmr()` scores by `similarity` (`mmr.ts:31`) and ignores `rrfScore`, so the fused order of all vector candidates is thrown away and only the top `docTopK * 2 = 6` by similarity/diversity go on to rerank. Keyword-only hits bypass MMR (`:81,84`). Probe:

```
RRF top5 [ 15, 1, 2, 99, 3 ]
MMR picked [ 1, 3, 5, 7, 2, 4 ] has15 false
```

Chunk 15 is top of the fused list and is dropped; chunk 99 (keyword only) survives. Being found by both legs is worse than being found by keyword alone.

**Minimal fix.** Feed MMR a relevance derived from the fused rank (normalised `rrfScore`), or exempt chunks present in the keyword list from MMR the same way keyword-only hits are.

### B6 — Regenerate silently truncates (Medium, CONFIRMED by reading)

**Scenario.** A 35 KB HTML artifact (the chat tool allows 32,000 output tokens and the guidance says "roughly under 40KB"). User clicks regenerate with "make the header blue".

**Evidence.** `regenerate/route.ts:50` calls `generateText({ …, maxOutputTokens: 8000 })` and destructures only `text` and `totalUsage`. `finishReason` is never read. For HTML, markdown and code the cut-off text is rendered and stored as the new current version (`:68-75`). Sheets usually fail the JSON parse and return 422. Not run against the API.

**Minimal fix.** Raise the cap to match the chat route, and return 422 without writing a version when `finishReason === 'length'`.

### B7 — Nested list items dropped (Medium, CONFIRMED)

**Evidence.** `parseMarkdown` maps each list item through `inlines(it.tokens)` (`markdown.ts:85`). A nested list is a `list` token inside the item; it has neither `.tokens` nor `.text`, so the default branch (`:42-50`) emits nothing. Probe:

```
input:  - parent A\n  - child A1\n  - child A2\n- parent B
output: [{"type":"list","ordered":false,"items":[[{"text":"parent A"}],[{"text":"parent B"}]]}]
input:  > quote line\n> - item in quote
output: [{"type":"paragraph","inlines":[{"text":"quote line"}]}]
```

Every DOCX, PDF and PPTX artifact loses sub-bullets with no warning. `mdToPlainText` (xlsx cells) has the same loss.

**Minimal fix.** Add a `level` to list items and recurse into nested `list` tokens (flattening with indentation is enough for all three renderers).

### B8 — Failed replace marks a healthy document as errored (Medium, CONFIRMED by reading)

**Scenario.** User replaces `plans.pdf` (ready, 300 chunks) with a corrupt file.

**Evidence.** In `process/route.ts` the failure exits at `:65` (no embedding provider), `:77` (download), `:117` (extraction) and `:164` (no text) all call `updateDocumentStatus(doc.id, 'error', …)` with no `isReplace` branch. Only the total-embed-failure exit (`:207-217`) restores `ready`; the existing test covers that one path only (`tests/unit/api/documents-process.test.ts:195`). After the failure the old chunks still serve retrieval, but the row is `error`, so the manifest and `read_document` wiring drop it (`chat/route.ts:173`) and the card shows an error. A throw after `:69` (prior X8) leaves `processing` until the 20-minute reaper flips it to `error` as well.

**Minimal fix.** On every replace failure exit, restore the pre-request status (`doc.status` is not usable because upload-url already set `uploading`; restore `ready` when `doc.chunkCount > 0`). Wrap the tail in try/catch for the same reason.

### B9 — Session messages are never deduplicated from semantic retrieval (Medium, CONFIRMED by trace)

**Evidence.** `retrieval.ts:37` builds `recentIds` from the client message ids and `:49` compares them with DB `messageId`. Messages sent in the live session carry `useChat` UUIDs (ids are DB integers only after a reload, `page.tsx:485`), and each of them is embedded right after it is saved (`page.tsx:972`, `useChatPersistence.ts:122`). The in-code comment says they are "safe only because they have no embedding yet"; that holds at most for the newest message. From the second turn on, the most similar candidates are earlier turns of this same conversation, which are already in the prompt, and up to 5 of them are injected again under "[Relevant context from previous conversations]". For a standalone chat the scope is the chat itself, so all semantic context is duplicate. The newest user message racing its own embedding into the result set is PLAUSIBLE (timing).

**Minimal fix.** Have the client send the DB id once `saveMessage` returns, or exclude candidates whose `content` equals a prompt message's text, or exclude by `chatId` when the chat's history is fully in the prompt.

### B10 — Embedding failure also kills the keyword leg (Medium, CONFIRMED by reading)

**Evidence.** `retrieval.ts:30` awaits `generateEmbedding(query)` outside both per-leg try blocks, so a throw goes to the outer catch (`:118-121`) and returns `{ null, null }`. `findChunksByKeyword` is pure Postgres and needs no embedding. With Gemini credits depleted (2026-10-16 onward) every project chat lost all retrieved document context, although the keyword leg could have served it. CLAUDE.md states that every stage degrades to the prior stage.

**Minimal fix.** Catch the embedding failure, skip the two vector queries, and still run the keyword leg.

### B11 — No timeouts or fast-fail on Gemini calls (Medium, PLAUSIBLE)

**Evidence.** No `abortSignal`, `AbortSignal.timeout` or `maxRetries` appears anywhere outside the chat route's `req.signal` (grep over `src`). Query rewrite, the query embedding and two reranks all run before the first token of a chat turn, each with the SDK default of 2 retries with backoff. A 429 quota error is retryable, so during the credits outage each project turn would spend several seconds per stage before degrading; a stalled connection has no bound short of `maxDuration = 300`. In ingestion, `embedWithRetry` adds 3 retries of its own on top of the SDK's (`embedChunks.ts:17-30`) with no circuit breaker, so a 1,000-chunk document under a full outage retries every chunk and can exceed `maxDuration = 800`, ending as "Processing timed out" from the reaper. Arithmetic only; not executed.

**Minimal fix.** `abortSignal: AbortSignal.timeout(…)` and `maxRetries: 0` on the best-effort chat-path calls; abort the embed pool after N consecutive failures.

### B12 — Seed degradation silently changes the model (Medium, CONFIRMED by trace and probe)

**Scenario.** The picker offers `claude-opus-5` (live catalog). `/v1/models` times out once (5 s limit).

**Evidence.** `buildRegistry` falls back to `STATIC_SEED` (`registry.ts:203-206`), which holds only Opus 4.8, Fable 5, Sonnet 5 and Haiku 4.5, and caches it for 60 s. `resolveRequestedModel('claude-opus-5')` misses `byId` and returns the fallback `claude-opus-4-8` (`:283-288`) with only a `console.warn`; the usage row records the fallback. In the same window `updateProjectDefaults` sees `usedFallback` and writes `defaultModel = null` (`actions.ts:401-403`). Probe (no-key variant of the same path): `DEFAULTS null` for `claude-opus-5`.

**Minimal fix.** Keep the last good live registry and serve it (stale) when a refresh fails; in `updateProjectDefaults`, do not null the value when `registry.source === 'seed'`.

### B13 — `/api/embed` hides failures and leaves no trail (Medium, CONFIRMED by reading)

**What it leaves behind.** On any failure the route returns HTTP 200 with `{ error }` (`embed/route.ts:63-65`); the client ignores the body. The message row exists with no `message_embeddings` row, and nothing marks it for retry: there is one attempt (plus SDK retries), no queue, no "missing embedding" query in the app and no backfill action. The message is permanently invisible to semantic retrieval. Everything written between 2026-10-16 and the top-up is in this state (count unmeasured, see handoff item 4). Related: `embedRequestSchema.content` has no upper bound and whole messages (up to 200k chars) are sent to `gemini-embedding-001`; whether that errors or truncates was not tested. The route also trusts the client's `projectId` instead of deriving it from the chat.

**Minimal fix.** Return a non-2xx on failure; add a server action that embeds messages lacking a `message_embeddings` row (the backfill the handoff already wants); cap the embedded text; derive `projectId` from `chats`.

### B14 — `generate_artifact` accepts mismatched type and content (Medium, CONFIRMED)

**Evidence.** The input schema only refines the `code` case (`tool.ts:22-34`). `renderArtifact` coerces a mismatch to empty (`render.ts:23-34`). Probe: `renderArtifact('xlsx', 't', '<markdown table string>')` returns a 6,041-byte empty workbook, and `renderArtifact('docx', 't', [sheet])` returns an empty document; both would be uploaded, versioned and reported to the model as success. The edit route already guards this exact case and calls it "silent data loss" (`edit/route.ts:30-39`). The trigger depends on the model sending the wrong shape. The regenerate route also passes unvalidated parsed JSON to `toXlsx`.

**Minimal fix.** Add the same shape check to the tool schema (`xlsx` ⇔ array, everything else ⇔ string) and return an in-band error.

### B15–B26 (Low)

- **B15.** `acceptSuggestion` never checks `status === 'pending'`. Probe: two accepts give memory `"GC is Acme Builders\nGC is Acme Builders"`; accepting a dismissed row appends it. Fix: `UPDATE … WHERE id = $1 AND status = 'pending' RETURNING`, append only if a row came back.
- **B16.** `saveChatTopics` is a plain insert against unique `(chat_id, topic)` and an integer `confidence`. Probe: `[coding 80, coding 60]` → duplicate key; `[analysis 85.5]` → `invalid input syntax for type integer`. The classify route returns 200 with an error, nothing is cached, and the next call bills the model again. Fix: dedupe, `Math.round`, `onConflictDoNothing`.
- **B17.** Probe: two separate ordered lists produce `numId` 2,2,2,2, so the second list continues the first's numbering. Code blocks are one `TextRun` containing `\n`, which Word renders as a single line. The ordered-list `start` value is also ignored in PDF/PPTX (a list resumed after a paragraph restarts at 1). Fix: a numbering `instance` per list; split code on `\n` into runs with `break`.
- **B18.** Probe: sheet names `Q1/Q2 Costs`, a duplicate, a case-only duplicate, and two names sharing their first 31 chars all throw in exceljs, so the tool returns "Failed to generate the artifact." The formula guard stores `'-`, `'-12.5`, `'+1 555` as literal text with no `quotePrefix` style, so the apostrophe is visible in Excel (visible-apostrophe rendering not checked in Excel itself). Fix: sanitise and uniquify sheet names; apply the guard only when the cell is not a plain number or lone dash, or set `quotePrefix`.
- **B19.** `normalizeAnthropicModel` prices by `raw.id`. Probe: `claude-haiku-4-5-20251001` resolves to the family tier with `estimated: true`, and an override keyed `claude-haiku-4-5` is ignored. Fix: look up exact pricing and overrides by the alias as well.
- **B20.** `generate_image` uploads to `attachments/<chatId>/generated/<uuid>` and relies on the client's `onFinish` to insert the row; Stop, a closed tab or a wrong-chat write leaves an object no sweep can find. `images/generate` uploads, then inserts, with no cleanup if the insert throws. The tool also ignores the abort signal. Fix: insert the row server-side in the tool; remove the object on insert failure.
- **B21.** `ingestText` can return `error` (all embeds failed) without an `errorMessage`; `updateDocumentStatus` cannot set `errorMessage` to null, so "Upload never completed" or "Processing timed out" stays on a row that later becomes `ready`.
- **B22.** No guard for empty `result.text` before `updateChatSummary` (PLAUSIBLE: needs a blocked or empty model reply).
- **B23.** `setSetting`/`setSettings` call `clearSettingsCache()` before the insert; the comment beside them explains exactly this race for the registry cache and fixes it there only. `getModelRegistry` can also store a build that started before `clearModelRegistryCache()`.
- **B24.** `signFilePath` returns `''` when no secret exists, and `verifyFilePathSig` rejects an empty signature once the gate is on. Signatures are non-expiring and derived from `AUTH_SECRET` (or the password), so turning the gate on later or rotating the secret breaks every image already embedded in stored HTML.
- **B25.** `upload-url` inserts the row and path, then signs; a signing failure leaves an `uploading` row until the 60-minute reaper marks it `error`. The replace 502 path sets `ready` unconditionally.
- **B26.** `'a{memory}b'.replace('{memory}', text)` interprets `$&`, `$'`, `` $` ``, `$$` in `text`. Fix: pass a function as the replacement.

## Prior findings re-verified

Source: `docs/audits/2026-09-01-codebase-audit.md` §2.2–2.4 and the two handoffs.

| Item | State | Evidence |
|---|---|---|
| C1 usage rows lost on abort | FIXED | `chat/route.ts:250` `abortSignal`, `:255` `onAbort`, `:294` `consumeStream()`, `:224` `after()`, first-wins guard `:213-221` |
| C2 Sonnet 5 intro price | FIXED | `pricing.ts:19` is `{3, 15}` |
| C3 alias canonicalisation | STILL OPEN | `registry.ts:283-285` still returns `requested`, not the matched catalog id |
| C4 conditional last-20 cap | STILL OPEN | `chat/route.ts:157-159` slices only when `chat.summary` is set; `contextWindow`/`maxOutput` unused (see also B3, B4) |
| C5 five unrecorded LLM sites | STILL OPEN | `recordUsage` has 6 callers; `suggest-followups`, `queryRewrite`, `rerank`, `image/generate`, `visionExtraction` have none |
| C6 `claude-3-x` family parse | STILL OPEN | `curate.ts:13` regex unchanged |
| C7 thinking sent unconditionally | STILL OPEN | `providers.ts:41`; `supportsThinking` never read |
| C8 `REGEN_MODEL` bypasses registry | STILL OPEN | `regenerate/route.ts:15` |
| C9 generic error for non-400 | STILL OPEN | `chat/route.ts:308-313` |
| Registry in-flight dedup | STILL OPEN | `registry.ts:241-249` |
| D1 FTS ANDs the whole question | STILL OPEN | `keywordSearch.ts:59-60` unchanged |
| D2 non-transactional `ingestText` | STILL OPEN | Probe: two concurrent calls → 12 chunk rows, `chunk_count` 6; no status guard in `/process`, no unique `(document_id, chunk_index)` |
| D3 `usage_events` indexes | FIXED | `schema.ts:258-259`, migration `0019` |
| D4 CHECK constraints | PARTLY FIXED | `usage_events` only (`0019`); `documents.status`, `messages.role` etc. still free text |
| D5 per-chunk `UPDATE … RETURNING` | STILL OPEN | `actions.ts:748-753` |
| D6 `saveMessage` awaits project touch | STILL OPEN | `actions.ts:210` |
| D10 `updated_at` not bumped | STILL OPEN | `updateProjectDefaults` `actions.ts:405-408`, `acceptSuggestion` `:1041-1046` |
| X1 hybrid page anchors | STILL OPEN | `process/route.ts:144` pushes text pages without anchors; `pageMap.ts:15-16`. Probe: 40-page doc, one vision run on p4 → first and last chunk both `{4,4}` |
| X2 segments held in RAM | STILL OPEN | `pdfSegments.ts:27-49,62-68` unchanged (not re-measured) |
| X3 no checkpointing within 800 s | STILL OPEN | no persistence between segments |
| X4 storage sweeps | STILL OPEN | `deleteProject` `actions.ts:73-75` sweeps nothing; `deleteChat` `:196-199` sweeps attachments only. B20 adds another orphan source |
| X5 PDF curly quotes | STILL OPEN | Code-point dump of `toPdf.ts:18-19`: classes hold U+0027, U+201A, U+2032 and U+0022, U+201E, U+2033 only. Probe: `winAnsi("don’t “quote”")` → `"dont quote"` |
| X6 current-revision `extracted.txt` not deleted | STILL OPEN | `documents/route.ts:45-48` lists the base path plus `rev<r>` for superseded revisions only |
| X7 abandoned replace bricks a doc | STILL OPEN | `upload-url/route.ts:35` sets `uploading` before any byte moves; B8 is the same family at the process step |
| X8 throw after `processing` | STILL OPEN | no catch around the tail; outer catch at `process/route.ts:248` does not reset status |
| X9 `failedPages` omits skipped/capped pages | STILL OPEN | `pdfSegments.ts:43-44` `onSkip()` carries no page number; docs still claim otherwise |
| X10 `addArtifactVersion` race | STILL OPEN | `actions.ts:892-896` read-then-write; no unique `(artifact_id, version)` |
| X11 window splits a page | STILL OPEN | `windowing.ts:40` cuts at a raw offset. Probe: window 1 ends mid-page 3, window 2 starts `aaaa\n# Page ` and reports `firstPage: 3`. Docs still say it cuts on anchors |
| X12 replace abort orphans `rev<N>` objects | STILL OPEN | `process/route.ts:207-217` |
| X13 retired palette in artifacts | STILL OPEN | `style.ts:4-14` still navy `1F3447` / steel blue `4F7396` |
| Handoff 3: PDF chat-attachment failure | STILL OPEN | `/api/extract` unchanged; fix is client-side plus routing through the signed-upload flow |
| Handoff 4: embedding gap | STILL OPEN | see B13; no backfill exists in code |
| Handoff 7: live Stop smoke | NOT VERIFIED | needs production |

Documentation that disagrees with the code: CLAUDE.md "State Management" says server state is SQLite and the Testing section says "in-memory SQLite" (it is Postgres/PGlite); the Context Pipeline lists "last 20 messages" as unconditional (C4); `rag-pipeline.md` says windows cut on page anchors (X11), that skipped oversize pages are recorded in `failedPages` (X9), and that tool outputs need no stubbing (B3); the comment at `retrieval.ts:31-36` is wrong (B9).

## Checked and clean

- **Schema vs migrations:** 22 journal entries; every FK's `ON DELETE` in `drizzle/*.sql` matches `schema.ts` (21 cascade, 3 set null).
- **Cost math:** `usageTokens`, `sumUsage`, `estimateCost` (fresh/cache split, non-finite guard); one row per turn in the chat route.
- **Pricing overrides:** per-entry validation; non-Anthropic models skip repricing.
- **Rollups:** `getMonthlyUsageByModel` clamp and UTC bucketing; `getChatCost` estimated filter.
- **Model resolution:** every server path goes through `resolveRequestedModel`/`byId` except `REGEN_MODEL` (C8); tier strings are resolved; the default is never the Gemini image model.
- **Replace commit:** `commitDocumentReplacement` is one transaction; embed happens before the destructive write.
- **Artifact writes:** create, edit and regenerate remove the uploaded object when the DB write fails; `createBlankArtifact` rolls back its host chat.
- **Attachments:** `saveMessageAttachments` cleans up partial uploads; `deleteChat`/`deleteMessage` sweep before the cascade.
- **Chunking:** `chunkText` offsets are consistent with content and always advance.
- **Keyword search:** all SQL is parameterised; identifier tokens cannot carry LIKE wildcards; the 2,000-char query cap holds.
- **RRF and rerank in isolation:** `rrfFuse` keeps the first list's payload; `rerankCandidates` dedupes indices and falls back on any parse failure.
- **`read_document`:** project scoping, exclusion list and in-band errors; web-ingested docs get `extracted.txt`.
- **Vision extraction:** absolute page numbers in the prompt; the hybrid splice keeps text for failed or skipped pages.
- **Storage wrapper:** batch signing, HTML forced to download, empty-input short-circuits.
- **Raw routes:** `/api/files/raw` allow-list plus signature; `/api/artifacts/[id]/raw` serves only PDFs inline.
- **Auth and throttle:** cookie verify is constant-time with signed expiry; throttle window logic is correct (known `x-real-ip` caveat unchanged).
- **AI SDK usage:** `maxOutputTokens`, `stopWhen`, `toUIMessageStreamResponse({ sendSources })` and image `responseModalities` match the gotcha list; assistant `file` parts are dropped by the Anthropic provider rather than erroring.
- **Static checks:** typecheck 0 errors; ESLint on server directories 0 errors.

## Probe files

- `C:\tmp\audit-2026-11-12\backend-scratch\vitest.config.mjs`
- `C:\tmp\audit-2026-11-12\backend-scratch\lib.probe.test.ts` (B5, B7, B14, B17, B18, B19, X1, X5, X11)
- `C:\tmp\audit-2026-11-12\backend-scratch\db.probe.test.ts` (B2, B12, B15, B16, D2)
- `C:\tmp\audit-2026-11-12\backend-scratch\sdk-probe.mjs` (B1)

Run the Vitest probes from PowerShell: `Set-Location 'C:\dev\atelier_ai_gpt'; npx vitest run --config C:\tmp\audit-2026-11-12\backend-scratch\vitest.config.mjs --disable-console-intercept`. Run the SDK probe with `node C:\tmp\audit-2026-11-12\backend-scratch\sdk-probe.mjs` from the repo directory.
