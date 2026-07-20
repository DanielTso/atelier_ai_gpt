# Grounded & Cited Answers — design spec

- **Date:** 2026-07-17
- **Status:** Designed under delegated authority (user: "I will let you do the heavy lifting and design"); brainstorm Q&A locked the UX decisions below. **Pending user spec review → plan → build.**
- **Target release:** v4.53.0 (after the untagged 4.52.0 dep slice)
- **Source:** NotebookLM feature-gap analysis (2026-07-17 session). The single biggest UX gap vs. NotebookLM: answers cite nothing, so users must trust retrieval blindly. For construction (claims, RFIs) a defensible answer IS the product.

## Goals

1. **Clickable citations**: document-derived claims in answers carry chips; clicking opens the document preview at the cited PDF page when known, else at the cited passage in the Extracted-text tab. (User-picked option: "Page when known, else text".)
2. **Grounded mode**: per-persona default + composer pill override — answers restricted to project documents, explicit "Not found in project documents" for gaps. (User-picked: "Persona default + pill override".)
3. **Per-chat source scoping**: checkbox per document in the Files rail; unchecked docs excluded from retrieval AND `read_document`. (User-picked: "Checkboxes in the Files rail".)
4. Citations survive reload, stream cleanly, and NEVER render as raw markers or point at wrong pages (validated, clamped, stripped).

## Non-goals

- @-mention composer scoping (noted follow-up).
- Post-hoc attribution/verifier pass (documented escalation, OFF — build only if compliance logging shows the prompt contract failing).
- Message-retrieval citations (past-chat context stays uncited; documents only).
- Backfill of page ranges for existing chunks (re-upload gains them; `failed_pages` precedent).
- Audio briefs, ingest digests, report presets (separate items from the same analysis).

## Architecture decision (approach + mitigations)

**Inline text markers** (chosen over structured stream parts and post-hoc attribution): Claude emits compact `[cite:…]` tokens inside its answer text. Rationale: assistant messages persist TEXT ONLY (`saveMessage`), so in-text markers survive reload with zero new persistence; they stream naturally; structured parts would require a new citations table + save/load plumbing; post-hoc attribution costs a model call per message.

Layered mitigations for the model-discipline weakness (locked with user):
1. **Copy-down, not recall** — every retrieved chunk carries its own citation header adjacent to its text; the model copies ids it can see, never recalls a manifest.
2. **Boring syntax + explicit contract** — one canonical ASCII form, positive AND negative examples in the guidance.
3. **Validate at the boundary** — markers referencing docs not in the project are stripped at render; pages clamped to the doc's `pageCount`; page missing/implausible → degrade chip to document level.
4. **Renderer resilience** — malformed tokens stripped, incomplete trailing `[cite:` hidden during streaming (shiki-debounce precedent).
5. **Floor** — a grounded answer with zero markers gets a soft "Answered from project documents" note under the message (ephemeral, live turn only).
6. **Measure before escalating** — server logs per-turn marker compliance (`[cite-compliance] chatId=… markers=N docCtx=Y grounded=Z`); the Gemini-Flash repair pass is built ONLY if data shows it's needed.

## Design by component

### C1 — Chunk page mapping (migration `0017`)

- `document_chunks` gains `page_start` int NULL, `page_end` int NULL (`drizzle-kit generate` from schema.ts).
- `src/lib/chunking.ts`: `chunkText` returns `{ index, content, start, end }` (char offsets into the source text). Offsets are exact — the chunker already slices by offset; expose them. Existing callers unaffected (extra fields).
- New `src/lib/pageMap.ts`: `buildPageMap(fullText): Array<{ page: number; start: number }>` parsing `# Page n` anchor offsets (the exact anchor regex `sliceWindow` already uses — extract/share it, do NOT duplicate); `pageRangeFor(map, start, end): { pageStart, pageEnd } | null` (null when map is empty — text-path docs).
- `src/lib/ingest.ts` (`ingestText`) + the process route replace path: compute the map once per doc, stamp each chunk row. Web-ingest markdown has no anchors → nulls (harmless).

### C2 — Source headers in retrieval context

