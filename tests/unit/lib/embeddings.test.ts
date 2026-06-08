// cosineSimilarity was removed in the pgvector migration (Task 5).
// Vector search is now covered by tests/unit/db/vector-search.test.ts.
// generateEmbedding / ensureEmbeddingModel require a live Gemini key
// and are not exercised in the offline CI suite.
import { describe, it } from 'vitest'

describe('embeddings (pgvector era)', () => {
  it('placeholder — see tests/unit/db/vector-search.test.ts for coverage', () => {
    // intentionally empty: cosineSimilarity deleted, findSimilar* covered by vector-search tests
  })
})
