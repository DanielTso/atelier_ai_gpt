import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'atelier-files'

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

export async function removeObjects(paths: string[]): Promise<void> {
  const valid = paths.filter(Boolean)
  if (valid.length === 0) return
  const { error } = await bucket().remove(valid)
  if (error) throw error
}