- `src/lib/embeddings.ts` `findSimilarDocumentChunks` + `src/lib/keywordSearch.ts` `findChunksByKeyword`: also select `id` (chunk id), `documentId`, `pageStart`, `pageEnd` (keyword leg already selects ids; align both).
- `src/lib/retrieval.ts` (documents leg, currently `[From: ${filename}]`): emit
  `[Source: doc ${documentId} "${filename}"${pages ? ` p.${pageStart}${pageEnd !== pageStart ? `–${pageEnd}` : ''}` : ''} §c${chunkId}]\n${content}`
  Chunk anchor `§c<id>` is ALWAYS present (works for pre-0017 docs and text-path docs).
- `read_document` (`src/lib/documents/tool.ts`): tool result text gains a one-line header `Cite as [cite:<docId> p<N>] using the # Page N markers in this text; if no page markers, cite [cite:<docId>].`

### C3 — Citation guidance + grounded mode (chat route)

- Marker grammar (single canonical form):
  - `[cite:12 p34]` — doc 12, page 34. `[cite:12 p34-36]` — page range.
  - `[cite:12 c456]` — doc 12, chunk 456 (when the source header had no pages).
  - `[cite:12]` — document-level (last resort).
- `CITATION_GUIDANCE` (new, in the chat route next to `READ_DOCUMENT_GUIDANCE`): included whenever document context or the `read_document` tool is wired. Contract: cite every claim drawn from project documents, copy ids from the `[Source: …]` headers, place markers at the end of the sentence they support; NEVER invent citations, NEVER cite for general knowledge. One positive example, one negative example.
- `GROUNDED_GUIDANCE` (additional, only when grounded): answer EXCLUSIVELY from the provided document context and `read_document`; when the documents don't contain the answer, say `Not found in project documents` (verbatim phrase — the Contract Abstract convention, generalized) and optionally suggest which document might; do not fall back to general knowledge.
- Request body: `grounded: z.boolean().optional()` (default false) + `excludedDocumentIds: z.array(z.number().int().positive()).max(200).optional()` in `src/lib/validation.ts`.
- Compliance log line: `streamText`'s **server-side `onFinish`** callback (safe — this is NOT the `createUIMessageStream` wrapper trap from the 07-12 handoff; `streamText({ onFinish })` composes fine with `toUIMessageStreamResponse`) regex-counts markers in the final text and logs `[cite-compliance] chatId=… grounded=… docCtx=… markers=N`. Vercel logs are the dashboard; no new infra.

### C4 — Persona flag + composer pill

- `Persona` type gains `grounded?: boolean` (`src/hooks/usePersonas.ts`). Built-ins flipped on: **Contract Abstract**, **Contract & Spec Analyst**, **Plan & Spec Reader**. Custom personas get a "Grounded answers" toggle in the persona editor.
- Composer: a "Grounded" pill next to the effort pill (same visual pattern), reflecting persona default; clicking toggles for the chat. **User pick wins over persona/project defaults** — reuse the `composePersonaPickedRef` guard pattern from the v4.50 persona-precedence fix; a persona change resets the pill to the new persona's default unless user-overridden this compose.
- State rides the existing chat request body (page.tsx transport body refs), NOT persisted to the chats table — reload falls back to persona default (acceptable; note as SaaS-era column).

### C5 — Chip rendering (client)

- Marker regex: `/\[cite:(\d+)(?:\s+(?:p(\d+)(?:-(\d+))?|c(\d+)))?\]/g` — single source of truth in new `src/lib/citations.ts` (`parseCitation`, `stripUnverifiedCitations`, `hideIncompleteTrailingCite`).
- Rendering: a small **custom remark plugin** in the existing react-markdown pipeline (`MessagesList`) splits text nodes on the marker regex and emits a custom node rendered via the components map as `<CitationChip>` — same seam CodeBlock already uses. Chips show `filename · p.34` (filename resolved from the project documents list; doc id not in the list → strip the marker entirely).
- Streaming: the raw text may end mid-marker — `hideIncompleteTrailingCite` trims a trailing partial `[cite:…` before render (it reappears complete next frame).
- `CitationChip` click → `DocumentPreviewDialog` with new optional prop `target: { page?: number; chunkId?: number }`:
  - Page target: PDF iframe src gains `#page=N` (browser PDF viewers honor it; append to the existing signed-URL/iframe flow). Page clamped to `pageCount` client-side.
  - Chunk target: open the Extracted-text tab, fetch chunks (existing `getDocumentChunks`), scroll to + highlight the chunk's text block.
  - No target / clamp failure: dialog opens as today (document level).
