// Post-login redirect target. Resolve first, then compare origins: prefix checks on the
// raw string are not enough, because the WHATWG URL parser strips tab, LF and CR, so
// '/<TAB>/evil.com' passes a "starts with / but not //" guard and then resolves to
// '//evil.com', another origin. The origin check alone is not enough either: a dot
// segment normalizes away after resolving, so '/.//evil.com' or '/x/..//evil.com' is
// same-origin but its pathname is '//evil.com', which router.replace() then resolves
// against location.href to another origin. So the returned path is refused when it starts
// with '//'. A backslash cannot survive in a special-scheme pathname (the parser turns it
// into '/'), so that one check covers it.

// Any C0 control character or DEL, raw or percent-encoded. A legitimate `next` (an app
// path like '/?chat=5') never contains one.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]|%(?:[01][0-9a-f]|7f)/i

/**
 * Returns `pathname + search + hash` of `next` when it resolves to `origin`, else '/'.
 * Never returns an absolute or protocol-relative URL.
 */
export function safeNextPath(next: string | null, origin: string): string {
  if (!next || CONTROL_CHARS.test(next)) return '/'
  try {
    const u = new URL(next, origin)
    if (u.origin !== new URL(origin).origin) return '/'
    const path = u.pathname + u.search + u.hash
    return path.startsWith('//') ? '/' : path
  } catch {
    return '/'
  }
}
