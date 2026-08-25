// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersonas, resolvePersonaModel, resolvePersonaModelLabel, resolveModelLabel, modelShortLabel, PERSONAS_FOR_TEST } from '@/hooks/usePersonas'
import { isModelTier } from '@/lib/models/types'
import type { Model } from '@/types'

// Shared fixture shape for GET /api/models rows. `name` matters here (not just
// padding) — it's what resolvePersonaModelLabel() is supposed to prefer over a
// static id-shaped map, so fixture names mirror Anthropic's real display_name.
const BASE_CAPS = { supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as const, supportsThinking: true, supportsImageInput: true, supportsStructuredOutputs: true }
const BASE_PRICING = { inputPerMTok: 1, outputPerMTok: 1, estimated: false }
function model(id: string, name: string, family: string, provider: 'anthropic' | 'google' = 'anthropic'): Model {
  return { name, model: id, digest: 'sha256:test', provider, family, capabilities: { ...BASE_CAPS, effortLevels: [...BASE_CAPS.effortLevels] }, pricing: BASE_PRICING }
}

// Mirrors what GET /api/models (curated — one entry per family) actually returns.
const MODELS: Model[] = [
  model('claude-opus-4-8', 'Claude Opus 4.8', 'opus'),
  model('claude-fable-5', 'Claude Fable 5', 'fable'),
  model('claude-sonnet-5', 'Claude Sonnet 5', 'sonnet'),
  model('claude-haiku-4-5', 'Claude Haiku 4.5', 'haiku'),
  model('gemini-3.1-flash-image', 'Nano Banana 2', 'nano-banana', 'google'),
]

// Mirrors the real, currently-live fact that motivated the review fix: the
// Anthropic catalog serves Haiku 4.5 ONLY as a dated snapshot — no bare
// `claude-haiku-4-5` alias exists — so curateCatalog's one-entry-per-family
// pick for 'haiku' is dated. The row's `name` (Anthropic's display_name) is
// never dated regardless, which is exactly what resolvePersonaModelLabel()
// must prefer over the raw id.
const MODELS_HAIKU_DATED_ONLY: Model[] = MODELS.map(m =>
  m.family === 'haiku' ? { ...m, model: 'claude-haiku-4-5-20251001' } : m
)

