// Keyword leg of hybrid retrieval: Postgres FTS over the generated content_tsv
// column plus trigram-indexed ILIKE for identifier tokens ("SW-101") that both
// the FTS tokenizer and embeddings mangle. Results fuse with vector search via
// RRF in retrieval.ts. content_tsv lives only in migration SQL (0016), so both
// queries are raw sql`` — normalize rows across postgres-js (array) and PGlite
// ({ rows }) drivers.
import { sql } from 'drizzle-orm'
import { db } from '@/db'

export interface KeywordChunk {
  content: string
  chunkId: number
  documentId: number
  filename: string
  embedding: null
}

type Row = { chunk_id: number; content: string; document_id: number; filename: string }

const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : (r as { rows: Row[] }).rows) as Row[]

// Sheet-number-ish: 1-4 letters, optional separator, digits, optional suffix.
const IDENTIFIER_RE = /\b[A-Za-z]{1,4}[-.]?\d{1,5}(?:\.\d+)?[A-Za-z]?\b/g

export function identifierTokens(query: string, max = 5): string[] {
  const out: string[] = []
  for (const m of query.match(IDENTIFIER_RE) ?? []) {
    if (!/\d/.test(m) || !/[A-Za-z]/.test(m)) continue
    if (!out.includes(m)) out.push(m)
    if (out.length >= max) break
  }
  return out
}

// A "query" longer than this is not a keyword query — messages carrying inline
// file attachments arrive as the FULL file text (600k+ chars, seen live with an
// attached contract), and websearch_to_tsquery rejects inputs that large. The
// head of the message is where the user's actual ask lives.
const MAX_QUERY_CHARS = 2000

export async function findChunksByKeyword(
  query: string,
  projectId: number,
  topN: number,
): Promise<KeywordChunk[]> {
  if (query.length > MAX_QUERY_CHARS) query = query.slice(0, MAX_QUERY_CHARS)
  const fts = rowsOf(await db.execute(sql`
    SELECT dc.id AS chunk_id, dc.content, dc.document_id, d.filename
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.project_id = ${projectId}
      AND dc.content_tsv @@ websearch_to_tsquery('english', ${query})
    ORDER BY ts_rank_cd(dc.content_tsv, websearch_to_tsquery('english', ${query})) DESC
    LIMIT ${topN}`))

  const tokens = identifierTokens(query)
  let trg: Row[] = []
  if (tokens.length > 0) {
    const likes = sql.join(tokens.map(t => sql`dc.content ILIKE ${'%' + t + '%'}`), sql` OR `)
    trg = rowsOf(await db.execute(sql`
      SELECT dc.id AS chunk_id, dc.content, dc.document_id, d.filename
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE dc.project_id = ${projectId} AND (${likes})
      LIMIT ${topN}`))
  }

  const seen = new Set<number>()
  const out: KeywordChunk[] = []
  for (const r of [...fts, ...trg]) {
    if (seen.has(r.chunk_id)) continue
    seen.add(r.chunk_id)
    out.push({ content: r.content, chunkId: r.chunk_id, documentId: r.document_id, filename: r.filename, embedding: null })
    if (out.length >= topN) break
  }
  return out
}
