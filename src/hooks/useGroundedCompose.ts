'use client'

import { useCallback, useRef, useState } from 'react'

// Grounded-pill state for the composer. Mirrors the `composePersonaPickedRef`
// precedence guard in page.tsx: a manual pill toggle during a compose session
// WINS over an async persona/default load that would otherwise revert it.
//
// - toggle()               — user clicks the pill; records the pick and flips.
// - resetPick()            — a fresh compose session begins; clear the guard.
// - applyPersonaDefault(b) — a persona was selected / defaults loaded; adopt its
//                            grounded default UNLESS the user toggled this compose.
export function useGroundedCompose(defaultGrounded: boolean) {
  const [grounded, setGrounded] = useState(defaultGrounded)
  const pickedRef = useRef(false)

  const toggle = useCallback(() => {
    pickedRef.current = true
    setGrounded(g => !g)
  }, [])

  const resetPick = useCallback(() => {
    pickedRef.current = false
  }, [])

  const applyPersonaDefault = useCallback((personaGrounded: boolean) => {
    if (!pickedRef.current) setGrounded(personaGrounded)
  }, [])

  return { grounded, toggle, resetPick, applyPersonaDefault }
}
