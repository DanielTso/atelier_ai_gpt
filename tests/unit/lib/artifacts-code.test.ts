import { describe, it, expect } from 'vitest'
import { CODE_LANGUAGES, CODE_LANGUAGE_IDS, codeLanguage } from '@/lib/artifacts/code'
import { renderArtifact } from '@/lib/artifacts/render'

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
