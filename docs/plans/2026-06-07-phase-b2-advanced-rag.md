# Phase B2 — Advanced RAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Frame implementers by role (Backend / QA / Reviewer / Docs) per the saved agent-stack reference. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a multi-stage retrieval pipeline (query-rewrite → vector top-N → MMR diversity → LLM rerank → top-k) on top of pgvector, with tunable config and graceful fallback, plus a shared-PGlite test speedup.

**Architecture:** Four new bounded modules (`ragConfig`, `mmr`, `queryRewrite`, `rerank`) + a `retrieval.ts` orchestrator that the chat route calls. LLM stages use in-stack Gemini Flash via the proven `generateText`+parse pattern (same as the `classify` route). Every stage is best-effort and falls back to the prior stage's output, so the pipeline can never do worse than plain vector search.

**Tech Stack:** Next.js 16, Drizzle/pgvector, AI SDK v6 (`generateText`, `@ai-sdk/google`), Vitest, PGlite.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/ragConfig.ts` (new) | Tunable RAG settings (thresholds, top-N/K, λ, toggles) from env + defaults |
| `src/lib/mmr.ts` (new) | Pure-JS Maximal Marginal Relevance over candidate embeddings |
| `src/lib/queryRewrite.ts` (new) | Conversation → standalone query (Gemini Flash; fallback to last user text) |
| `src/lib/rerank.ts` (new) | LLM relevance reorder (Gemini Flash; fallback to input order) |
| `src/lib/embeddings.ts` (modify) | Return each candidate's `embedding` (for MMR); threshold/topN unchanged signatures |
| `src/lib/retrieval.ts` (new) | Orchestrate the pipeline; return `{ semanticContext, documentContext }` |
| `src/app/api/chat/route.ts` (modify) | Replace the inline retrieval block with one `retrieveContext()` call |
| `tests/helpers/test-db.ts` (modify) | Shared PGlite + TRUNCATE per test (speedup) |
| `CLAUDE.md`, `CHANGELOG.md`, chatlog | Docs |

---

## Task 1: ragConfig (Backend)

**Files:** Create `src/lib/ragConfig.ts`, `tests/unit/lib/ragConfig.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/ragConfig.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { getRagConfig } from '@/lib/ragConfig'

const KEYS = ['RAG_DOC_THRESHOLD','RAG_MSG_THRESHOLD','RAG_TOP_N','RAG_DOC_TOP_K','RAG_MSG_TOP_K','RAG_MMR_LAMBDA','RAG_REWRITE_ENABLED','RAG_RERANK_ENABLED','RAG_MMR_ENABLED']

