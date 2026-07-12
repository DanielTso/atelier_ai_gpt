import { describe, it, expect, afterEach } from 'vitest'
import { getRagConfig } from '@/lib/ragConfig'

const KEYS = ['RAG_DOC_THRESHOLD','RAG_MSG_THRESHOLD','RAG_TOP_N','RAG_DOC_TOP_K','RAG_MSG_TOP_K','RAG_MMR_LAMBDA','RAG_REWRITE_ENABLED','RAG_RERANK_ENABLED','RAG_MMR_ENABLED','RAG_HYBRID_ENABLED','RAG_RRF_K','RAG_KEYWORD_TOP_N']

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
    expect(c.hybridEnabled).toBe(true)
    expect(c.rrfK).toBe(60)
    expect(c.keywordTopN).toBe(20)
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

  it('keywordTopN falls back to RAG_TOP_N when unset, and can be overridden independently', () => {
    process.env.RAG_TOP_N = '40'
    expect(getRagConfig().keywordTopN).toBe(40)
    process.env.RAG_KEYWORD_TOP_N = '15'
    expect(getRagConfig().keywordTopN).toBe(15)
  })

  it('applies hybrid + rrf env overrides', () => {
    process.env.RAG_HYBRID_ENABLED = 'false'
    process.env.RAG_RRF_K = '30'
    const c = getRagConfig()
    expect(c.hybridEnabled).toBe(false)
    expect(c.rrfK).toBe(30)
  })
})
