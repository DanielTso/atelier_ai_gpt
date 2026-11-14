/**
 * The user-facing message for a failed fetch. Our routes answer errors with
 * `{ error }` JSON, but the platform does not: Vercel rejects an oversized body
 * (413) or a timed-out function (504) with an HTML/text page before our code
 * runs, and `res.json()` throws on it. Never let that surface as a JSON parse
 * error or a generic failure.
 */
export async function readError(res: Response, fallback?: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null)
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
  if (typeof error === 'string' && error) return error
  if (res.status === 413) return 'File too large for upload'
  return fallback ?? `Request failed (${res.status})`
}
