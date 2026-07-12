import { describe, it, expect } from 'vitest'
import { parseNavUrl, navToUrl, type NavState } from '@/lib/navState'

describe('parseNavUrl', () => {
  it('parses empty / bare search as home', () => {
    expect(parseNavUrl('')).toEqual({ kind: 'home' })
    expect(parseNavUrl('?')).toEqual({ kind: 'home' })
  })

  it('parses the three tab views', () => {
    expect(parseNavUrl('?view=projects')).toEqual({ kind: 'tab', view: 'projects' })
    expect(parseNavUrl('?view=artifacts')).toEqual({ kind: 'tab', view: 'artifacts' })
    expect(parseNavUrl('?view=images')).toEqual({ kind: 'tab', view: 'images' })
  })

  it('ignores unknown views', () => {
    expect(parseNavUrl('?view=bogus')).toEqual({ kind: 'home' })
    expect(parseNavUrl('?view=home')).toEqual({ kind: 'home' })
  })

  it('parses a project landing url', () => {
    expect(parseNavUrl('?project=3')).toEqual({ kind: 'project', projectId: 3 })
  })

  it('rejects non-positive or non-numeric ids', () => {
    expect(parseNavUrl('?project=0')).toEqual({ kind: 'home' })
    expect(parseNavUrl('?project=-1')).toEqual({ kind: 'home' })
    expect(parseNavUrl('?project=abc')).toEqual({ kind: 'home' })
    expect(parseNavUrl('?chat=1.5')).toEqual({ kind: 'home' })
  })

  it('parses project chats and standalone chats', () => {
    expect(parseNavUrl('?project=3&chat=12')).toEqual({ kind: 'chat', projectId: 3, chatId: 12 })
    expect(parseNavUrl('?chat=12')).toEqual({ kind: 'chat', projectId: null, chatId: 12 })
  })

  it('gives chat priority over view, and project over view', () => {
    expect(parseNavUrl('?chat=12&view=projects')).toEqual({ kind: 'chat', projectId: null, chatId: 12 })
    expect(parseNavUrl('?project=3&view=artifacts')).toEqual({ kind: 'project', projectId: 3 })
  })

  it('falls back to project when the chat param is invalid', () => {
    expect(parseNavUrl('?chat=abc&project=3')).toEqual({ kind: 'project', projectId: 3 })
  })

  it('accepts input with or without the leading question mark', () => {
    expect(parseNavUrl('project=3')).toEqual({ kind: 'project', projectId: 3 })
  })
})

describe('navToUrl', () => {
  it('serializes each state kind canonically', () => {
    expect(navToUrl({ kind: 'home' })).toBe('')
    expect(navToUrl({ kind: 'tab', view: 'projects' })).toBe('?view=projects')
    expect(navToUrl({ kind: 'project', projectId: 3 })).toBe('?project=3')
    expect(navToUrl({ kind: 'chat', projectId: 3, chatId: 12 })).toBe('?project=3&chat=12')
    expect(navToUrl({ kind: 'chat', projectId: null, chatId: 12 })).toBe('?chat=12')
  })

  it('round-trips: parse(serialize(state)) is identical', () => {
    const states: NavState[] = [
      { kind: 'home' },
      { kind: 'tab', view: 'images' },
      { kind: 'project', projectId: 7 },
      { kind: 'chat', projectId: 7, chatId: 42 },
      { kind: 'chat', projectId: null, chatId: 42 },
    ]
    for (const s of states) expect(parseNavUrl(navToUrl(s))).toEqual(s)
  })

  it('canonicalizes messy input: serialize(parse(x)) is stable', () => {
    const messy = ['?foo=bar&project=3', '?chat=12&view=projects', '?view=bogus', 'project=3&chat=12']
    for (const m of messy) {
      const canonical = navToUrl(parseNavUrl(m))
      expect(navToUrl(parseNavUrl(canonical))).toBe(canonical)
    }
  })
})