describe('getRagConfig', () => {
  afterEach(() => { for (const k of KEYS) delete process.env[k] })

  it('returns sane defaults with no env', () => {
    const c = getRagConfig()
    expect(c.docThreshold).toBe(0.5)
    expect(c.msgThreshold).toBe(0.7)
    expect(c.topN).toBe(20)
    expect(c.docTopK).toBe(3)
    expect(c.msgTopK).toBe(5)
    expect(c.mmrLambda).toBe(0.7)
    expect(c.rewriteEnabled).toBe(true)
    expect(c.rerankEnabled).toBe(true)
    expect(c.mmrEnabled).toBe(true)
  })

  it('applies numeric + boolean env overrides', () => {
    process.env.RAG_TOP_N = '40'
    process.env.RAG_DOC_THRESHOLD = '0.6'
    process.env.RAG_RERANK_ENABLED = 'false'
    const c = getRagConfig()
    expect(c.topN).toBe(40)
    expect(c.docThreshold).toBe(0.6)
    expect(c.rerankEnabled).toBe(false)
  })

  it('ignores non-numeric env and keeps the default', () => {
    process.env.RAG_TOP_N = 'banana'
    expect(getRagConfig().topN).toBe(20)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`getRagConfig` undefined)

Run: `npx vitest run tests/unit/lib/ragConfig.test.ts`

- [ ] **Step 3: Implement** — `src/lib/ragConfig.ts`

```ts
export interface RagConfig {
  docThreshold: number
  msgThreshold: number
  topN: number
  docTopK: number
  msgTopK: number
  mmrLambda: number
  rewriteEnabled: boolean
  rerankEnabled: boolean
  mmrEnabled: boolean
}

function num(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  return value === 'true' || value === '1'
}

/** Tunable RAG knobs — env overrides with sane defaults. */
export function getRagConfig(): RagConfig {
  return {
    docThreshold: num(process.env.RAG_DOC_THRESHOLD, 0.5),
    msgThreshold: num(process.env.RAG_MSG_THRESHOLD, 0.7),
    topN: num(process.env.RAG_TOP_N, 20),
    docTopK: num(process.env.RAG_DOC_TOP_K, 3),
    msgTopK: num(process.env.RAG_MSG_TOP_K, 5),
    mmrLambda: num(process.env.RAG_MMR_LAMBDA, 0.7),
    rewriteEnabled: bool(process.env.RAG_REWRITE_ENABLED, true),
    rerankEnabled: bool(process.env.RAG_RERANK_ENABLED, true),
    mmrEnabled: bool(process.env.RAG_MMR_ENABLED, true),
  }
}
```

- [ ] **Step 4: Run it — expect PASS** (`npx vitest run tests/unit/lib/ragConfig.test.ts`)
- [ ] **Step 5: Commit**

```bash
git add src/lib/ragConfig.ts tests/unit/lib/ragConfig.test.ts
git commit -m "feat(phase-b2): tunable RAG config (env + defaults)"
```

---

## Task 2: MMR (Backend) — pure function

**Files:** Create `src/lib/mmr.ts`, `tests/unit/lib/mmr.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/mmr.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mmr } from '@/lib/mmr'

// helper: 3-dim vectors are enough to exercise cosine
const item = (id: string, embedding: number[], similarity: number) => ({ id, embedding, similarity })

describe('mmr', () => {
  it('drops a near-duplicate in favour of a diverse-but-relevant item', () => {
    const a = item('a', [1, 0, 0], 0.95)
    const aDup = item('aDup', [0.99, 0.01, 0], 0.94) // almost identical to a
    const b = item('b', [0, 1, 0], 0.80)             // diverse, still relevant
    const picked = mmr([a, aDup, b], 2, 0.7).map(x => x.id)
    expect(picked[0]).toBe('a')        // most relevant first
    expect(picked).toContain('b')      // diversity beats the near-duplicate
    expect(picked).not.toContain('aDup')
  })

  it('returns at most topK and preserves items when all distinct', () => {
    const items = [item('a', [1,0,0], 0.9), item('b', [0,1,0], 0.8), item('c', [0,0,1], 0.7)]
    expect(mmr(items, 2, 0.7)).toHaveLength(2)
    expect(mmr(items, 10, 0.7)).toHaveLength(3)
  })

  it('handles empty input', () => {
    expect(mmr([], 3, 0.7)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run tests/unit/lib/mmr.test.ts`)

- [ ] **Step 3: Implement** — `src/lib/mmr.ts`

```ts
export interface MmrItem {
  embedding: number[]
  similarity: number // base relevance to the query (e.g. vector cosine similarity)
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]
  return s
}
function cosine(a: number[], b: number[]): number {
  const denom = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b))
  return denom === 0 ? 0 : dot(a, b) / denom
}

/**
 * Maximal Marginal Relevance: greedily pick items that are relevant to the query
 * (high `similarity`) while penalising similarity to already-picked items.
 * lambda=1 → pure relevance; lambda=0 → pure diversity.
 */
export function mmr<T extends MmrItem>(candidates: T[], topK: number, lambda: number): T[] {
  const selected: T[] = []
  const pool = [...candidates]
  while (selected.length < topK && pool.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const maxSimToSelected = selected.length === 0
        ? 0
        : Math.max(...selected.map(s => cosine(pool[i].embedding, s.embedding)))
      const score = lambda * pool[i].similarity - (1 - lambda) * maxSimToSelected
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    selected.push(pool[bestIdx])
    pool.splice(bestIdx, 1)
  }
  return selected
}
```

- [ ] **Step 4: Run it — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/mmr.ts tests/unit/lib/mmr.test.ts
git commit -m "feat(phase-b2): MMR diversity selection"
```

---

## Task 3: queryRewrite (Backend)

**Files:** Create `src/lib/queryRewrite.ts`, `tests/unit/lib/queryRewrite.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/queryRewrite.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
function setup() {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
}

const turns = [
  { role: 'user', text: 'Tell me about the foundation spec' },
  { role: 'assistant', text: 'It uses 4000 psi concrete.' },
  { role: 'user', text: 'what about the second one?' },
]

describe('rewriteQuery', () => {
  beforeEach(() => { mockGenerateText.mockReset() })

  it('returns the model-rewritten standalone query', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    mockGenerateText.mockResolvedValue({ text: 'second foundation specification details' })
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    expect(await rewriteQuery(turns)).toBe('second foundation specification details')
  })

  it('falls back to the last user message when no API key', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(null) }))
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    expect(await rewriteQuery(turns)).toBe('what about the second one?')
  })

  it('falls back to the last user message on model error', async () => {
    setup()
    vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve('k') }))
    mockGenerateText.mockRejectedValue(new Error('boom'))
    const { rewriteQuery } = await import('@/lib/queryRewrite')
    expect(await rewriteQuery(turns)).toBe('what about the second one?')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement** — `src/lib/queryRewrite.ts`

