import { randomUUID } from 'node:crypto'

/** URL/file-safe slug from a title (max 60 chars), falling back to 'artifact'. */
export function artifactSlug(title: string): string {
  return (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact').slice(0, 60)
}

/** uuid-keyed storage path for an artifact file (create + each new version). */
export function artifactStoragePath(projectId: number | null, title: string, ext: string): string {
  return `artifacts/${projectId ?? 'standalone'}/${randomUUID()}/${artifactSlug(title)}.${ext}`
}