- Zero-marker grounded floor: if the live turn was grounded, had doc context, and produced no markers, show a muted "Answered from project documents" caption under the message (client-side; uses the request's grounded flag + a response signal — if no clean signal exists, key off grounded flag alone; ephemeral, not persisted).

### C6 — Per-chat source scoping

- UI: checkbox on each ready document row in the Files rail (`ProjectContextRail`); header shows `n of m sources active`; default all-on.
- State: `useLocalStorage('chat-doc-scope-<chatId>')` storing EXCLUDED ids (empty = all on). Per chat, not per project. (DB column on `chats` = SaaS-era note.)
- Request: excluded ids ride the chat body → route filters:
  - `findSimilarDocumentChunks` + `findChunksByKeyword` gain optional `excludeDocumentIds` (SQL `NOT IN`, skipped when empty).
  - `[Project documents]` manifest filters them out.
  - `createReadDocumentTool` receives the exclusion list and returns an in-band tool error for excluded ids (defense in depth — the manifest already hides them).
- Excluding all docs = retrieval returns nothing; grounded mode then answers "Not found" (correct, explicit behavior).

## Error handling summary

| Failure | Behavior |
|---|---|
| Model cites a doc not in the project | Marker stripped at render (never a broken chip) |
| Cited page > pageCount / implausible | Chip degrades to document-level open |
| Malformed marker syntax | Stripped from display; raw text preserved in DB (harmless on future re-render improvements) |
| Marker split across stream frames | Trailing partial hidden until complete |
| Grounded + zero markers | "Answered from project documents" floor caption |
| Page map absent (text-path/old docs) | Headers carry `§c<id>` only → chunk-anchor chips |
| Scoping excludes everything | Empty context; grounded answers "Not found" |

## Verification gate + test plan (Vitest/PGlite unless noted)

Standard gate per task. Key tests: `buildPageMap`/`pageRangeFor` (anchors, empty, single-page); `chunkText` offset exactness; ingest stamps page ranges (PGlite, real migration 0017); retrieval header format incl. pageless `§c` form; validation schema (grounded, excludedDocumentIds bounds); route guidance presence/absence by flag (existing chat-route test idiom); `parseCitation`/`strip`/`hideIncompleteTrailingCite` (unit, exhaustive malformed cases); CitationChip render + strip-on-unknown-doc (jsdom); DocumentPreviewDialog page/chunk targets (jsdom); scoping SQL filters (PGlite); read_document exclusion error. E2E untouched (CI-only as usual).

## Migration & rollout

- `0017` (2 nullable int columns) — **migrate BEFORE deploy** (standing rule; deployed Drizzle emits explicit column lists — an unmigrated DB would break chunk inserts/selects app-wide).
- Old chunks: null pages → chunk-anchor citations until re-upload. No behavior change for chats with no documents. All features degrade to today's behavior when flags/markers are absent.

## Risks

| Risk | Mitigation |
|---|---|
| Marker compliance poor in practice | Layered mitigations above; compliance logging; escalation path spec'd but unbuilt |
| `#page=N` unsupported in some viewers | Chip still opens the right document; degrade silently (feature-detect not required) |
| Chunk-offset mapping drifts from stored `extracted.txt` | Both derive from the same `textContent` in the same request — single source; test locks it |
| Grounded pill state confusion vs persona default | Reuse the proven picked-wins ref pattern; pill always displays effective state |
| Context bloat from longer headers | ~30 chars/chunk over 3 chunks — negligible |

## Follow-ups captured (not this release)

- @-mention composer scoping; `grounded`/scope as DB columns (SaaS multi-device); Gemini-Flash citation repair pass (data-gated); ingest digests + starter questions; templated report presets; drive-time audio brief (own brainstorm); citation chips for message-retrieval context.