```ts
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'

const REWRITE_MODEL = 'gemini-3.5-flash'
const REWRITE_PROMPT =
  "Rewrite the user's latest message into a single, self-contained search query for retrieving relevant documents and past messages. Resolve pronouns and references using the conversation. Return ONLY the query text — no quotes, no explanation."

export interface Turn { role: string; text: string }

/** Conversation → standalone retrieval query. Falls back to the last user message. */
export async function rewriteQuery(turns: Turn[]): Promise<string> {
  const lastUserText = [...turns].reverse().find(t => t.role === 'user')?.text ?? ''
  try {
    const apiKey = await getGeminiApiKey()
    if (!apiKey) return lastUserText
    const recent = turns.slice(-6).map(t => `${t.role}: ${t.text}`).join('\n')
    const google = createGoogleGenerativeAI({ apiKey })
    const { text } = await generateText({
      model: google(REWRITE_MODEL),
      messages: [
        { role: 'system', content: REWRITE_PROMPT },
        { role: 'user', content: recent },
      ],
      maxOutputTokens: 100,
    })
    return text.trim() || lastUserText
  } catch {
    return lastUserText
  }
}
```

- [ ] **Step 4: Run it — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/queryRewrite.ts tests/unit/lib/queryRewrite.test.ts
git commit -m "feat(phase-b2): conversational query rewriting"
```

---

## Task 4: rerank (Backend)

**Files:** Create `src/lib/rerank.ts`, `tests/unit/lib/rerank.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/rerank.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
function setup(key: string | null = 'k') {
  vi.resetModules()
  vi.doMock('ai', () => ({ generateText: (...a: unknown[]) => mockGenerateText(...a) }))
  vi.doMock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))
  vi.doMock('@/lib/settings', () => ({ getGeminiApiKey: () => Promise.resolve(key) }))
}

const cands = [
  { content: 'irrelevant chunk' },
  { content: 'the answer is here' },
  { content: 'somewhat related' },
]

