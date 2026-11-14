import { describe, it, expect } from 'vitest'
import { readError } from '@/lib/readError'

describe('readError', () => {
  it('returns the JSON error field when the body has one', async () => {
    const res = new Response(JSON.stringify({ error: 'Unsupported file type: a.exe.' }), { status: 400 })
    expect(await readError(res)).toBe('Unsupported file type: a.exe.')
  })

  // Vercel rejects an oversized body before the function runs, with an HTML/text
  // page — res.json() throws on it. That must read as a size problem, not as a
  // JSON parse error or a generic failure (handoff item 3).
  it('returns the size message for a non-JSON 413 body', async () => {
    const res = new Response('<html><body>Request Entity Too Large</body></html>', {
      status: 413, headers: { 'content-type': 'text/html' },
    })
    expect(await readError(res)).toBe('File too large for upload')
  })

  it('prefers the size message for a 413 JSON body without an error field', async () => {
    const res = new Response(JSON.stringify({ code: 'FUNCTION_PAYLOAD_TOO_LARGE' }), { status: 413 })
    expect(await readError(res)).toBe('File too large for upload')
  })

  it('falls back to the caller message, then to the status, for other non-JSON errors', async () => {
    const html = () => new Response('<html>Gateway Timeout</html>', { status: 504 })
    expect(await readError(html(), 'Failed to process plan.pdf')).toBe('Failed to process plan.pdf')
    expect(await readError(html())).toBe('Request failed (504)')
  })
})
