export function apiError(error: unknown, publicMessage: string, status = 500): Response {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[API Error] ${publicMessage}:`, detail)
  return new Response(
    JSON.stringify({ error: publicMessage }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
