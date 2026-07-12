// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { CONTRACT_ABSTRACT_FIELDS, PERSONAS_FOR_TEST } from '@/hooks/usePersonas'

describe('Contract Abstract persona', () => {
  const persona = PERSONAS_FOR_TEST.find(p => p.id === 'contract-abstract')
  it('exists with the right tier', () => {
    expect(persona).toBeDefined()
    expect(persona!.model).toBe('claude-fable-5')
    expect(persona!.effort).toBe('max')
  })
  it('locks every schema field into the prompt', () => {
    expect(CONTRACT_ABSTRACT_FIELDS.length).toBeGreaterThanOrEqual(20)
    for (const f of CONTRACT_ABSTRACT_FIELDS) expect(persona!.prompt).toContain(f)
  })
  it('mandates the xlsx artifact contract', () => {
    expect(persona!.prompt).toContain('generate_artifact')
    expect(persona!.prompt).toContain('Field | Value | Source Ref')
    expect(persona!.prompt).toContain('Not found in provided documents')
  })
})
