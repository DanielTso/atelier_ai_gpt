// Lightweight single-password access gate. Runtime-agnostic (Web Crypto + manual
// constant-time compare) so it works in both Edge middleware and Node routes.
// The gate is OFF unless APP_ACCESS_PASSWORD is set — so deploys/local dev keep
// working until the operator opts in by setting the env var.

export const AUTH_COOKIE_NAME = 'atelier_auth'

// Default cookie lifetime. The expiry is signed INTO the cookie (see mintAuthToken),
// so it is enforced server-side — not just an advisory client-side maxAge.
export const AUTH_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

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

// Constant-time compare. The early length check is safe here because every value
// compared is a fixed-length hex digest (HMAC output / hashed password), so the
// length itself reveals nothing secret.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// URL-safe base64 for the small ASCII JSON payload (works in both Edge and Node via
// the global btoa/atob).
function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(authSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return toHex(sig)
}

function randomNonceHex(bytes = 16): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += b.toString(16).padStart(2, '0')
  return s
}

/**
 * Mint a signed access cookie: `base64url({exp,n}).HMAC-SHA256(secret, payload)`.
 * The expiry (`exp`, unix seconds) and a random nonce (`n`) are signed into the
 * payload, so the cookie expires server-side and each issued cookie is unique —
 * unlike a static HMAC of a fixed string. Never contains the password itself.
 */
export async function mintAuthToken(ttlSeconds = AUTH_TTL_SECONDS): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = b64urlEncode(JSON.stringify({ exp, n: randomNonceHex() }))
  const sig = await hmacHex(payload)
  return `${payload}.${sig}`
}

export async function verifyAuthCookie(value: string | undefined | null): Promise<boolean> {
  if (!value || !isAuthEnabled()) return false
  const dot = value.indexOf('.')
  if (dot <= 0 || dot === value.length - 1) return false
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  // Verify the signature (constant-time) before trusting any payload bytes.
  if (!safeEqual(sig, await hmacHex(payload))) return false
  let parsed: { exp?: unknown }
  try {
    parsed = JSON.parse(b64urlDecode(payload))
  } catch {
    return false
  }
  return typeof parsed.exp === 'number' && parsed.exp > Math.floor(Date.now() / 1000)
}

// Compare HMAC digests of both sides (fixed 64-hex length, collision-resistant) so the
// constant-time compare never observes the password length — closes the length
// side-channel without the collision risk of a non-cryptographic length-normalizer.
export async function checkPassword(submitted: string): Promise<boolean> {
  const pw = process.env.APP_ACCESS_PASSWORD || ''
  if (!pw) return false
  return safeEqual(await hmacHex(submitted), await hmacHex(pw))
}
