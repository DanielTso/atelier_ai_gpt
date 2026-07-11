import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, isAuthEnabled, verifyAuthCookie } from '@/lib/auth'

// Gate every route behind the single-password cookie when the gate is enabled
// (APP_ACCESS_PASSWORD set). /login and /api/auth stay public so the user can
// authenticate; static assets are excluded via the matcher below.
// Next 16 renamed the middleware convention to proxy (runtime is Node — fine here:
// the cookie check uses Web Crypto, nothing edge-only).
export async function proxy(req: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next()

  const { pathname } = req.nextUrl
  if (pathname === '/login' || pathname === '/api/auth') return NextResponse.next()
  // Generated-image proxy: consumed from sandboxed artifact iframes (opaque origin —
  // no cookies possible). The route enforces its own HMAC capability signature
  // (verifyFilePathSig), so exempting it from the cookie gate does not open it.
  if (pathname === '/api/files/raw') return NextResponse.next()

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value
  if (await verifyAuthCookie(cookie)) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Preserve the originally requested path so login can return the user there. Only a
  // same-origin RELATIVE path is encoded (validated again on the login page) so this can
  // never be turned into an open redirect.
  const dest = req.nextUrl.pathname + req.nextUrl.search
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = isSafeRelativePath(dest) && dest !== '/' ? `?next=${encodeURIComponent(dest)}` : ''
  return NextResponse.redirect(url)
}

// Same-origin relative path only: must start with a single '/', not '//host' (protocol-
// relative) nor '/\' — so it can't redirect off-origin.
function isSafeRelativePath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\')
}

export const config = {
  // Run on everything except Next internals (build assets, image optimizer) and the
  // favicon. The previous matcher also excluded ANY path ending in an image extension
  // (.svg/.png/…), which was a latent gate bypass: a future route ending in one of
  // those would have been reachable unauthenticated. Scoping the exclusion to known
  // Next prefixes closes that hole. (Files in public/ are now gated too, but none are
  // needed pre-auth — the login page references no static assets.)
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
