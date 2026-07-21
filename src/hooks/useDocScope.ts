'use client'

import { useCallback } from 'react'
import { useLocalStorage } from '@/hooks/useLocalStorage'

// Project-level source scoping (Task 9 review F1 amendment, 2026-07-21): excluded
// document ids persist per PROJECT, not per chat — the scoping surface (the Files
// checkboxes in ProjectContextRail) lives on the project landing page, so the
// originally-spec'd per-chat key shipped as an inert session-global bucket. True
// per-chat scoping + a mid-chat scoping surface are spec follow-ups.
//
// The scope key derives from the ACTIVE project context: inside a chat, the chat's
// OWN projectId (activeProjectId goes stale when a chat is opened from the artifact
// gallery or sidebar — the useUrlNavSync precedent); on the landing page, the active
// project. No project on either side → 'none': exclusions read as [] and are never
// written. Legacy 'chat-doc-scope-*' localStorage entries are deliberately not read.
export type ScopeProjectId = number | 'none'

export function scopeProjectIdFor(
  currentChatProjectId: number | null | undefined,
  activeProjectId: number | null,
): ScopeProjectId {
  return currentChatProjectId ?? activeProjectId ?? 'none'
}

const NO_EXCLUSIONS: number[] = []

export function useDocScope(scopeProjectId: ScopeProjectId) {
  const [stored, setStored] = useLocalStorage<number[]>(
    'project-doc-scope-' + scopeProjectId,
    NO_EXCLUSIONS,
    v => Array.isArray(v) && v.every(x => typeof x === 'number'),
  )
  const scopeless = scopeProjectId === 'none'
  const excludedDocIds = scopeless ? NO_EXCLUSIONS : stored
  const setExcludedDocIds = useCallback(
    (ids: number[]) => {
      // Projectless context: the excluded list is always [] and never persisted.
      if (scopeless) return
      setStored(ids)
    },
    [scopeless, setStored],
  )
  return { excludedDocIds, setExcludedDocIds }
}
