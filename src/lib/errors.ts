export function apiError(
  error: unknown,
  publicMessage: string,
  status = 500,
  includeDetail = false
): Response {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[API Error] ${publicMessage}:`, detail)
  // Never leak raw exception detail to clients in production (paths, driver/bucket
  // internals, etc.) — log it server-side, return only the public message. The
  // `includeDetail` opt-in is honored only in dev for easier local debugging.
  const exposeDetail = includeDetail && process.env.NODE_ENV !== 'production'
  return new Response(
    JSON.stringify({ error: exposeDetail ? `${publicMessage} ${detail}` : publicMessage }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
