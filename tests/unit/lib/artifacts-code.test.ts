import { describe, it, expect, vi } from 'vitest'
import { CODE_LANGUAGES, CODE_LANGUAGE_IDS, codeLanguage } from '@/lib/artifacts/code'
import { renderArtifact } from '@/lib/artifacts/render'

// The tool touches storage + DB at execute time only; schema tests never run execute.
vi.mock('@/lib/storage', () => ({
  uploadBuffer: vi.fn(), createSignedDownloadUrl: vi.fn(), removeObjects: vi.fn(),
  ARTIFACT_URL_TTL_SECONDS: 1,
}))
vi.mock('@/app/actions', () => ({ createArtifact: vi.fn() }))

import { createGenerateArtifactTool } from '@/lib/artifacts/tool'

describe('code language registry', () => {
  it('has unique ids and sane extensions', () => {
    const ids = CODE_LANGUAGES.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(codeLanguage('python')).toMatchObject({ ext: 'py', shikiLang: 'python' })
    expect(codeLanguage('bash')).toMatchObject({ ext: 'sh' })
    expect(codeLanguage('typescript')).toMatchObject({ ext: 'ts' })
    expect(codeLanguage('nope')).toBeNull()
    expect(codeLanguage(null)).toBeNull()
    expect(CODE_LANGUAGE_IDS).toEqual(ids)
  })
})

describe('renderArtifact code branch', () => {
  it('passes code through as utf-8 text with the language extension', async () => {
    const src = '#!/usr/bin/env bash\necho "hi"\n'
    const r = await renderArtifact('code', 'Deploy script', src, 'bash')
    expect(r.buffer.toString('utf-8')).toBe(src)
    expect(r.contentType).toBe('text/plain; charset=utf-8')
    expect(r.ext).toBe('sh')
  })
  it('rejects code without a known language', async () => {
    await expect(renderArtifact('code', 'X', 'x', undefined)).rejects.toThrow(/language/i)
    await expect(renderArtifact('code', 'X', 'x', 'cobol')).rejects.toThrow(/language/i)
  })
})

describe('generate_artifact code inputs', () => {
  const tool = createGenerateArtifactTool({ chatId: 1, projectId: null })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = (tool as any).inputSchema
  it('accepts code with a known language', () => {
    expect(schema.safeParse({ type: 'code', title: 'Script', format: 'code', language: 'python', content: 'print(1)' }).success).toBe(true)
  })
  it('rejects code without a language', () => {
    expect(schema.safeParse({ type: 'code', title: 'Script', format: 'code', content: 'print(1)' }).success).toBe(false)
  })
  it('still accepts existing types without language', () => {
    expect(schema.safeParse({ type: 'html', title: 'Page', format: 'html', content: '<!doctype html>' }).success).toBe(true)
  })
})
