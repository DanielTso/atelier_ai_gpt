# Authentication — Access Gate

_Last updated: 2026-11-13. How the app is protected, how it was set up, and how to operate it._

## What it is

Atelier Studio is a **single-user** app (all projects/chats/documents are global — there is no per-user data separation). To keep the public deployment from being hit by strangers (and to stop anyone burning the Anthropic/Gemini API keys), it uses a **lightweight single-password access gate** rather than full per-user authentication.

- One shared password protects the whole app.
- Implemented in code (shipped v4.11.0): `src/proxy.ts` (formerly `src/middleware.ts` — renamed for Next 16's proxy convention), `src/app/login/page.tsx`, `src/app/api/auth/route.ts`, `src/lib/auth.ts`.
- **The gate is OFF unless `APP_ACCESS_PASSWORD` is set.** With no env var, the app behaves exactly as before (open) — so it is safe to deploy without breaking anything.

## How it works

1. `src/proxy.ts` runs on every request except Next internals (`_next/static`, `_next/image`, `favicon.ico`), which its matcher skips. (Files in `public/` are gated too — none are needed pre-auth.) Three paths are exempt from the cookie check:
   - `/login` for **GET and HEAD only**. Any other method without a valid cookie gets `401`: a POST to a page route enters Next's Server Action handler, which must not run before authentication.
   - `/api/auth`, so the login form can post the password.
   - `/api/files/raw`, the generated-image proxy that sandboxed HTML-artifact iframes load without cookies. It enforces its own HMAC path signature instead (`signFilePath` / `verifyFilePathSig` in `src/lib/auth.ts`, keyed by `AUTH_SECRET` only, never the password).
2. If `APP_ACCESS_PASSWORD` is not set → gate disabled, all requests pass.
3. If set **in production without `AUTH_SECRET`** → the proxy answers `503` on every path (exempt paths included), `POST /api/auth` refuses too, and the server logs one error naming `AUTH_SECRET` (no secret values). See the environment table below.
4. Otherwise the request must carry a valid `atelier_auth` cookie. Missing/invalid/**expired** →
   - API routes get `401 JSON`,
   - page routes redirect to `/login`.
5. `/login` posts the password to `POST /api/auth`, which compares HMAC digests of the submitted and real password (constant-time, fixed-length so the password length is never leaked) and, on success, sets a signed httpOnly cookie. Attempts are **rate-limited per client IP** (best-effort in-memory, `src/lib/rateLimit.ts`): each attempt is reserved synchronously before the route awaits anything, so a parallel burst cannot slip past the count; `LOGIN_MAX_ATTEMPTS`=10 attempts within a 15-minute window → `429` with `Retry-After`; a successful login clears the count; each wrong password adds a small delay. The key is the **rightmost** `X-Forwarded-For` hop (the one the proxy appended), falling back to `x-real-ip`. The limiter is per instance, so **add a Vercel WAF rate-limit rule on `POST /api/auth`** — that is the only control that holds across instances.
6. After login, the page returns to `?next=` only when it resolves to the app's own origin (`safeNextPath` in `src/lib/safeNext.ts` resolves the URL first, then compares origins; values with control characters are refused). Anything else goes to `/`.
7. The cookie value is `base64url({exp,n}).HMAC-SHA256(AUTH_SECRET, payload)` — a signed **expiry** (`exp`, unix seconds, 30-day default) and a random **nonce** (`n`) so the cookie expires server-side and each issued cookie is unique. The password itself is never stored in the cookie. `DELETE /api/auth` clears it (logout). _(The earlier static `HMAC(secret, "atelier-authed-v1")` format had no server-side expiry; upgrading invalidates old cookies, so everyone re-logs-in once.)_

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `APP_ACCESS_PASSWORD` | to enable the gate | The shared password. Setting it turns the gate ON. |
| `AUTH_SECRET` | **required in production** when the gate is on | HMAC key that signs the cookie and the `/api/files/raw` image signatures. Use `openssl rand -hex 32`. **Production** (`NODE_ENV=production`) with the gate on and no `AUTH_SECRET` → every request returns `503` and the server logs one error. **Local dev** without it: the cookie falls back to being signed with the password (one-time warning), and generated images in HTML artifacts do not load, because file signatures never use the password. |

## Status — ACTIVE in production (2026-06-21)

The gate is **live** on `https://atelier-ai-app.vercel.app`.

- **Vercel** (project `atelier-ai`, prod alias `atelier-ai-app.vercel.app`): `APP_ACCESS_PASSWORD` (owner's password) + `AUTH_SECRET` (generated `openssl rand -hex 32`) are set on **Production + Preview**; production was redeployed. Verified: `/` → 307→`/login`, `/api/models` → 401 unauthenticated, correct password → 200 + httpOnly cookie.
- **Local dev** (`.env.local`, gitignored): both vars set, password matches production.
- Set up via the Vercel CLI (`vercel env add` + `vercel redeploy`); the CLI is now installed and the repo is linked to `danieltsos-projects/atelier-ai`.

## Re-activate / set on another environment (Vercel)

1. Vercel → project `atelier-ai` → **Settings → Environment Variables**.
2. Add (Production, and Preview if you want it gated too):
   - `APP_ACCESS_PASSWORD` = a strong password you choose
   - `AUTH_SECRET` = a long random string, e.g. `openssl rand -hex 32`
3. **Redeploy** (Deployments → ⋯ → Redeploy, or `vercel redeploy atelier-ai-app.vercel.app`).

To verify: open the production URL in a private window → you should be redirected to `/login`; entering the password lets you in.

## Operating it

- **Disable the gate:** remove `APP_ACCESS_PASSWORD` (local: delete the line in `.env.local`; prod: delete the Vercel var) and redeploy.
- **Rotate the password:** change `APP_ACCESS_PASSWORD` and redeploy. (Existing sessions stay valid until you also rotate `AUTH_SECRET`, which invalidates all cookies.)
- **Force everyone to re-login:** change `AUTH_SECRET`.

## When to upgrade to real auth (Clerk)

The shared gate is right while this is **your** tool. If you ever want **multiple people with their own separate projects/data**, that's a different feature:

- Add Clerk (native Vercel Marketplace integration) for sign-in — the easy part.
- The real work is the **data model**: add an `ownerId` column to `projects` (and scope `chats`/`documents`/etc. through it), scope every server action + query by the signed-in user, and migrate existing rows to your account.

That is its own multi-phase project (brainstorm → spec → plan → build), not a drop-in. Until then, the gate is the correct, low-overhead solution.
