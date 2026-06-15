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

export async function createSignedUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true })
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

export async function createSignedDownloadUrl(path: string, ttlSeconds = 3600): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, ttlSeconds)
  if (error || !data) throw error ?? new Error('Failed to create signed URL')
  return data.signedUrl
}

export async function removeObjects(paths: string[]): Promise<void> {
  const valid = paths.filter(Boolean)
  if (valid.length === 0) return
  const { error } = await bucket().remove(valid)
  if (error) throw error
}