describe('usePersonas', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('provides one flat list of built-in personas, each resolving to a Claude model id', () => {
    const { result } = renderHook(() => usePersonas())
    expect(result.current.personas).toHaveLength(14)
    expect(result.current.personas.every(p => resolvePersonaModel(p, MODELS).startsWith('claude-'))).toBe(true)
  })

  it('General Assistant is the default — tiered to sonnet, Medium effort', () => {
    const { result } = renderHook(() => usePersonas())
    const def = result.current.defaultPersona
    expect(def.id).toBe('general-assistant')
    expect(def.model).toBe('sonnet')
    expect(resolvePersonaModel(def, MODELS)).toBe('claude-sonnet-5')
    expect(def.effort).toBe('medium')
    expect(def.isDefault).toBe(true)
  })

  it('Brief carries no effort (Haiku does not support it)', () => {
    const { result } = renderHook(() => usePersonas())
    const brief = result.current.getPersonaById('brief')
    expect(brief.model).toBe('haiku')
    expect(resolvePersonaModel(brief, MODELS)).toBe('claude-haiku-4-5')
    expect(brief.effort).toBeUndefined()
  })

  // Roster-driven: filters the ACTUAL PERSONAS_FOR_TEST roster by tier and
  // compares against the expected id list, so a persona wrongly tiered (or
  // dropped from a tier, or an extra fifth persona added to one) fails this
  // assertion. A prior version of this test asserted
  // `expect(flagshipIds).toHaveLength(4)` against an array the test itself
  // declared — that measures the test, not the roster, and passes no matter
  // what the roster actually contains. Every group below is exhaustive: it
  // also proves nothing unexpected leaked into a tier.
  it('the roster partitions into exactly the four ruled tier groups, with Contract Abstract the sole literal-id persona', () => {
    const byTier = (tier: string) => PERSONAS_FOR_TEST.filter(p => p.model === tier).map(p => p.id).sort()

    expect(byTier('flagship')).toEqual(
      ['claims-delay-analyst', 'constructability-reviewer', 'contract-spec-analyst', 'deep-reasoner'].sort()
    )
    expect(byTier('opus')).toEqual(
      ['code-review', 'coding', 'construction-pro', 'deep-analysis'].sort()
    )
    expect(byTier('sonnet')).toEqual(
      ['creative-writing', 'general-assistant', 'plan-spec-reader', 'teacher'].sort()
    )
    expect(byTier('haiku')).toEqual(['brief'])

    // Contract Abstract is the ONLY built-in carrying a literal model id
    // instead of a tier — the locked-schema exception the ruling carves out.
    const pinned = PERSONAS_FOR_TEST.filter(p => !isModelTier(p.model))
    expect(pinned.map(p => p.id)).toEqual(['contract-abstract'])
    expect(pinned[0].model).toBe('claude-fable-5')

    // Sanity: every persona lands in exactly one of the five buckets above
    // (4 tiers + 1 pinned), accounting for the full roster of 14.
    const total = byTier('flagship').length + byTier('opus').length + byTier('sonnet').length + byTier('haiku').length + pinned.length
    expect(total).toBe(PERSONAS_FOR_TEST.length)
  })

  it('the four flagship personas resolve to the fable-family model', () => {
    const { result } = renderHook(() => usePersonas())
    for (const id of ['claims-delay-analyst', 'contract-spec-analyst', 'constructability-reviewer', 'deep-reasoner']) {
      expect(resolvePersonaModel(result.current.getPersonaById(id), MODELS)).toBe('claude-fable-5')
    }
  })

  it('Contract Abstract stays pinned to the exact claude-fable-5 id, not the flagship tier (locked-schema output)', () => {
    const { result } = renderHook(() => usePersonas())
    const abstract = result.current.getPersonaById('contract-abstract')
    expect(abstract.model).toBe('claude-fable-5')
    // An exact id passes through resolvePersonaModel unchanged.
    expect(resolvePersonaModel(abstract, MODELS)).toBe('claude-fable-5')
    expect(resolvePersonaModel(abstract, [])).toBe('claude-fable-5')
  })

  it('resolvePersonaModel falls back to the first Anthropic model — and warns, mirroring resolveTier — when the tiered family is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const opusPersona = PERSONAS_FOR_TEST.find(p => p.id === 'coding')!
    expect(opusPersona.model).toBe('opus')
    const modelsWithoutOpus = MODELS.filter(m => m.family !== 'opus')

    // fable is the first remaining Anthropic entry in MODELS' declared order.
    expect(resolvePersonaModel(opusPersona, modelsWithoutOpus)).toBe('claude-fable-5')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('opus'))
    warn.mockRestore()
  })

  it('resolvePersonaModel returns the raw tier as a last resort, WITHOUT warning, when no models are loaded yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sonnetPersona = PERSONAS_FOR_TEST.find(p => p.id === 'general-assistant')!

    expect(resolvePersonaModel(sonnetPersona, [])).toBe('sonnet')
    // An empty `models` list is the ordinary "GET /api/models hasn't returned
    // yet" window (true on every SSR/static-generation pass, and briefly on
    // every client page load) — not a catalog anomaly, so it must not spam
    // the console/build log every single time. Only a *populated* `models`
    // list missing a specific family (the previous test) warrants a warn.
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('modelShortLabel never surfaces a raw internal tier keyword, resolved or not', () => {
    // Resolved (the normal path): a concrete id gets its real short label.
    expect(modelShortLabel(resolvePersonaModel(PERSONAS_FOR_TEST.find(p => p.id === 'general-assistant')!, MODELS))).toBe('Sonnet 5')
    // Unresolved backstop (e.g. rendered before GET /api/models returns): a
    // friendly capitalized label, never the lowercase internal keyword.
    expect(modelShortLabel('flagship')).toBe('Flagship')
    expect(modelShortLabel('sonnet')).toBe('Sonnet')
  })

  it("resolvePersonaModelLabel shows the model row's real display name, not a raw dated id — Anthropic currently serves Haiku 4.5 dated-only", () => {
    const brief = PERSONAS_FOR_TEST.find(p => p.id === 'brief')!
    // The id resolver correctly still returns the dated id — a real, sendable
    // model id is what the id path is FOR.
    expect(resolvePersonaModel(brief, MODELS_HAIKU_DATED_ONLY)).toBe('claude-haiku-4-5-20251001')
    // The label resolver must NOT render that raw dated id — it prefers the
    // matched row's own `name`, which is never dated.
    expect(resolvePersonaModelLabel(brief, MODELS_HAIKU_DATED_ONLY)).toBe('Claude Haiku 4.5')
  })

  it('resolvePersonaModelLabel prefers the real display name over the static short-label map for an ordinary (non-dated) id too', () => {
    const generalAssistant = PERSONAS_FOR_TEST.find(p => p.id === 'general-assistant')!
    expect(resolvePersonaModelLabel(generalAssistant, MODELS)).toBe('Claude Sonnet 5')
  })

  it('resolvePersonaModelLabel falls back to modelShortLabel for an exact legacy id absent from the curated models list', () => {
    // claude-sonnet-4-6 is a LEGACY_PINS id — routable, but never in the
    // curated (one-entry-per-family) picker list, so no row exists to prefer.
    const legacyPersona = { id: 'x', name: 'x', icon: 'x', prompt: '', model: 'claude-sonnet-4-6' }
    expect(resolvePersonaModelLabel(legacyPersona, MODELS)).toBe('Sonnet 4.6')
  })

  // resolveModelLabel is the raw-id counterpart used by usage-rollup rows
  // (Task 11), which don't carry a Persona — same "prefer the live row's real
  // display name" rule, factored out of resolvePersonaModelLabel's non-tier
  // branch rather than duplicated.
  it('resolveModelLabel prefers the live row name over a raw dated id', () => {
    expect(resolveModelLabel('claude-haiku-4-5-20251001', MODELS_HAIKU_DATED_ONLY)).toBe('Claude Haiku 4.5')
  })

  it('resolveModelLabel falls back to modelShortLabel, then the raw id, when no row matches', () => {
    expect(resolveModelLabel('claude-sonnet-4-6', MODELS)).toBe('Sonnet 4.6')
    expect(resolveModelLabel('claude-totally-unknown-id', MODELS)).toBe('totally-unknown-id')
  })

  // Review regression: GET /api/models never serves Gemini text models, so
  // gemini-3.5-flash (the internal housekeeping model behind
  // summarize/generate-title/classify/memory-suggest) always misses the row
  // lookup. Before MODEL_SHORT_LABELS carried an entry for it, this fell all
  // the way through to the raw-id-strip fallback and rendered "3.5-flash" —
  // and this is the one usage-rollup row guaranteed to appear for every user,
  // since title generation fires on every chat.
  it('resolveModelLabel renders the internal housekeeping model as a real label, not a raw id fragment', () => {
    expect(resolveModelLabel('gemini-3.5-flash', MODELS)).toBe('Gemini Flash (housekeeping)')
    expect(resolveModelLabel('gemini-3.5-flash', [])).toBe('Gemini Flash (housekeeping)')
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

  it('addPersona defaults model/effort to the house values (the sonnet tier, same as the default persona)', () => {
    const { result } = renderHook(() => usePersonas())
    act(() => {
      result.current.addPersona({ name: 'Mine', icon: '🎭', prompt: 'Be mine', model: '' })
    })
    expect(result.current.personas).toHaveLength(15)
    const custom = result.current.customPersonas[0]
    expect(custom.model).toBe('sonnet')
    expect(resolvePersonaModel(custom, MODELS)).toBe('claude-sonnet-5')
    expect(custom.effort).toBe('medium')
    expect(custom.id).toMatch(/^custom-/)
  })

  it('a custom persona carrying an exact legacy model id keeps working unchanged (localStorage back-compat)', () => {
    const { result } = renderHook(() => usePersonas())
    act(() => {
      result.current.addPersona({ name: 'Pinned', icon: '📌', prompt: 'Stay pinned', model: 'claude-sonnet-4-6' })
    })
    const custom = result.current.customPersonas[0]
    expect(custom.model).toBe('claude-sonnet-4-6')
    expect(resolvePersonaModel(custom, MODELS)).toBe('claude-sonnet-4-6')
  })

  it('grounds the document-centric built-ins by default', () => {
    const { result } = renderHook(() => usePersonas())
    const grounded = ['contract-abstract', 'contract-spec-analyst', 'plan-spec-reader']
    for (const id of grounded) {
      expect(result.current.getPersonaById(id).grounded).toBe(true)
    }
    // A general persona is NOT grounded by default.
    expect(result.current.getPersonaById('general-assistant').grounded).toBeFalsy()
    expect(result.current.getPersonaById('coding').grounded).toBeFalsy()
  })

  it('persists the grounded flag on a custom persona', () => {
    const { result } = renderHook(() => usePersonas())
    act(() => {
      result.current.addPersona({ name: 'Scoped', icon: '🔒', prompt: 'Ground me', model: '', grounded: true })
    })
    expect(result.current.customPersonas[0].grounded).toBe(true)
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
