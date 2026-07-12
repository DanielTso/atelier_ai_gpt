// Pure serialize/parse for the app's URL-addressable navigation state. No React,
// no DOM — useUrlNavSync owns the History API mechanics; this module owns the
// canonical mapping between a NavState and a query string. Kept pure so the URL
// scheme is unit-testable and has one source of truth (SaaS-forward: these params
// map mechanically onto route segments if the app ever adopts them).

export type NavTab = 'projects' | 'artifacts' | 'images'

export type NavState =
  | { kind: 'home' }
  | { kind: 'tab'; view: NavTab }
  | { kind: 'project'; projectId: number }
  | { kind: 'chat'; projectId: number | null; chatId: number }

const VALID_TABS = new Set<string>(['projects', 'artifacts', 'images'])

function parsePositiveInt(value: string | null): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Search string (leading '?' optional) → canonical NavState. Priority when several
 * params are present: chat > project > view > home — the most specific addressable
 * surface wins, so a stray ?view= next to ?chat= is ignored rather than fought over.
 * Invalid values (unknown views, non-positive ids) fall through to the next level. */
export function parseNavUrl(search: string): NavState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const chatId = parsePositiveInt(params.get('chat'))
  if (chatId != null) return { kind: 'chat', projectId: parsePositiveInt(params.get('project')), chatId }
  const projectId = parsePositiveInt(params.get('project'))
  if (projectId != null) return { kind: 'project', projectId }
  const view = params.get('view')
  if (view && VALID_TABS.has(view)) return { kind: 'tab', view: view as NavTab }
  return { kind: 'home' }
}

/** NavState → canonical search string ('' for home, otherwise with leading '?'). */
export function navToUrl(state: NavState): string {
  switch (state.kind) {
    case 'home':
      return ''
    case 'tab':
      return `?view=${state.view}`
    case 'project':
      return `?project=${state.projectId}`
    case 'chat':
      return state.projectId != null
        ? `?project=${state.projectId}&chat=${state.chatId}`
        : `?chat=${state.chatId}`
  }
}
