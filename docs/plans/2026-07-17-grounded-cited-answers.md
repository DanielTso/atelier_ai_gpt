# Grounded & Cited Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answers cite their sources as clickable chips (PDF page or extracted-text passage), a Grounded mode restricts answers to project documents, and a per-chat Files-rail checkbox scopes which documents may answer.

**Architecture:** Inline `[cite:…]` text markers (survive text-only message persistence; stream naturally) + self-describing source headers on retrieved chunks (copy-down citing) + boundary validation (strip/clamp/degrade). Spec is the contract: `docs/specs/2026-07-17-grounded-cited-answers-design.md` — read it first; its §C1–C6 map to the tasks below.

**Tech Stack:** Drizzle migration 0017, Zod, AI SDK v6 `streamText` server `onFinish`, remark plugin in react-markdown, Vitest/PGlite + jsdom.

## Global Constraints

- Single-quote no-semicolon style; match each file. Never prettier.
- Gate per task: `npm run typecheck` (0) → `npm run lint` (0 errors, ≤26 warnings) → `npm run build` → `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`.
- One Conventional Commit per task; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Local only — push/migration/tag user-gated.
- Migration 0017 applies to prod BEFORE deploy (standing rule).
- Marker grammar (canonical, everywhere): `[cite:<docId>]` | `[cite:<docId> p<n>]` | `[cite:<docId> p<a>-<b>]` | `[cite:<docId> c<chunkId>]`. Regex single source of truth: `CITE_RE` in `src/lib/citations.ts`.
- Model tiers (subagent execution): T1,T3,T4,T5 = Fable; T2,T6 = Opus; T7–T10 = Sonnet with Fable review.

---

### Task 1: Migration 0017 — chunk page columns

**Files:** Modify `src/db/schema.ts` (documentChunks table); generate `drizzle/0017_*.sql`; Test `tests/unit/db/chunk-pages.test.ts` (new)

**Interfaces — Produces:** `documentChunks.pageStart: integer | null`, `documentChunks.pageEnd: integer | null` (columns `page_start`, `page_end`).

