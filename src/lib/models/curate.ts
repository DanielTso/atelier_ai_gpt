import type { CatalogModel } from './types'

// Dated snapshot ids (e.g. `claude-opus-4-1-20250805`) are excluded from the
// curated picker list — they stay routable elsewhere (LEGACY_PINS / a live
// catalog lookup by exact id), this only trims what's *offered* in the picker.
export const DATED_SNAPSHOT_RE = /-\d{8}$/

// Picker ordering for known families; anything else sorts after all of these.
export const FAMILY_DISPLAY_ORDER = ['opus', 'fable', 'sonnet', 'haiku'] as const

/** Lowercase family segment after `claude-`, e.g. `claude-opus-4-8` -> `opus`. Non-Claude / unrecognized ids -> `'other'`. */
export function parseFamily(modelId: string): string {
  const match = /^claude-([a-z]+)/.exec(modelId.toLowerCase())
  return match?.[1] ?? 'other'
}

function familyRank(family: string): number {
  const idx = (FAMILY_DISPLAY_ORDER as readonly string[]).indexOf(family)
  return idx === -1 ? FAMILY_DISPLAY_ORDER.length : idx
}

function byNewestFirst(a: CatalogModel, b: CatalogModel): number {
  const at = a.createdAt ? Date.parse(a.createdAt) : 0
  const bt = b.createdAt ? Date.parse(b.createdAt) : 0
  return bt - at
}

/**
 * Curate the raw/normalized catalog into the picker list:
 * - group by family
 * - within a family, prefer non-dated-snapshot ids, but fall back to dated
 *   entries if that would empty the family (a brand-new family sometimes only
 *   has dated snapshots before Anthropic ships a bare alias)
 * - keep only the single newest entry per family (by createdAt)
 * - order the result by FAMILY_DISPLAY_ORDER, then newest-first for any
 *   families not in that list (sorted last, together)
 */
export function curateCatalog(models: CatalogModel[]): CatalogModel[] {
  const byFamily = new Map<string, CatalogModel[]>()
  for (const model of models) {
    const list = byFamily.get(model.family) ?? []
    list.push(model)
    byFamily.set(model.family, list)
  }

  const curated: CatalogModel[] = []
  for (const list of byFamily.values()) {
    const undated = list.filter(m => !DATED_SNAPSHOT_RE.test(m.id))
    const pool = undated.length > 0 ? undated : list
    const [newest] = [...pool].sort(byNewestFirst)
    if (newest) curated.push(newest)
  }

  return curated.sort((a, b) => {
    const rankDiff = familyRank(a.family) - familyRank(b.family)
    return rankDiff !== 0 ? rankDiff : byNewestFirst(a, b)
  })
}
