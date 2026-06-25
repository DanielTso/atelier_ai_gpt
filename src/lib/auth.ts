// Lightweight single-password access gate. Runtime-agnostic (Web Crypto + manual
// constant-time compare) so it works in both Edge middleware and Node routes.
// The gate is OFF unless APP_ACCESS_PASSWORD is set — so deploys/local dev keep
// working until the operator opts in by setting the env var.

export const AUTH_COOKIE_NAME = 'atelier_auth'

const enc = new TextEncoder()

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_ACCESS_PASSWORD)
}

// AUTH_SECRET signs the cookie; fall back to the password so a single env var
// is enough to turn the gate on. Falling back is a weak config — the cookie is
// then signed with the low-entropy human password — so warn once when it happens.
let warnedNoSecret = false
function authSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret) return secret
  const password = process.env.APP_ACCESS_PASSWORD
  if (password) {
    if (!warnedNoSecret) {
      warnedNoSecret = true
      console.warn(
        '[auth] APP_ACCESS_PASSWORD is set but AUTH_SECRET is not — the access cookie is ' +
        'being signed with the password itself (low-entropy key, two secrets collapsed into one). ' +
        'Set AUTH_SECRET to a high-entropy value (openssl rand -hex 32) in any real deployment.'
      )
    }
    return password
  }
  return ''
}

function toHex(buf: ArrayBuffer): string {
  let s = ''
  for (const byte of new Uint8Array(buf)) s += byte.toString(16).padStart(2, '0')
  return s
}

// Length-independent constant-time string compare (avoids leaking length via
// early return only after the cheap length check, which is not secret here).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Opaque cookie value = HMAC-SHA256(secret, fixed-message). Never the password itself. */
export async function authToken(): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(authSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('atelier-authed-v1'))
  return toHex(sig)
}

export async function verifyAuthCookie(value: string | undefined | null): Promise<boolean> {
  if (!value || !isAuthEnabled()) return false
  return safeEqual(value, await authToken())
}

export function checkPassword(submitted: string): boolean {
  const pw = process.env.APP_ACCESS_PASSWORD || ''
  if (!pw) return false
  return safeEqual(submitted, pw)
}
