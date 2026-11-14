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

/**
 * Why the gate cannot run safely, or null when it can. In production the gate refuses
 * to run without AUTH_SECRET: the password fallback below would sign cookies and the
 * file-path signatures embedded in downloadable HTML artifacts with the low-entropy
 * password, turning every such `sig` into an offline cracking oracle. The proxy
 * answers 503 on every path while this is non-null. Never includes a secret value.
 */
export function authConfigError(): string | null {
  if (!isAuthEnabled()) return null
  if (process.env.NODE_ENV !== 'production') return null
  if (process.env.AUTH_SECRET) return null
  return '[auth] APP_ACCESS_PASSWORD is set but AUTH_SECRET is not. The access gate refuses ' +
    'to run in production without it; every request returns 503. Set AUTH_SECRET to a ' +
    'high-entropy value (openssl rand -hex 32) and redeploy.'
}

let loggedConfigError = false
/** authConfigError(), logging it once per process when it is non-null. */
export function checkAuthConfig(): string | null {
  const err = authConfigError()
  if (err && !loggedConfigError) {
    loggedConfigError = true
    console.error(err)
  }
  return err
}

// AUTH_SECRET signs the cookie; outside production, fall back to the password so a
// single env var is enough to turn the gate on locally. Falling back is a weak config —
// the cookie is then signed with the low-entropy human password — so warn once when it
// happens. Production refuses this config (authConfigError). File-path signatures never
// use the fallback (see signFilePath).
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
        'Generated images in HTML artifacts will not load. Production refuses this config: ' +
        'set AUTH_SECRET to a high-entropy value (openssl rand -hex 32).'
      )
    }
    return password
  }
  return ''
}

/** Test-only: re-arm the one-time auth config log and warning. */
export function _resetAuthWarnings(): void {
  loggedConfigError = false
  warnedNoSecret = false
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

async function hmacHex(message: string, secret: string = authSecret()): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
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

/**
 * Stable HMAC capability signature for a generated-file storage path. HTML artifacts
 * embed images via /api/files/raw, but their sandboxed preview iframe runs on an
 * opaque origin and cannot send the auth cookie — so that route sits outside the
 * cookie gate and enforces THIS signature instead: unforgeable without the secret,
 * deliberately non-expiring (the URL lives inside permanent artifact HTML).
 * Domain-separated from the cookie HMAC by the `file:` prefix.
 *
 * Keyed by AUTH_SECRET ONLY — never the password fallback. These signatures ship inside
 * HTML artifacts the owner downloads and shares, so a password-keyed `sig` would let
 * anyone holding one test password guesses offline.
 */
export async function signFilePath(path: string): Promise<string> {
  // No AUTH_SECRET → nothing safe to sign with (and Web Crypto rejects empty HMAC keys).
  // With the gate off the route accepts any signature; with it on, it refuses them all.
  const secret = process.env.AUTH_SECRET
  if (!secret) return ''
  return hmacHex(`file:${path}`, secret)
}

export async function verifyFilePathSig(path: string, sig: string | null | undefined): Promise<boolean> {
  if (!isAuthEnabled()) return true // gate off → open, matching every other route
  const secret = process.env.AUTH_SECRET
  if (!sig || !secret) return false // fail closed: no password-keyed fallback
  return safeEqual(sig, await hmacHex(`file:${path}`, secret))
}

// Compare HMAC digests of both sides (fixed 64-hex length, collision-resistant) so the
// constant-time compare never observes the password length — closes the length
// side-channel without the collision risk of a non-cryptographic length-normalizer.
export async function checkPassword(submitted: string): Promise<boolean> {
  const pw = process.env.APP_ACCESS_PASSWORD || ''
  if (!pw) return false
  return safeEqual(await hmacHex(submitted), await hmacHex(pw))
}
