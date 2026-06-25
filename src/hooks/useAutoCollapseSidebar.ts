import { useEffect, useRef, type RefObject } from 'react'

/**
 * Auto-collapse the sidebar when a wide artifact panel would cramp the content, and
 * restore it when the panel narrows or the artifact closes. Keyed only on (active,
 * panelWidth) — NOT on the collapsed state — so it reacts to drags without fighting a
 * manual sidebar toggle, and it only ever auto-restores what it auto-collapsed.
 *
 * Used in two places that each own an artifact panel: the chat workspace (page.tsx) and
 * the artifacts gallery (ArtifactsView). `sidebarCollapsedRef` lets it read the current
 * collapsed state without re-running on every toggle.
 */
export function useAutoCollapseSidebar(opts: {
  active: boolean
  panelWidth: number
  sidebarCollapsedRef: RefObject<boolean>
  setSidebarCollapsed: (v: boolean) => void
}) {
  const { active, panelWidth, sidebarCollapsedRef, setSidebarCollapsed } = opts
  const autoCollapsedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!active) {
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false
        setSidebarCollapsed(false)
      }
      return
    }
    // "Cramped" = the content column would be narrower than ~520px with the sidebar open.
    const SIDEBAR_W = 288
    const cramped = window.innerWidth - SIDEBAR_W - panelWidth < 520
    if (cramped && !sidebarCollapsedRef.current) {
      autoCollapsedRef.current = true
      setSidebarCollapsed(true)
    } else if (!cramped && autoCollapsedRef.current) {
      autoCollapsedRef.current = false
      setSidebarCollapsed(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, panelWidth])

  // If we auto-collapsed and this surface unmounts (e.g. navigating away from the gallery
  // with the panel still open), restore the sidebar so it isn't left stuck collapsed.
  useEffect(() => () => {
    if (autoCollapsedRef.current) {
      autoCollapsedRef.current = false
      setSidebarCollapsed(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
