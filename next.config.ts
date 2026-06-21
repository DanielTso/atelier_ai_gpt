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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
