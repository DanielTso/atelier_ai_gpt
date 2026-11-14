import type { NextConfig } from "next";
import path from "node:path";
import { buildSecurityHeaders } from "./src/lib/securityHeaders";

// Supabase origin (signed image/PDF URLs + the storage iframe) — scope CSP to it
// when known, else allow https: so the app keeps working if the env var is absent.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
let supabaseOrigin = "";
try {
  if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin;
} catch {
  supabaseOrigin = "";
}

const securityHeaders = buildSecurityHeaders(supabaseOrigin || null);

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
