import type { NextConfig } from "next";
import path from "node:path";

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
};

export default nextConfig;