describe('rerankCandidates', () => {
  beforeEach(() => mockGenerateText.mockReset())

  it('reorders by model score and respects topK', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: '[{"index":1,"score":95},{"index":2,"score":60},{"index":0,"score":10}]' })
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 2)
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe('the answer is here')
    expect(out[1].content).toBe('somewhat related')
  })

  it('falls back to input order on unparseable output', async () => {
    setup()
    mockGenerateText.mockResolvedValue({ text: 'no json here' })
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 2)
    expect(out.map(c => c.content)).toEqual(['irrelevant chunk', 'the answer is here'])
  })

  it('falls back to input order with no API key', async () => {
    setup(null)
    const { rerankCandidates } = await import('@/lib/rerank')
    const out = await rerankCandidates('q', cands, 3)
    expect(out).toEqual(cands)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement** — `src/lib/rerank.ts`

```ts
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'

const RERANK_MODEL = 'gemini-3.5-flash'

/**
 * Re-score candidates for relevance to the query with an LLM and return the
 * top-K reordered. Best-effort: any failure / missing key / unparseable output
 * falls back to the original order (sliced to topK).
 */
export async function rerankCandidates<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
): Promise<T[]> {
  if (candidates.length <= 1) return candidates.slice(0, topK)
  try {
    const apiKey = await getGeminiApiKey()
    if (!apiKey) return candidates.slice(0, topK)
    const list = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 500)}`).join('\n\n')
    const prompt =
      `Query: ${query}\n\nCandidates:\n${list}\n\n` +
      `Return ONLY a JSON array of {"index": <candidate number>, "score": <0-100 relevance>} ` +
      `for the candidates, sorted most-relevant first.`
    const google = createGoogleGenerativeAI({ apiKey })
    const { text } = await generateText({ model: google(RERANK_MODEL), prompt, maxOutputTokens: 500 })
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return candidates.slice(0, topK)
    const scored = JSON.parse(match[0]) as { index: number; score: number }[]
    const ordered = scored
      .filter(s => Number.isInteger(s.index) && s.index >= 0 && s.index < candidates.length)
      .sort((a, b) => b.score - a.score)
      .map(s => candidates[s.index])
    const seen = new Set(ordered)
    const result = [...ordered, ...candidates.filter(c => !seen.has(c))] // append any omitted
    return result.slice(0, topK)
  } catch {
    return candidates.slice(0, topK)
  }
}
```

- [ ] **Step 4: Run it — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/rerank.ts tests/unit/lib/rerank.test.ts
git commit -m "feat(phase-b2): LLM reranking with graceful fallback"
```

---

## Task 5: embeddings returns candidate vectors (Backend)

**Files:** Modify `src/lib/embeddings.ts`

MMR needs each candidate's embedding. Add `embedding` to both selects + return types. Signatures (topK/threshold) stay the same — the orchestrator passes `topN` as the limit.

- [ ] **Step 1: Edit `findSimilarMessages`** return type + select. Change the return type to include `embedding: number[]`, and add `embedding: messageEmbeddings.embedding` to the `.select({...})`:

```ts
export async function findSimilarMessages(
  queryEmbedding: number[],
  scope: { chatId?: number; projectId?: number },
  topK: number = 5,
  threshold: number = 0.7
): Promise<{ content: string; similarity: number; chatId: number; messageId: number; embedding: number[] }[]> {
  const similarity = sql<number>`1 - (${cosineDistance(messageEmbeddings.embedding, queryEmbedding)})`
  const scopeFilter = scope.projectId
    ? eq(messageEmbeddings.projectId, scope.projectId)
    : scope.chatId
      ? eq(messageEmbeddings.chatId, scope.chatId)
      : undefined
  return db.select({
    content: messageEmbeddings.content,
    similarity,
    chatId: messageEmbeddings.chatId,
    messageId: messageEmbeddings.messageId,
    embedding: messageEmbeddings.embedding,
  }).from(messageEmbeddings)
    .where(scopeFilter ? and(scopeFilter, gt(similarity, threshold)) : gt(similarity, threshold))
    .orderBy(desc(similarity))
    .limit(topK)
}
```

