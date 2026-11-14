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
  hybridEnabled: boolean
  rrfK: number
  keywordTopN: number
  stageTimeoutMs: number
}

function num(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// A zero or negative timeout would abort every stage at once (or throw).
function positive(n: number, fallback: number): number {
  return n > 0 ? n : fallback
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
    hybridEnabled: bool(process.env.RAG_HYBRID_ENABLED, true),
    rrfK: num(process.env.RAG_RRF_K, 60),
    keywordTopN: num(process.env.RAG_KEYWORD_TOP_N, num(process.env.RAG_TOP_N, 20)),
    // Hard bound per best-effort Gemini stage on the chat path (rewrite, query
    // embedding, rerank); each also runs with maxRetries 0. A stage that times out
    // degrades to the stage before it.
    stageTimeoutMs: positive(num(process.env.RAG_STAGE_TIMEOUT_MS, 4000), 4000),
  }
}