- [ ] Add to `documentChunks` in schema.ts after the `embedding` column: `pageStart: integer('page_start'), pageEnd: integer('page_end'),`
- [ ] Run `npx drizzle-kit generate` — verify the SQL contains EXACTLY two `ADD COLUMN` statements (`"page_start" integer`, `"page_end" integer`), nothing else. Hand-write if drift appears (Batch A precedent).
- [ ] RED→GREEN test (PGlite auto-applies migrations from `drizzle/`):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'
// mock @/db with getter per tests/unit/actions/* convention
describe('migration 0017', () => {
  beforeEach(async () => { await createTestDb() })
  it('document_chunks accepts and returns page_start/page_end (nullable)', async () => {
    // insert a project+document+chunk with pageStart 12 / pageEnd 14, and one with nulls;
    // select both back and assert values round-trip
  })
})
```

(Write the insert/select with the real drizzle tables — follow `tests/unit/actions/documents*.test.ts` fixtures.)
- [ ] Gate. Commit: `feat(db): document_chunks page_start/page_end (migration 0017)`

### Task 2: Page map + chunk offsets

**Files:** Create `src/lib/pageMap.ts`; Modify `src/lib/chunking.ts`, `src/lib/documents/windowing.ts` (export the anchor regex); Tests `tests/unit/lib/pageMap.test.ts` (new), extend `tests/unit/lib/chunking.test.ts`

**Interfaces — Produces:**
- `chunkText(text, maxSize?, overlap?): { index: number; content: string; start: number; end: number }[]` (offsets into `text`; existing callers unaffected).
- `PAGE_ANCHOR_RE` exported from `windowing.ts` (the existing `/^# Page (\d+)\s*$/gm` — rename export, keep local usage).
- `buildPageMap(fullText: string): { page: number; start: number }[]` (ascending by start; empty for anchor-less text).
- `pageRangeFor(map: {page:number;start:number}[], start: number, end: number): { pageStart: number; pageEnd: number } | null` (null when map empty; a chunk before the first anchor clamps to the first anchor's page).

- [ ] chunking.ts: track offsets — each pushed chunk records its `start` and `end` slice bounds (`{ index, content: text.slice(start, end), start, end }`; last chunk `end = text.length`; the `text.length <= maxSize` early return is `{ index: 0, content: text, start: 0, end: text.length }`).
- [ ] chunking test additions: for every chunk, `text.slice(c.start, c.end) === c.content` (exactness lock); overlap case asserts `chunks[1].start === chunks[0].end - overlap` modulo the clamp.
- [ ] pageMap.ts:

```ts
import { PAGE_ANCHOR_RE } from '@/lib/documents/windowing'

export function buildPageMap(fullText: string): { page: number; start: number }[] {
  const map: { page: number; start: number }[] = []
  for (const m of fullText.matchAll(PAGE_ANCHOR_RE)) {
    map.push({ page: Number(m[1]), start: m.index ?? 0 })
  }
  return map
}

export function pageRangeFor(
  map: { page: number; start: number }[], start: number, end: number,
): { pageStart: number; pageEnd: number } | null {
  if (map.length === 0) return null
  let pageStart = map[0].page
  let pageEnd = map[0].page
  for (const a of map) {
    if (a.start <= start) pageStart = a.page
    if (a.start < end) pageEnd = a.page
    else break
  }
  return { pageStart, pageEnd }
}
```

- [ ] pageMap tests: multi-anchor text (chunk inside page 2 → {2,2}; chunk spanning 2–3 → {2,3}); no anchors → null; chunk before first anchor → first page; anchor numbers non-contiguous (real vision docs: absolute page numbers).
- [ ] Gate. Commit: `feat(rag): chunk char offsets + page-anchor map`

### Task 3: Ingest stamps page ranges

**Files:** Modify `src/lib/ingest.ts`, `src/app/actions.ts` (`saveDocumentChunks` insert cols), `src/app/api/documents/process/route.ts` (replace-path `chunkRows`), `src/app/actions.ts` `commitDocumentReplacement` insert; Tests extend `tests/unit/lib/ingest.test.ts`, `tests/unit/api/documents-process.test.ts`

**Interfaces — Consumes:** T1 columns, T2 `buildPageMap`/`pageRangeFor` + offset-bearing `chunkText`. **Produces:** every chunk-row insert path carries `pageStart`/`pageEnd` (null when unmapped).

- [ ] `ingestText`: `const map = buildPageMap(text)`; each chunk row gains `...(pageRangeFor(map, c.start, c.end) ?? { pageStart: null, pageEnd: null })` (spread as `pageStart`/`pageEnd`).
- [ ] Replace path in process route: same mapping when building `chunkRows` (`const map = buildPageMap(textContent)` once).
- [ ] Thread the two fields through `saveDocumentChunks` and `commitDocumentReplacement` insert column lists.
- [ ] Tests: PGlite ingest of text containing `# Page 12`/`# Page 13` anchors → chunks selected back with correct ranges; anchor-less text → nulls; replace-path route test asserts `commitDocumentReplacement` received rows with page fields (extend the existing fidelity-threading test fixture with anchored text).
- [ ] Gate. Commit: `feat(rag): ingest + replace stamp chunk page ranges`

### Task 4: Retrieval source headers + exclusion filters

**Files:** Modify `src/lib/embeddings.ts` (`findSimilarDocumentChunks`), `src/lib/keywordSearch.ts` (`findChunksByKeyword`), `src/lib/retrieval.ts`; Tests extend `tests/unit/lib/retrieval.test.ts`, `tests/unit/lib/keywordSearch.test.ts` (or the files' existing homes — match current names)

**Interfaces — Produces:**
- Both finders gain optional final param `excludeDocumentIds?: number[]` (SQL `not(inArray(documentChunks.documentId, ids))` when non-empty) and select `pageStart`/`pageEnd`.
- `retrieveContext(...)` gains `excludeDocumentIds?: number[]` in its options and threads it to both finders.
- Document context line format (retrieval.ts, replacing `[From: ${filename}]`):

```ts
const pages = c.pageStart != null
  ? ` p.${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}` : ''
return `[Source: doc ${c.documentId} "${c.filename}"${pages} §c${c.chunkId}]\n${c.content}`
```

- [ ] Implement; keep both finders' candidate types aligned (`chunkId`, `documentId`, `filename`, `pageStart`, `pageEnd` present on both legs so RRF/MMR pass them through untouched).
- [ ] Tests: header renders with pages when present, without when null (always `§c`); exclusion filter drops the excluded doc's chunks in both finders (PGlite, two docs, exclude one); `retrieveContext` end-to-end respects exclusions (existing test idiom with mocked embed).
- [ ] Gate. Commit: `feat(rag): self-describing source headers + document exclusion filters`

### Task 5: Chat route — guidance, flags, manifest/tool scoping, compliance log

**Files:** Modify `src/lib/validation.ts`, `src/app/api/chat/route.ts`, `src/lib/documents/tool.ts`; Tests extend `tests/unit/api/chat-route.test.ts` (match existing chat-route test file name), `tests/unit/lib/read-document-tool.test.ts`

**Interfaces — Consumes:** T4 `retrieveContext` exclusions. **Produces:** request body fields `grounded?: boolean`, `excludedDocumentIds?: number[]`; `createReadDocumentTool(opts & { excludeDocumentIds?: number[] })`.

- [ ] validation.ts chat schema: `grounded: z.boolean().optional(), excludedDocumentIds: z.array(z.number().int().positive()).max(200).optional()`.
- [ ] Route constants (next to `READ_DOCUMENT_GUIDANCE`):

```ts
const CITATION_GUIDANCE =
  'CITATIONS: when a claim comes from project documents, end that sentence with a citation marker copied from the [Source: …] header of the chunk you used: ' +
  '[cite:12 p34] for doc 12 page 34, [cite:12 p34-36] for a page range, [cite:12 c456] when the header shows §c456 and no pages, [cite:12] as a last resort. ' +
  'Example: "Retainage is 10% until substantial completion [cite:12 p4]." ' +
  'Never invent citations, never cite documents not shown to you, and never add markers to general-knowledge statements.'

const GROUNDED_GUIDANCE =
  'GROUNDED MODE: answer EXCLUSIVELY from the provided project-document context and the read_document tool. ' +
  'If the documents do not contain the answer, reply "Not found in project documents" (optionally noting which document might cover it). ' +
  'Do not use general knowledge to fill gaps.'
```

- [ ] Wire: `CITATION_GUIDANCE` appended to the system prompt whenever document context was injected OR the read_document tool is wired; `GROUNDED_GUIDANCE` additionally when `grounded === true`. Manifest query filters `excludedDocumentIds`; `retrieveContext` receives them; `createReadDocumentTool` receives them and returns the in-band error `Document <id> is excluded from this chat's sources.` for excluded ids. Tool window header line per spec §C2.
- [ ] Compliance log in `streamText`'s `onFinish` (server): `console.log('[cite-compliance]', JSON.stringify({ chatId, grounded, docCtx: !!documentContext, markers: (text.match(/\[cite:\d+[^\]]*\]/g) ?? []).length }))`. (NOT the createUIMessageStream wrapper — plain `streamText({ onFinish })` option.)
- [ ] Tests: schema accepts/rejects shapes; route test asserts guidance strings present/absent by flag (existing prompt-assertion idiom); tool exclusion returns in-band error; manifest omits excluded docs.
- [ ] Gate. Commit: `feat(chat): citation contract, grounded mode, source-scoped context`

### Task 6: `src/lib/citations.ts` (pure client/server-safe lib)

**Files:** Create `src/lib/citations.ts`; Test `tests/unit/lib/citations.test.ts` (new)

**Interfaces — Produces:**

```ts
export const CITE_RE = /\[cite:(\d+)(?:\s+(?:p(\d+)(?:-(\d+))?|c(\d+)))?\]/g
export interface Citation { docId: number; page?: number; pageEnd?: number; chunkId?: number }
export function parseCitation(token: string): Citation | null
export function splitOnCitations(text: string): Array<{ type: 'text'; value: string } | { type: 'cite'; cite: Citation; raw: string }>
export function hideIncompleteTrailingCite(text: string): string  // trims a trailing partial '[cite:…' with no closing ]
```

- [ ] TDD the lot: all four grammar forms parse; garbage (`[cite:]`, `[cite:abc]`, `[cite:1 x9]`) → null / left as text by `splitOnCitations` only when unparseable → **strip decision lives in the renderer, so `splitOnCitations` returns unparseable tokens as plain text runs**; `hideIncompleteTrailingCite('…text [cite:12 p3') === '…text '` while complete markers and mid-text `[cite:` followed by `]` pass through; multiple markers per paragraph; marker adjacent to punctuation.
- [ ] Gate. Commit: `feat(lib): citation marker grammar + stream-safe splitter`

### Task 7: Chip rendering in messages

**Files:** Create `src/components/chat/CitationChip.tsx`, `src/lib/remarkCitations.ts`; Modify `src/components/chat/MessagesList.tsx` (markdown pipeline + grounded floor caption); Test `tests/hooks/CitationChip.test.tsx` (jsdom, new)

**Interfaces — Consumes:** T6 lib; the project documents list already passed into MessagesList's parent (page.tsx `documents` state — thread as a prop `documentsById: Map<number, { filename: string; pageCount: number | null }>`). **Produces:** `<CitationChip cite={Citation} doc={{filename,pageCount}} onOpen={(docId, target) => void}/>`; MessagesList prop `onOpenCitation(docId: number, target: { page?: number; chunkId?: number })`.

- [ ] `remarkCitations.ts`: remark plugin walking `text` nodes, applying `splitOnCitations`, emitting custom nodes (`type: 'citation'`, data.hName `citation-chip`, attributes docId/page/pageEnd/chunkId/raw); registered in MessagesList's existing react-markdown `remarkPlugins`, with a components-map entry mapping `citation-chip` to CitationChip. Follow the exact registration pattern the pipeline already uses for its plugins/components.
- [ ] Validation at render: docId not in `documentsById` → render the raw token as nothing (strip; return null). Page target clamped: `page = Math.min(cite.page, doc.pageCount ?? cite.page)`; if `cite.page` exists but doc.pageCount exists and page > pageCount → degrade to no-target open.
- [ ] Streaming safety: MessagesList applies `hideIncompleteTrailingCite` to the streaming message's text before markdown render (streaming messages only — persisted text untouched).
- [ ] Chip UI: compact inline chip `filename · p.34` / `filename` — semantic tokens (`bg-accent`, `text-muted-foreground`, hover `bg-primary/10` ring), superscript-ish sizing; title attr shows full form.
- [ ] Grounded floor: when the just-finished turn had `grounded` on and its text contains zero `CITE_RE` matches, render a muted caption `Answered from project documents` under the message (client state from the send path; ephemeral, not persisted).
- [ ] jsdom tests: renders chip for valid cite; strips unknown doc; clamps page; text runs preserved around chips.
- [ ] Gate. Commit: `feat(chat): citation chips in messages with validation + streaming safety`

### Task 8: Preview deep-links

**Files:** Modify `src/components/ui/DocumentPreviewDialog.tsx`; Test extend its jsdom test (or create `tests/hooks/DocumentPreviewDialog.test.tsx`)

**Interfaces — Consumes:** existing dialog props + `getDocumentChunks(documentId)` action. **Produces:** optional prop `target?: { page?: number; chunkId?: number }`.

- [ ] Page target: when `target.page` and the doc is a PDF, the preview iframe src becomes `${url}#page=${page}` (append fragment to the signed URL; re-render when target changes; clamp to `pageCount` when known).
- [ ] Chunk target: open on the Extracted-text tab; after chunks load, scroll the container to the element containing that chunk's text (render chunks with `data-chunk-id`; `el.scrollIntoView({ block: 'start' })`; brief highlight via a `bg-warm-sand` flash class). Missing chunk id → tab opens at top (silent degrade).
- [ ] Wire through: page.tsx passes `onOpenCitation` from MessagesList → sets preview target state → DocumentPreviewDialog. (Chat surface currently opens previews from the rail only — opening from a chip must work when the dialog was closed: set target + open together.)
- [ ] Tests: page fragment appears in iframe src; chunk target selects extracted-text tab.
- [ ] Gate. Commit: `feat(documents): preview deep-links to page or chunk`

### Task 9: Grounded pill + persona flag + scoping checkboxes

**Files:** Modify `src/hooks/usePersonas.ts` (Persona type + 3 built-ins + editor toggle in `src/components/settings/ModelDefaultsSettingsTab.tsx`), `src/components/chat/ChatInputArea.tsx` (pill), `src/app/page.tsx` (state + transport body), `src/components/chat/ProjectContextRail.tsx` (checkboxes); Tests extend `tests/hooks/usePersonas.test.ts` equivalents + a jsdom pill test

**Interfaces — Consumes:** T5 body fields. **Produces:** `Persona.grounded?: boolean`; page-level state `grounded: boolean`, `excludedDocIds: number[]` riding the chat transport body via refs (stale-closure rule #1).

- [ ] Persona type + `grounded: true` on `contract-abstract`, `contract-spec-analyst`, `plan-spec-reader`; custom-persona editor gains a "Grounded answers" switch.
- [ ] Pill in ChatInputArea next to the effort pill: label `Grounded`, filled when on; click toggles page-level state. Persona selection resets it to the persona's default UNLESS the user has toggled during this compose (a `groundedPickedRef` mirroring `composePersonaPickedRef` — same guard, same reset points).
- [ ] Scoping: each ready doc row in the rail's Files list gets a checkbox (checked = included). State `useLocalStorage<number[]>('chat-doc-scope-' + activeChatId, [])` storing EXCLUDED ids (chat-less compose = no checkboxes shown). Header line `${active} of ${total} sources active` when any excluded.
- [ ] Transport: `grounded` + `excludedDocumentIds` added to the chat request body via the existing body-refs pattern in page.tsx (rule: refs, not closures).
- [ ] Tests: persona defaults; pill override survives persona default reload (the v4.50 regression class); excluded ids reach the fetch body (hook/jsdom level, mirroring existing transport tests if present — else assert state wiring).
- [ ] Gate. Commit: `feat(chat): grounded pill, persona grounding defaults, per-chat source scoping`

### Task 10: Docs + wrap

**Files:** Modify `CHANGELOG.md` (4.53.0-Unreleased), `CLAUDE.md` (context-pipeline + personas + migration sections), `docs/PERSONAS.md` (Grounded section now shipped), `docs/specs/2026-07-17-grounded-cited-answers-design.md` (status), SDD ledger append; SESSION_HANDOFF update

- [ ] Write all; full gate one final time; Commit: `docs: grounded & cited answers - changelog, claude.md, personas`
- [ ] STOP: release checklist for user — apply migration 0017 to Supabase (`DIRECT_URL=… npx drizzle-kit migrate`) BEFORE push; then push; live smoke: grounded question on the Drover project → chips open pages; text-contract question → chunk-anchor chip → extracted-text jump.

## Self-review

- Spec coverage: C1→T1–3, C2→T4+T5(tool header), C3→T5, C4→T9, C5→T6–8, C6→T5+T9. Mitigation layers: 1–2→T4/T5, 3→T7, 4→T6/T7, 5→T7, 6→T5. Error table rows all land in T5–T8 tests. ✓
- No placeholders: code given for every novel mechanism; "match existing idiom" references point at named files that exist. ✓
- Type consistency: `Citation`, `pageStart/pageEnd`, `excludeDocumentIds` (lib param) vs `excludedDocumentIds` (wire field) — intentional and consistent per layer. ✓
