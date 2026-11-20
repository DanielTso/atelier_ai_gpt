import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

type VercelConfig = {
  functions?: Record<string, { supportsCancellation?: boolean }>
}

function loadConfig(): VercelConfig {
  const raw = readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
  return JSON.parse(raw) as VercelConfig
}

describe('vercel.json', () => {
  it('parses as JSON', () => {
    expect(() => loadConfig()).not.toThrow()
  })

  it('only lists function paths that exist in the repo', () => {
    const functions = loadConfig().functions ?? {}
    for (const key of Object.keys(functions)) {
      expect(existsSync(path.join(process.cwd(), key)), key).toBe(true)
    }
  })

  it('enables request cancellation for the chat route', () => {
    const functions = loadConfig().functions ?? {}
    expect(functions['src/app/api/chat/route.ts']?.supportsCancellation).toBe(true)
  })
})
