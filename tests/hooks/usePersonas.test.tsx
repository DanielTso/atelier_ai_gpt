// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersonas } from '@/hooks/usePersonas'

describe('usePersonas', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('provides 6 default personas and 5 combo presets', () => {
    const { result } = renderHook(() => usePersonas())
    expect(result.current.defaultPersonas).toHaveLength(6)
    expect(result.current.comboPresets).toHaveLength(5)
    expect(result.current.personas).toHaveLength(11) // 6 default + 5 combo
  })

  it('addPersona creates a custom persona', () => {
    const { result } = renderHook(() => usePersonas())
    act(() => {
      result.current.addPersona({ name: 'Custom', icon: '🎭', prompt: 'Be custom' })
    })
    expect(result.current.personas).toHaveLength(12) // 11 built-in + 1 custom
    expect(result.current.customPersonas).toHaveLength(1)
    expect(result.current.customPersonas[0].name).toBe('Custom')
    expect(result.current.customPersonas[0].id).toMatch(/^custom-/)
  })

  it('deletePersona removes a custom persona', () => {
    const { result } = renderHook(() => usePersonas())
    let newId: string
    act(() => {
      const p = result.current.addPersona({ name: 'Temp', icon: '🗑️', prompt: 'temp' })
      newId = p.id
    })
    expect(result.current.personas).toHaveLength(12)

    act(() => {
      result.current.deletePersona(newId!)
    })
    expect(result.current.personas).toHaveLength(11)
  })

  it('getPersonaById finds a persona', () => {
    const { result } = renderHook(() => usePersonas())
    const found = result.current.getPersonaById('coding-assistant')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Coding Assistant')
  })

  it('getPersonaById finds a combo preset', () => {
    const { result } = renderHook(() => usePersonas())
    const found = result.current.getPersonaById('combo-code-review')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Code Review')
    expect(found!.isCombo).toBe(true)
    expect(found!.preferredModel).toBe('claude-opus-4-8')
  })

  it('getPersonaByPrompt with null returns Default', () => {
    const { result } = renderHook(() => usePersonas())
    const found = result.current.getPersonaByPrompt(null)
    expect(found).toBeDefined()
    expect(found!.id).toBe('default')
  })

  it('combo presets are flagged and pair a current Claude model', () => {
    const { result } = renderHook(() => usePersonas())
    const combos = result.current.comboPresets
    expect(combos).toHaveLength(5)
    expect(combos.every(p => p.isCombo)).toBe(true)
    expect(combos.every(p => p.preferredModel?.startsWith('claude-'))).toBe(true)
  })
})
