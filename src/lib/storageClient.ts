'use client'
import { createClient } from '@supabase/supabase-js'

let cached: ReturnType<typeof createClient> | null = null

/** Browser Supabase client (anon key) — used only for uploadToSignedUrl. */
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase browser env not set (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).')
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}
