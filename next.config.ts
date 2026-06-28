import type { NextConfig } from "next";
import path from "node:path";

// Supabase origin (signed image/PDF URLs + the storage iframe) — scope CSP to it
// when known, else allow https: so the app keeps working if the env var is absent.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
let supabaseOrigin = "";
try {
  if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin;
} catch {
  supabaseOrigin = "";
}

const isDev = process.env.NODE_ENV !== "production";
const imgFrame = supabaseOrigin || "https:";

// Next's App Router injects inline scripts/styles (hydration data, streaming) and
// has no nonce pipeline configured here, so 'unsafe-inline' is required. 'unsafe-eval'
// is dev-only (React Refresh). Images allow data:/blob: for AI-generated images.
//
// SECURITY TRADEOFF (accepted): 'unsafe-inline' on script-src weakens CSP as an XSS
// backstop for the top-level origin. This is accepted for now because (a) the app is
// single-user and password-gated (no untrusted authors), and (b) the one surface that
// runs untrusted/model-generated HTML — the artifact preview — is isolated in an
// iframe with sandbox="allow-scripts" and NO allow-same-origin, so it executes on an
// opaque origin and cannot reach app cookies/storage (see ArtifactPreview.tsx).
//
// NONCE PIPELINE ATTEMPTED & REVERTED (2026-06-27): the standard Next 16 middleware
// nonce + script-src 'nonce-…' 'strict-dynamic' was implemented and browser-verified
// against a prod build — Next did NOT stamp the nonce onto its bootstrap/chunk inline
// scripts (Turbopack build nonce-propagation gap), so 'strict-dynamic' blocked all JS
// and the page failed to hydrate. Dropping 'unsafe-inline' here needs either a
// non-Turbopack build or a hash-based CSP — out of scope for a cleanup. Keeping
// 'unsafe-inline' (the tradeoff above) until then.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imgFrame}`,
  "font-src 'self' data:",
  "connect-src 'self' https:",
  `frame-src 'self' ${imgFrame}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // @napi-rs/canvas ships a native .node binding that can't be bundled into an
  // ESM server chunk (Turbopack: "non-ecmascript placeable asset"). Keep it (and
  // the pdf render stack that loads it) as a runtime require from node_modules.
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist', 'unpdf'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async headers() {
    return [
      // The artifact file proxy (/api/artifacts/:id/raw) serves a PDF that the in-app
      // preview embeds in a same-origin <iframe>. It therefore must NOT carry the global
      // X-Frame-Options: DENY (which blocks even same-origin framing) — it gets SAMEORIGIN
      // + frame-ancestors 'self' instead. It serves bytes only (never app HTML).
      {
        source: "/api/artifacts/:id/raw",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // Everything else gets the strict security headers (excludes the proxy above so
      // its SAMEORIGIN isn't overridden by the global DENY).
      { source: "/((?!api/artifacts/[^/]+/raw).*)", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
