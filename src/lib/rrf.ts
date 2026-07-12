// Reciprocal Rank Fusion: merge ranked candidate lists (vector, keyword) into
// one ranking without score calibration. score(item) = Σ over lists 1/(k + rank + 1).
// Payload for duplicate ids comes from the FIRST list containing the id — pass
// the vector list first so fused items keep their embeddings for MMR.
export function rrfFuse<T extends { chunkId: number }>(
  lists: T[][],
  k = 60,
): (T & { rrfScore: number })[] {
  const byId = new Map<number, T & { rrfScore: number }>()
  for (const list of lists) {
    list.forEach((item, rank) => {
      const existing = byId.get(item.chunkId)
      const inc = 1 / (k + rank + 1)
      if (existing) existing.rrfScore += inc
      else byId.set(item.chunkId, { ...item, rrfScore: inc })
    })
  }
  return [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore)
}
