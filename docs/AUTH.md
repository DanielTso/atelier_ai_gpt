# Authentication — Access Gate

_Last updated: 2026-06-25. How the app is protected, how it was set up, and how to operate it._

## What it is

Atelier Studio is a **single-user** app (all projects/chats/documents are global — there is no per-user data separation). To keep the public deployment from being hit by strangers (and to stop anyone burning the Anthropic/Gemini API keys), it uses a **lightweight single-password access gate** rather than full per-user authentication.

- One shared password protects the whole app.
- Implemented in code (shipped v4.11.0): `src/proxy.ts` (formerly `src/middleware.ts` — renamed for Next 16's proxy convention), `src/app/login/page.tsx`, `src/app/api/auth/route.ts`, `src/lib/auth.ts`.
- **The gate is OFF unless `APP_ACCESS_PASSWORD` is set.** With no env var, the app behaves exactly as before (open) — so it is safe to deploy without breaking anything.

## How it works

1. `src/proxy.ts` runs on every request except Next internals (`_next/static`, `_next/image`, `favicon.ico`), `/login`, and `/api/auth`. (Files in `public/` are gated too — none are needed pre-auth.)
2. If `APP_ACCESS_PASSWORD` is not set → gate disabled, all requests pass.
3. If set → the request must carry a valid `atelier_auth` cookie. Missing/invalid/**expired** →
   - API routes get `401 JSON`,
   - page routes redirect to `/login`.
4. `/login` posts the password to `POST /api/auth`, which compares HMAC digests of the submitted and real password (constant-time, fixed-length so the password length is never leaked) and, on success, sets a signed httpOnly cookie. Failed attempts are **rate-limited per client IP** (best-effort in-memory: `LOGIN_MAX_FAILURES`=10 within a 15-minute window → `429` with `Retry-After`, plus a small per-failure delay). For a hard guarantee across instances, add a Vercel WAF rate-limit rule on `/api/auth`.
5. The cookie value is `base64url({exp,n}).HMAC-SHA256(AUTH_SECRET, payload)` — a signed **expiry** (`exp`, unix seconds, 30-day default) and a random **nonce** (`n`) so the cookie expires server-side and each issued cookie is unique. The password itself is never stored in the cookie. `DELETE /api/auth` clears it (logout). _(The earlier static `HMAC(secret, "atelier-authed-v1")` format had no server-side expiry; upgrading invalidates old cookies, so everyone re-logs-in once.)_

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `APP_ACCESS_PASSWORD` | to enable the gate | The shared password. Setting it turns the gate ON. |
| `AUTH_SECRET` | strongly recommended | HMAC key that signs the cookie. If omitted, falls back to the password (still works, but the cookie is then signed with the low-entropy password and the server logs a one-time warning — set a separate `openssl rand -hex 32` value in any real deployment). |

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
