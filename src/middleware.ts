import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, isAuthEnabled, verifyAuthCookie } from '@/lib/auth'

// Gate every route behind the single-password cookie when the gate is enabled
// (APP_ACCESS_PASSWORD set). /login and /api/auth stay public so the user can
// authenticate; static assets are excluded via the matcher below.
export async function middleware(req: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next()

  const { pathname } = req.nextUrl
  if (pathname === '/login' || pathname === '/api/auth') return NextResponse.next()

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value
  if (await verifyAuthCookie(cookie)) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
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
