import { describe, it, expect } from 'vitest'
import { resolveShikiLang, SHIKI_LANGS } from '@/lib/highlighter'

describe('resolveShikiLang', () => {
  it('passes through supported languages', () => {
    expect(resolveShikiLang('python')).toBe('python')
    expect(resolveShikiLang('typescript')).toBe('typescript')
  })
  it('maps common aliases', () => {
    expect(resolveShikiLang('sh')).toBe('bash')
    expect(resolveShikiLang('shell')).toBe('bash')
    expect(resolveShikiLang('zsh')).toBe('bash')
    expect(resolveShikiLang('py')).toBe('python')
    expect(resolveShikiLang('ts')).toBe('typescript')
    expect(resolveShikiLang('js')).toBe('javascript')
    expect(resolveShikiLang('ps1')).toBe('powershell')
    expect(resolveShikiLang('yml')).toBe('yaml')
  })
  it('is case-insensitive and returns null for unknown/empty', () => {
    expect(resolveShikiLang('Python')).toBe('python')
    expect(resolveShikiLang('brainfuck')).toBeNull()
    expect(resolveShikiLang('')).toBeNull()
    expect(resolveShikiLang(null)).toBeNull()
    expect(resolveShikiLang(undefined)).toBeNull()
  })
  it('exposes the v1 grammar list', () => {
    for (const l of ['python', 'bash', 'typescript', 'tsx', 'javascript', 'jsx', 'json', 'yaml', 'sql', 'markdown', 'html', 'css', 'diff', 'powershell']) {
      expect(SHIKI_LANGS).toContain(l)
    }
  })
})