- [ ] **Step 2: Edit `findSimilarDocumentChunks`** similarly — add `embedding: documentChunks.embedding` to the select and `embedding: number[]` to the return type. (documentChunks.embedding is nullable in the schema, but rows returned by this query always have a non-null embedding because `1 - (NULL <=> q)` is NULL and fails the `gt` filter; cast is safe. If TypeScript complains about `number[] | null`, add `embedding: documentChunks.embedding` and change the return type to `embedding: number[] | null` — the MMR caller tolerates it since these rows are always non-null.) Use return type `embedding: number[] | null` to satisfy the compiler:

```ts
export async function findSimilarDocumentChunks(
  queryEmbedding: number[],
  projectId: number,
  topK: number = 3,
  threshold: number = 0.5
): Promise<{ content: string; similarity: number; chunkId: number; documentId: number; filename: string; embedding: number[] | null }[]> {
  const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, queryEmbedding)})`
  return db.select({
    content: documentChunks.content,
    similarity,
    chunkId: documentChunks.id,
    documentId: documentChunks.documentId,
    filename: documents.filename,
    embedding: documentChunks.embedding,
  }).from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(and(eq(documentChunks.projectId, projectId), gt(similarity, threshold)))
    .orderBy(desc(similarity))
    .limit(topK)
}
```

- [ ] **Step 3: Verify existing vector test + typecheck**

Run: `npx vitest run tests/unit/db/vector-search.test.ts && npx tsc --noEmit 2>&1 | grep -E "embeddings.ts|retrieval" || echo "no embeddings.ts type errors"`
Expected: vector test still 2/2 (the extra `embedding` field doesn't break the content/filename assertions); no new type errors in `embeddings.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/embeddings.ts
git commit -m "feat(phase-b2): return candidate embeddings for MMR"
```

---

## Task 6: retrieval orchestrator + chat-route wiring (Backend)

**Files:** Create `src/lib/retrieval.ts`, `tests/unit/lib/retrieval.test.ts`; modify `src/app/api/chat/route.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/retrieval.test.ts` (mocks the sub-modules to assert orchestration + fallback)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  generateEmbedding: vi.fn(),
  findSimilarMessages: vi.fn(),
  findSimilarDocumentChunks: vi.fn(),
  rewriteQuery: vi.fn(),
  rerankCandidates: vi.fn(),
}
function setup(cfgOverrides: Record<string, unknown> = {}) {
  vi.resetModules()
  vi.doMock('@/lib/embeddings', () => ({
    generateEmbedding: (...a: unknown[]) => m.generateEmbedding(...a),
    findSimilarMessages: (...a: unknown[]) => m.findSimilarMessages(...a),
    findSimilarDocumentChunks: (...a: unknown[]) => m.findSimilarDocumentChunks(...a),
  }))
  vi.doMock('@/lib/queryRewrite', () => ({ rewriteQuery: (...a: unknown[]) => m.rewriteQuery(...a) }))
  vi.doMock('@/lib/rerank', () => ({ rerankCandidates: (...a: unknown[]) => m.rerankCandidates(...a) }))
  vi.doMock('@/lib/ragConfig', () => ({ getRagConfig: () => ({
    docThreshold: 0.5, msgThreshold: 0.7, topN: 20, docTopK: 3, msgTopK: 5, mmrLambda: 0.7,
    rewriteEnabled: true, rerankEnabled: true, mmrEnabled: true, ...cfgOverrides,
  }) }))
}

const msgs = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'foundation spec?' }] }]

describe('retrieveContext', () => {
  beforeEach(() => { for (const f of Object.values(m)) f.mockReset() })

  it('runs rewrite → retrieve → rerank and builds document context', async () => {
    setup()
    m.rewriteQuery.mockResolvedValue('standalone foundation query')
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([
      { content: 'foundation: 4000psi', similarity: 0.9, chunkId: 1, documentId: 1, filename: 'spec.pdf', embedding: [1,0,0] },
    ])
    m.rerankCandidates.mockImplementation((_q, c) => Promise.resolve(c))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.rewriteQuery).toHaveBeenCalled()
    expect(m.generateEmbedding).toHaveBeenCalledWith('standalone foundation query', 'query')
    expect(out.documentContext).toContain('spec.pdf')
    expect(out.documentContext).toContain('4000psi')
  })

  it('still returns (no throw) when embedding generation fails', async () => {
    setup()
    m.rewriteQuery.mockResolvedValue('q')
    m.generateEmbedding.mockRejectedValue(new Error('no embeddings'))
    const { retrieveContext } = await import('@/lib/retrieval')
    const out = await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(out).toEqual({ semanticContext: null, documentContext: null })
  })

  it('skips rewrite when disabled (uses last user text)', async () => {
    setup({ rewriteEnabled: false })
    m.generateEmbedding.mockResolvedValue([1, 0, 0])
    m.findSimilarMessages.mockResolvedValue([])
    m.findSimilarDocumentChunks.mockResolvedValue([])
    const { retrieveContext } = await import('@/lib/retrieval')
    await retrieveContext(msgs as never, { chatId: 1, projectId: 7 })
    expect(m.rewriteQuery).not.toHaveBeenCalled()
    expect(m.generateEmbedding).toHaveBeenCalledWith('foundation spec?', 'query')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement** — `src/lib/retrieval.ts`

```ts
import type { UIMessage } from 'ai'
import { generateEmbedding, findSimilarMessages, findSimilarDocumentChunks } from './embeddings'
import { rewriteQuery, type Turn } from './queryRewrite'
import { rerankCandidates } from './rerank'
import { mmr, type MmrItem } from './mmr'
import { getRagConfig } from './ragConfig'

