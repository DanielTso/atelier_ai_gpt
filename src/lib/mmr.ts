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
 * lambda=1 -> pure relevance; lambda=0 -> pure diversity.
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
        : Math.max(...selected.map(s => cosine(pool[i]!.embedding, s.embedding)))
      const score = lambda * pool[i]!.similarity - (1 - lambda) * maxSimToSelected
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    selected.push(pool[bestIdx]!)
    pool.splice(bestIdx, 1)
  }
  return selected
}
