import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'atelier-files'

// Module-level cache is intentional: Storage credentials come ONLY from process.env
// (unlike the AI keys, which are DB-overridable and therefore built per-request). Env
// changes already require a redeploy/restart, so caching the client never serves a
// stale runtime config here.
let cached: SupabaseClient | null = null

export function isStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function bucket() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase Storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).')
  }
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false } })
  return cached.storage.from(BUCKET)
}

export const storageBucketName = BUCKET

// Sanitize a user-supplied filename for use as a single storage path segment:
// strip path/special chars and collapse an all-dots name (".", "..") so it can
// never normalize to a parent prefix. Shared by upload-url + process (which
// derives the same path server-side rather than trusting the client).
export function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
}

export async function createSignedUploadUrl(path: string, opts: { upsert?: boolean } = {}): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: opts.upsert ?? false })
  if (error || !data) throw error ?? new Error('Failed to create signed upload URL')
  return { path: data.path, token: data.token }
}

export async function uploadBuffer(path: string, buffer: Buffer, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, buffer, { contentType, upsert: true })
  if (error) throw error
}

export async function downloadToBuffer(path: string): Promise<Buffer> {
  const { data, error } = await bucket().download(path)
  if (error || !data) throw error ?? new Error('Failed to download object')
  return Buffer.from(await data.arrayBuffer())
}

// Download links that sit in the UI (artifact cards, the artifact workspace) need a
// generous TTL — a short one expires before the user clicks (Supabase returns an
// "exp claim" InvalidJWT error). Matches the chat-attachment TTL.
export const ARTIFACT_URL_TTL_SECONDS = 24 * 60 * 60 // 24h

// Document originals/thumbnails are listed in the grid and clicked minutes later (and
// a PDF preview iframe can re-request byte ranges), so the 300s default expires too
// soon and Supabase returns an "exp claim" InvalidJWT error. Use a generous TTL like
// artifacts. (The 300s default below stays for short-lived one-off links.)
export const DOCUMENT_URL_TTL_SECONDS = 60 * 60 // 1h

export async function createSignedDownloadUrl(path: string, ttlSeconds = 300): Promise<string> {
  // Force an attachment disposition for HTML artifacts so Supabase serves them as a
  // download (Content-Disposition: attachment) rather than rendering model-generated
  // HTML/JS inline on the *.supabase.co origin. The in-app live preview uses a sandboxed
  // <iframe srcDoc> with the source content, so it is unaffected. PDFs (previewed inline
  // via the signed URL) and binaries are left inline.
  const options = path.toLowerCase().endsWith('.html') ? { download: true } : undefined
  const { data, error } = await bucket().createSignedUrl(path, ttlSeconds, options)
  if (error || !data) throw error ?? new Error('Failed to create signed URL')
  return data.signedUrl
}

/**
 * Sign a possibly-null artifact storage path with the artifact TTL, swallowing failures
 * to null. Centralizes the `path ? createSignedDownloadUrl(path, ARTIFACT_URL_TTL_SECONDS)
 * .catch(() => null) : null` pattern duplicated across the artifact read/version/edit/
 * regenerate paths, so the TTL and error policy live in one place.
 */
export async function signedArtifactUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  return createSignedDownloadUrl(path, ARTIFACT_URL_TTL_SECONDS).catch(() => null)
}

/**
 * Batch-sign many storage paths in ONE Supabase request (vs N round-trips).
 * Returns a Map<path, signedUrl>; paths that fail/return no URL are simply absent
 * (callers default to null). Empty input short-circuits with no network call.
 */
export async function createSignedDownloadUrls(
  paths: string[],
  ttlSeconds = 300,
  opts?: { download?: boolean },
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const valid = [...new Set(paths.filter(Boolean))]
  if (valid.length === 0) return out
  const { data, error } = await bucket().createSignedUrls(valid, ttlSeconds, opts?.download ? { download: true } : undefined)
  if (error || !data) return out
  for (const item of data) {
    if (item?.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl)
  }
  return out
}

/**
 * Batch variant of signedArtifactUrl: signs many artifact paths with the artifact TTL,
 * splitting HTML (forced download disposition — security: never render model HTML inline
 * on the supabase origin) from the rest into two batch calls. Returns Map<path, url>.
 */
export async function signedArtifactUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const valid = paths.filter((p): p is string => Boolean(p))
  const html = valid.filter(p => p.toLowerCase().endsWith('.html'))
  const other = valid.filter(p => !p.toLowerCase().endsWith('.html'))
  const [htmlMap, otherMap] = await Promise.all([
    createSignedDownloadUrls(html, ARTIFACT_URL_TTL_SECONDS, { download: true }),
    createSignedDownloadUrls(other, ARTIFACT_URL_TTL_SECONDS),
  ])
  return new Map([...htmlMap, ...otherMap])
}

export async function removeObjects(paths: string[]): Promise<void> {
  const valid = paths.filter(Boolean)
  if (valid.length === 0) return
  const { error } = await bucket().remove(valid)
  if (error) throw error
}