function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p: { type: string }): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p: { text: string }) => p.text)
    .join('')
}

export async function retrieveContext(
  messages: UIMessage[],
  scope: { chatId: number; projectId: number | null },
): Promise<{ semanticContext: string | null; documentContext: string | null }> {
  const empty = { semanticContext: null as string | null, documentContext: null as string | null }
  try {
    const cfg = getRagConfig()
    const turns: Turn[] = messages.map(msg => ({ role: msg.role, text: textOf(msg) })).filter(t => t.text)
    const lastUserText = [...turns].reverse().find(t => t.role === 'user')?.text ?? ''
    if (!lastUserText) return empty

    const query = cfg.rewriteEnabled ? await rewriteQuery(turns) : lastUserText
    const queryEmbedding = await generateEmbedding(query, 'query')
    const recentIds = new Set(messages.map(msg => String(msg.id)))

    // Messages
    let semanticContext: string | null = null
    let msgCands = (await findSimilarMessages(
      queryEmbedding,
      { projectId: scope.projectId ?? undefined, chatId: !scope.projectId ? scope.chatId : undefined },
      cfg.topN, cfg.msgThreshold,
    )).filter(c => !recentIds.has(String(c.messageId)))
    if (cfg.mmrEnabled) msgCands = mmr(msgCands as (typeof msgCands[number] & MmrItem)[], cfg.msgTopK * 2, cfg.mmrLambda)
    const msgFinal = cfg.rerankEnabled ? await rerankCandidates(query, msgCands, cfg.msgTopK) : msgCands.slice(0, cfg.msgTopK)
    if (msgFinal.length > 0) semanticContext = msgFinal.map(s => s.content).join('\n---\n')

    // Documents (project-scoped)
    let documentContext: string | null = null
    if (scope.projectId) {
      try {
        let docCands = await findSimilarDocumentChunks(queryEmbedding, scope.projectId, cfg.topN, cfg.docThreshold)
        if (cfg.mmrEnabled) {
          docCands = mmr(
            docCands.filter(c => c.embedding != null) as (typeof docCands[number] & MmrItem)[],
            cfg.docTopK * 2, cfg.mmrLambda,
          )
        }
        const docFinal = cfg.rerankEnabled ? await rerankCandidates(query, docCands, cfg.docTopK) : docCands.slice(0, cfg.docTopK)
        if (docFinal.length > 0) {
          documentContext = docFinal.map(c => `[From: ${c.filename}]\n${c.content}`).join('\n---\n')
        }
      } catch {
        // Document retrieval is best-effort
      }
    }
    return { semanticContext, documentContext }
  } catch {
    return empty
  }
}
```

- [ ] **Step 4: Run it — expect PASS** (`npx vitest run tests/unit/lib/retrieval.test.ts`)

- [ ] **Step 5: Wire into the chat route.** In `src/app/api/chat/route.ts`, add the import near the other `@/lib` imports:

```ts
import { retrieveContext } from '@/lib/retrieval';
```

Then REPLACE the entire `// 2. Semantic retrieval …` block (the `try { ... } catch { ... }` spanning the `userMessages`/`generateEmbedding`/`findSimilarMessages`/`findSimilarDocumentChunks` logic — currently lines ~64–109) with:

