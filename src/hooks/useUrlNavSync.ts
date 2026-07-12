// Syncs page.tsx's navigation state (activeView / activeProjectId / activeChatId)
// with the browser URL + history, so the mouse back/forward buttons walk in-app
// views and deep links / refreshes restore where you were. Mechanics only: the
// hook observes state and owns pushState/replaceState/popstate; page.tsx owns WHY
// state changed (and signals the one special case via suppressNextPush). Uses the
// native History API on purpose — useSearchParams would force a Suspense boundary
// around the whole single-page app.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { navToUrl, parseNavUrl, type NavState } from '@/lib/navState'
import type { AppView } from '@/components/chat/sidebar/types'

export interface UseUrlNavSyncOpts {
  activeView: AppView
  activeProjectId: number | null
  activeChatId: number | null
  /** The active chat's OWN projectId from its loaded record — NOT raw
   * activeProjectId, which goes stale (selectView / the artifact gallery's
   * onOpenChat never clear it). `undefined` = record not loaded yet → fall back
   * to activeProjectId; `null` = definitively standalone. */
  currentChatProjectId: number | null | undefined
  setActiveView: (view: AppView) => void
  setActiveProjectId: (id: number | null) => void
  setActiveChatId: (id: number | null) => void
}

export interface UrlNavSync {
  /** Call right before nulling an id that came from a stale deep link (the
   * validation effect in page.tsx) — the resulting URL correction becomes a
   * replaceState instead of a pushState, so history gets no dead entry. */
  suppressNextPush: () => void
}

/** Mirrors page.tsx's render precedence (view tabs > chat > project > home) so the
 * URL never disagrees with what is on screen. */
function toNavState(
  view: AppView,
  activeProjectId: number | null,
  chatId: number | null,
  currentChatProjectId: number | null | undefined,
): NavState {
  if (view === 'projects' || view === 'artifacts' || view === 'images') return { kind: 'tab', view }
  if (chatId != null) {
    const projectId = currentChatProjectId !== undefined ? currentChatProjectId : activeProjectId
    return { kind: 'chat', projectId, chatId }
  }
  if (activeProjectId != null) return { kind: 'project', projectId: activeProjectId }
  return { kind: 'home' }
}

export function useUrlNavSync(opts: UseUrlNavSyncOpts): UrlNavSync {
  const {
    activeView, activeProjectId, activeChatId, currentChatProjectId,
    setActiveView, setActiveProjectId, setActiveChatId,
  } = opts

  // Last CANONICAL search string this hook accounted for — the dedupe baseline.
  const lastUrlRef = useRef<string | null>(null)
  // True while the next push-effect run reflects a popstate (the browser already
  // moved the address bar — pushing again would corrupt history).
  const isApplyingPopRef = useRef(false)
  const suppressNextPushRef = useRef(false)

  const suppressNextPush = useCallback(() => { suppressNextPushRef.current = true }, [])

  // Mount-time deep-link restore, pre-paint so a reload of ?project=3 doesn't
  // flash Home. Seeding lastUrlRef with the canonical form makes the first
  // push-effect run after restore a guaranteed no-op even if the raw URL had
  // stray params or a different param order.
  useLayoutEffect(() => {
    const initial = parseNavUrl(window.location.search)
    lastUrlRef.current = navToUrl(initial)
    switch (initial.kind) {
      case 'tab':
        setActiveView(initial.view)
        break
      case 'project':
        setActiveView('home')
        setActiveProjectId(initial.projectId)
        break
      case 'chat':
        setActiveView('home')
        setActiveProjectId(initial.projectId)
        setActiveChatId(initial.chatId)
        break
      case 'home':
        break
    }
    // Mount-only by design: the initial URL is read exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onPopState = () => {
      isApplyingPopRef.current = true
      const state = parseNavUrl(window.location.search)
      setActiveView(state.kind === 'tab' ? state.view : 'home')
      setActiveProjectId(state.kind === 'project' ? state.projectId : state.kind === 'chat' ? state.projectId : null)
      setActiveChatId(state.kind === 'chat' ? state.chatId : null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [setActiveView, setActiveProjectId, setActiveChatId])

  // Push on nav-state change. Deps are ONLY the four nav values — never message
  // or input state — so a push can only happen on a discrete navigation, and
  // React's batching keeps multi-setter handlers at one push per user action.
  useEffect(() => {
    const nextSearch = navToUrl(toNavState(activeView, activeProjectId, activeChatId, currentChatProjectId))
    if (lastUrlRef.current === nextSearch) return

    const url = window.location.pathname + nextSearch
    if (isApplyingPopRef.current) {
      isApplyingPopRef.current = false // the browser already moved the bar
    } else if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false
      window.history.replaceState(null, '', url)
    } else {
      window.history.pushState(null, '', url)
    }
    lastUrlRef.current = nextSearch
  }, [activeView, activeProjectId, activeChatId, currentChatProjectId])

  return { suppressNextPush }
}
