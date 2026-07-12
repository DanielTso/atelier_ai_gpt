// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersonas } from '@/hooks/usePersonas'

describe('usePersonas', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('provides one flat list of built-in personas, each with a model', () => {
    const { result } = renderHook(() => usePersonas())
    expect(result.current.personas).toHaveLength(14)
    expect(result.current.personas.every(p => p.model.startsWith('claude-'))).toBe(true)
  })

  it('General Assistant is the default — Sonnet 5, Medium effort', () => {
    const { result } = renderHook(() => usePersonas())
    const def = result.current.defaultPersona
    expect(def.id).toBe('general-assistant')
    expect(def.model).toBe('claude-sonnet-5')
    expect(def.effort).toBe('medium')
    expect(def.isDefault).toBe(true)
  })

  it('Brief carries no effort (Haiku does not support it)', () => {
    const { result } = renderHook(() => usePersonas())
    const brief = result.current.getPersonaById('brief')
    expect(brief.model).toBe('claude-haiku-4-5')
    expect(brief.effort).toBeUndefined()
  })

  it("getPersonaById maps 'default' and unknown ids to General Assistant", () => {
    const { result } = renderHook(() => usePersonas())
    expect(result.current.getPersonaById('default').id).toBe('general-assistant')
    expect(result.current.getPersonaById('coding-assistant').id).toBe('general-assistant') // removed id
    expect(result.current.getPersonaById(null).id).toBe('general-assistant')
  })

  it('getPersonaByPrompt(null) returns General Assistant', () => {
    const { result } = renderHook(() => usePersonas())
    expect(result.current.getPersonaByPrompt(null).id).toBe('general-assistant')
  })

  it('addPersona defaults model/effort to the house values', () => {
    const { result } = renderHook(() => usePersonas())
    act(() => {
      result.current.addPersona({ name: 'Mine', icon: '🎭', prompt: 'Be mine', model: '' })
    })
    expect(result.current.personas).toHaveLength(15)
    const custom = result.current.customPersonas[0]
    expect(custom.model).toBe('claude-sonnet-5')
    expect(custom.effort).toBe('medium')
    expect(custom.id).toMatch(/^custom-/)
  })

  it('deletePersona removes a custom persona', () => {
    const { result } = renderHook(() => usePersonas())
    let id: string
    act(() => { id = result.current.addPersona({ name: 'Temp', icon: '🗑️', prompt: 'temp', model: '' }).id })
    expect(result.current.personas).toHaveLength(15)
    act(() => { result.current.deletePersona(id!) })
    expect(result.current.personas).toHaveLength(14)
  })
})