```ts
      // 2. Retrieval pipeline (rewrite → vector top-N → MMR → rerank → top-k).
      // Best-effort: returns nulls if embeddings/providers are unavailable.
      const retrieved = await retrieveContext(messages as UIMessage[], {
        chatId,
        projectId: chat?.projectId ?? null,
      });
      semanticContext = retrieved.semanticContext;
      documentContext = retrieved.documentContext;
```

(Leave the `// 1. System prompt` block above and the `// 3. Build context prefix` block below unchanged. `generateEmbedding`, `findSimilarMessages`, `findSimilarDocumentChunks` imports in the route become unused — remove them from the route's import line, keeping `createProvider`, `apiError`, `chatRequestSchema`, etc.)

- [ ] **Step 6: Verify the chat-route test + typecheck**

Run: `npx vitest run tests/unit/api/chat-route.test.ts && npx tsc --noEmit 2>&1 | grep -E "route.ts|retrieval.ts" || echo "clean"`
Expected: chat-route tests still pass (they mock `@/lib/embeddings`; now retrieval is internal — if a test asserted on `findSimilarMessages` directly it may need its mock moved to `@/lib/retrieval`, update if so), typecheck clean. If the chat-route test mocked `@/lib/embeddings.generateEmbedding`/`findSimilarMessages`, replace that mock with `vi.doMock('@/lib/retrieval', () => ({ retrieveContext: () => Promise.resolve({ semanticContext: null, documentContext: null }) }))` and keep the summary/system-prompt assertions.

- [ ] **Step 7: Commit**

```bash
git add src/lib/retrieval.ts tests/unit/lib/retrieval.test.ts src/app/api/chat/route.ts tests/unit/api/chat-route.test.ts
git commit -m "feat(phase-b2): retrieval orchestrator wired into chat route"
```

---

## Task 7: Test-suite speedup — shared PGlite (QA)

**Files:** Modify `tests/helpers/test-db.ts`

- [ ] **Step 1: Replace `tests/helpers/test-db.ts`** with a shared instance that truncates between tests:

```ts
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import * as schema from '@/db/schema'

let client: PGlite | null = null
export let testDb: ReturnType<typeof drizzle<typeof schema>>

// All tables, children before parents not required for TRUNCATE ... CASCADE.
const TABLES = [
  'chat_topics', 'message_attachments', 'persona_usage', 'document_chunks',
  'documents', 'message_embeddings', 'messages', 'chats', 'projects', 'settings',
]

/**
 * Returns a Postgres-compatible test DB. The PGlite instance + migrations are
 * created once (expensive); each call TRUNCATEs all tables so tests stay isolated
 * while avoiding a fresh WASM Postgres per test.
 */
export async function createTestDb() {
  if (!client) {
    client = new PGlite({ extensions: { vector } })
    testDb = drizzle({ client, schema })
    await migrate(testDb, { migrationsFolder: './drizzle' })
  } else {
    await testDb.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE;`))
  }
  return testDb
}
```

- [ ] **Step 2: Run the full suite — expect green AND faster**

Run: `npm test`
Expected: all tests pass (≈ the prior count + the new B2 tests), and total time drops substantially from the ~40s baseline (one PGlite init instead of one per test). If any test now leaks state (relies on a fresh DB beyond TRUNCATE), fix that test to not assume specific identity values.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/test-db.ts
git commit -m "test(phase-b2): shared PGlite + TRUNCATE for faster suite"
```

