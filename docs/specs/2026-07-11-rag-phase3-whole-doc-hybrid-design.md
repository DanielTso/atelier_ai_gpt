# RAG Phase 3 — whole-document mode + hybrid keyword retrieval (design)

Date: 2026-07-11. Status: **approved design, pre-implementation.**
Brainstormed via `superpowers:brainstorming`; all decisions below were made with the user.

## Problem

Top-k chunk retrieval structurally cannot answer **set-wide questions** ("list every
storm sheet", "how many detail sheets reference the pump station") — no k covers a
question whose answer is spread across an entire plan set. Separately, pure vector
search whiffs on **tokenizer-hostile identifiers** ("SW-101", "E203"): embeddings place
them unpredictably, and the Drover failures showed vector returning plausible-but-wrong
chunks, not nothing. Both are live failures from real construction-PM usage.

## Scope (all five, one spec — user decision)

1. `read_document` tool — Claude-driven whole-document mode with windowed reads
2. Hybrid keyword retrieval — Postgres FTS + `pg_trgm`, RRF-fused with vector, always on
3. Failed-page tracking — record WHICH pages failed vision; actionable Partial badge
4. Chunk provenance tags — vision-derived chunk text is labeled as such
5. "Reading documents…" stage — tool-driven stage + optional retrieval-pass data part

## Locked decisions

| Decision | Choice | Rejected alternatives |
|---|---|---|
| Whole-doc trigger | **Claude decides via `read_document` tool** | Heuristic Flash router (per-message cost, invisible misclassification); user pin-toggle (manual, discovered after failure); auto-include small docs (doesn't fix large sets) |
| Oversize docs | **Windowed reads** (~100k chars/call + page map, Claude sweeps) | Page-index-first (new ingest work); hard truncate (reintroduces the failure) |
| Keyword fusion | **RRF, always on** (vector ∥ keyword → fuse → MMR → rerank) | Identifier-regex gating (permanent false-negative source); keyword-as-fallback (never fires — vector returns plausible wrongness, not emptiness) |
| Provenance | **Header tags on vision-derived text before chunking** | Merge text+vision per page (duplication, noise); document-level only (status quo) |
| Hybrid scope | **Document chunks only** — messages stay vector-only | Message-side hybrid (no observed failure case) |

## Design

### 1. `read_document` tool

New tool in `src/lib/documents/tool.ts` mirroring the `generate_artifact` pattern
(`src/lib/artifacts/tool.ts`), merged into the Claude tool set in `/api/chat` when the
chat's project has ≥1 `ready` document.

**Manifest.** In project chats with documents, the context pipeline injects a compact
document manifest: `id, filename, pageCount, charCount, extractionMethod,
extractionPartial`. One DB query, only when documents exist. This is how Claude knows
what it can read.

**Tool contract.**
```
read_document({ documentId, pageRange?: {from, to}, offset?: number })
→ {
    documentId, filename, totalPages,
    text,                      // one window, capped at READ_DOC_WINDOW_CHARS (default 100_000 ≈ 25k tokens)
    pagesCovered?: {from, to}, // when page anchors exist
    nextPage? | nextOffset?,   // continuation pointer; absent when done
    unavailablePages?: number[] // from failed_pages (section 3)
  }
```
- Source: `extracted.txt` from Storage (`documents/<projectId>/<docId>/[revN/]extracted.txt`
  — persisted since RAG Phase 1, per revision).
- Windowing: cut on `# Page <n>` heading anchors when present (vision/hybrid docs emit
  them with absolute page numbers — `segmentPrompt` in `src/lib/visionExtraction.ts`);
  fall back to character-offset windows for anchor-less text-path docs.
- Sweep budget: existing `stopWhen: stepCountIs(12)` — a 750k-char set is ~8 calls,
  fits. Raising the step cap is out of scope.
- `TOOL_GUIDANCE` addition: chunks-first for targeted questions; `read_document` for
  set-wide/exhaustive asks ("list every…", "summarize the whole…", counting) or when
  retrieved chunks are visibly insufficient. Chat-first principle unchanged.

**Persistence guard (important).** Tool outputs are NOT persisted verbatim: on save
(`useChatPersistence` onFinish path), `read_document` output parts are replaced with a
stub `{ documentId, filename, pagesCovered, charCount }`. Rationale: 100k-char results
would bloat `messages` rows, reload payloads, and poison `/api/summarize`. The
assistant's answer text carries the substance. Reload renders a compact "Read pages
1–40 of <file>" card.

**Failure modes.** Missing `extracted.txt` (docs ingested before Phase 1) → in-band
tool message "full text unavailable — re-upload the document to enable whole-document
reading"; never throws. Storage down → same graceful in-band error.

### 2. Hybrid keyword retrieval

**Migration** (`npx drizzle-kit generate`, custom SQL where needed):
- `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- `document_chunks.content_tsv tsvector` **generated column**:
  `GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` + GIN index.
- GIN trigram index on `document_chunks.content` (`gin_trgm_ops`).

**New `src/lib/keywordSearch.ts`.** `findChunksByKeyword(query, projectId, topN)`:
- FTS: `content_tsv @@ websearch_to_tsquery('english', query)` ranked by `ts_rank_cd`.
- Trigram: for identifier-ish tokens in the query (short alphanumerics with digits/
  hyphens), `content % token` similarity — catches `SW-101`/`E203` that both the FTS
  tokenizer and embeddings mangle.
- Union both, dedupe by chunk id, return top-N with ranks.

**Fusion in `src/lib/retrieval.ts`** (documents path only): run vector top-N and
keyword top-N concurrently; merge by Reciprocal Rank Fusion
(`score(chunk) = Σ_lists 1/(RRF_K + rank)`, RRF_K default 60); the fused top-N feeds the
existing MMR → rerank → top-k tail unchanged.

**Config** (`src/lib/ragConfig.ts`): `RAG_HYBRID_ENABLED` (default `true`),
`RAG_RRF_K` (default `60`), `RAG_KEYWORD_TOP_N` (default = `RAG_TOP_N`).
Keyword-path failure logs a warning and degrades to vector-only (house best-effort
style; same catch pattern as the existing document path).

### 3. Failed-page tracking

- Schema: `documents.failed_pages jsonb` (array of absolute page numbers, `null` when
  none). New migration (same one as section 2 or separate — implementer's choice).
- Writers: `extractViaVision` (a segment that fails after retries records
  `firstPage..lastPage`), oversize-page skips, and hybrid-splice run failures
  (`extractPagesViaVision`). Plumbed through `/api/documents/process` to the row.
- Readers: `GET /api/documents` returns `failedPages`; `DocumentCard`'s Partial badge
  tooltip becomes actionable — "Vision failed on pages 12–14, 30"; `read_document`
  surfaces the same list as `unavailablePages`.
- No backfill: existing docs gain it on re-upload (consistent with Phase 1/2 stance).

### 4. Chunk provenance tags

At ingest, vision-derived page runs get a single header line prepended to their text
**before** chunking — `[pages 12–14 · vision]` — the same pattern as web ingest's
`Source: <url>` header, so provenance lands inside chunk content and flows into
retrieval context for free. Applied in the process route where the hybrid splice / full
vision path already knows which runs were vision-extracted. Claude can hedge on
OCR-derived content. No schema change; no backfill.

### 5. "Reading documents…" stage

- (a) **Tool stage (ships for sure):** `src/lib/chatStage.ts` maps an active
  `read_document` tool part → new stage `reading-documents`; `ThinkingStatus` copy
  "Reading documents…". Identical mechanism to `generating-image`.
- (b) **Retrieval-pass data part (nice-to-have slice):** emit a transient `data-stage`
  UI-stream part before `streamText` while `retrieveContext` runs in project chats with
  documents, so the pre-stream RAG latency (rewrite + embed + rerank, ~1–2s) shows as
  "Reading documents…" instead of dead air. If the stream plumbing is awkward, (a)
  alone satisfies this phase.

## File layout

- `src/lib/documents/tool.ts` — new: `read_document` tool (schema, windowing, storage read)
- `src/lib/keywordSearch.ts` — new: FTS + trigram search
- `src/lib/retrieval.ts` — RRF fusion in the documents path
- `src/lib/ragConfig.ts` — 3 new knobs
- `src/lib/chatStage.ts` — `reading-documents` stage
- `src/lib/visionExtraction.ts` — failed-page reporting (return shape gains failed pages)
- `src/app/api/chat/route.ts` — tool wiring, manifest injection, TOOL_GUIDANCE, optional data-stage part
- `src/app/api/documents/process/route.ts` — failed_pages persistence, provenance headers
- `src/app/api/documents/route.ts` — failedPages in GET
- `src/components/chat/DocumentCard.tsx` — actionable Partial tooltip
- `src/hooks/useChatPersistence.ts` — read_document output stubbing on save
- `src/db/schema.ts` + `drizzle/00xx_*.sql` — pg_trgm, content_tsv + GIN, trigram index, failed_pages
- `tests/unit/lib/` — keywordSearch (PGlite + pg_trgm), RRF fusion, tool windowing; `tests/unit/api/` — process-route failed-pages, chat-route tool wiring

## Testing & verification gate

- Vitest: PGlite loads `pg_trgm` alongside `vector` in `tests/helpers/test-db.ts`
  (PGlite 0.4.x ships the extension). Unit tests: FTS ranking, trigram identifier
  match ("SW-101"), RRF fusion math, window cuts (anchors / offsets / caps / missing
  file), failed-page recording, persistence stubbing.
- Gate: `npm run typecheck` → `npm run lint` → `npm run build` → `npm test` (with
  `$env:TZ='America/Phoenix'`, `--no-file-parallelism`).
- Migration applied to Supabase via `DIRECT_URL=... npx drizzle-kit migrate`.
- Live acceptance test (prod, Drover docs): **"list every storm sheet"** answers
  completely; "what does note 7 on SW-101 say" hits via keyword path.

## Risks

- **Generated tsvector column on a big table**: backfill runs at migration time; chunk
  counts are modest (thousands, not millions) — acceptable. HNSW/GIN coexist fine.
- **Tool sweeps eating the step budget**: 12 steps caps a sweep at ~10 windows (~1M
  chars). Documented; raising `stopWhen` is a one-line follow-up if real sets exceed it.
- **PGlite pg_trgm availability**: verified available in the pinned 0.4.x line; if a
  regression appears, keywordSearch tests fall back to a mocked SQL layer (documented
  in the test helper).
- **websearch_to_tsquery on weird queries**: it never throws on arbitrary input (unlike
  `to_tsquery`) — that's why it's the chosen parser.
- **Manifest prompt bloat**: capped fields, one line per document; projects have tens
  of docs, not thousands.

## Non-goals

Message-side hybrid search; structure-aware chunking; embedding model changes;
backfill/auto-re-ingest of existing documents; raising the agentic step cap; Files
API/GCS input paths; any publish/sharing surface.

## Definition of done

All five slices implemented and unit-tested; verification gate green; migration applied
to Supabase; deployed to prod; live acceptance test passes on the Drover project;
CHANGELOG + session handoff updated.
