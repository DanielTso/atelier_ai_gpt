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
