export type ArtifactTypeFilter = 'all' | 'html' | 'pdf' | 'xlsx' | 'docx' | 'pptx' | 'code'

export function filterArtifacts<
  T extends { title: string; type: string; chatTitle?: string | null; projectName?: string | null },
>(list: T[], opts: { query: string; type: ArtifactTypeFilter }): T[] {
  const q = opts.query.trim().toLowerCase()
  return list.filter((a) => {
    if (opts.type !== 'all' && a.type !== opts.type) return false
    if (!q) return true
    const haystack = `${a.title} ${a.chatTitle ?? ''} ${a.projectName ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
}