---

## Task 8: Documentation (Docs)

**Files:** `CLAUDE.md`, `CHANGELOG.md`, `docs/chatlog-2026-06-07-phase-b2-advanced-rag.md` (new)

- [ ] **Step 1: Update `CLAUDE.md`** — in the Context Pipeline section, document the new retrieval pipeline (rewrite → vector top-N → MMR → rerank → top-k via `src/lib/retrieval.ts`), the `ragConfig` knobs + env vars (`RAG_*`), that rewrite/rerank use Gemini Flash and all stages degrade gracefully, and the latency note (two Flash calls/message; toggle via `RAG_REWRITE_ENABLED`/`RAG_RERANK_ENABLED`). Update the Testing section: PGlite is now a shared instance + TRUNCATE (fast).

- [ ] **Step 2: Update `CHANGELOG.md`** — add a `[4.1.0]` entry (additive feature) summarizing the advanced-RAG pipeline + test speedup.

- [ ] **Step 3: Write `docs/chatlog-2026-06-07-phase-b2-advanced-rag.md`** — decisions (full basket; configurable-not-tuned thresholds; Gemini Flash; graceful fallback; defer real-data tuning), modules, and the pipeline.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md docs/chatlog-2026-06-07-phase-b2-advanced-rag.md
git commit -m "docs(phase-b2): document advanced RAG pipeline + config"
```

---

## Task 9: Verification gate (QA)

**Files:** none

- [ ] **Step 1: Full gate**

Run: `npm install && npm run lint && npm run build && npm test && npm run test:e2e`
Expected: all green, zero warnings. (E2E needs a Postgres — runs in CI with the pgvector service, or locally with `DATABASE_URL` set + `drizzle-kit migrate`.)

- [ ] **Step 2: Manual smoke** (`npm run dev`, with a real chat + an uploaded doc): ask a follow-up question that relies on pronoun resolution ("what about the second one?") and confirm the reply still cites the right document chunk; toggle `RAG_RERANK_ENABLED=false` and confirm chat still works (fallback path).

- [ ] **Step 3: Tag** (after gate + smoke): `git tag -a phase-b2 -m "Phase B2: advanced RAG pipeline"`

---

## Self-review (plan author)

**Spec coverage:** ragConfig (T1) · MMR (T2) · query-rewrite (T3) · rerank (T4) · embeddings widening for MMR (T5) · pipeline orchestration + chat wiring (T6) · test speedup (T7) · docs (T8) · gate (T9). All spec modules + the pipeline + config + graceful fallback + test speedup covered. ✅

**Placeholder scan:** every code step shows complete code; tests included for each module. ✅

**Type consistency:** `getRagConfig`/`RagConfig`, `mmr`/`MmrItem`, `rewriteQuery`/`Turn`, `rerankCandidates`, `retrieveContext`, and the `embedding` field added to `findSimilar*` return types are used consistently across T5/T6. MMR consumes `{embedding, similarity}` which both `findSimilar*` now provide. ✅

**Graceful-fallback invariant:** rewrite (T3), rerank (T4), and the orchestrator (T6) each catch and fall back; with all toggles off the pipeline reduces to plain vector top-k. ✅

**Flagged for execution:** the chat-route test currently mocks `@/lib/embeddings` — T6 Step 6 covers moving that mock to `@/lib/retrieval` if needed.
