import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    globals: true,
    // PGlite's WASM + `vector` extension can take ~12–15s to initialize on a
    // cold/slow runner; createTestDb() runs in beforeEach, so raise the hook
    // timeout above the default 10s to avoid flaky CI timeouts.
    hookTimeout: 30000,
  },
})
