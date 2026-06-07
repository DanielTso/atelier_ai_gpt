export function apiError(
  error: unknown,
  publicMessage: string,
  status = 500,
  includeDetail = false
): Response {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[API Error] ${publicMessage}:`, detail)
  return new Response(
    JSON.stringify({ error: includeDetail ? `${publicMessage} ${detail}` : publicMessage }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
