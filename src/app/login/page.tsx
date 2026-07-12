'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        // Return to the originally requested page if the middleware passed a safe
        // same-origin `next` path; otherwise go home. Re-validate it here too —
        // including '/\': browsers normalize backslash to slash, so '/\evil.com'
        // becomes protocol-relative '//evil.com' (same guard as proxy.ts).
        const next = new URLSearchParams(window.location.search).get('next')
        const dest = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
        router.replace(dest)
        router.refresh()
      } else {
        setError((await res.json().catch(() => ({}))).error || 'Incorrect password')
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={onSubmit} className="glass-panel w-full max-w-sm rounded-2xl p-8">
        <h1 className="text-lg font-semibold text-foreground">Atelier Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the access password to continue.</p>
        <input
          type="password"
          aria-label="Access password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="mt-5 w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Password"
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </main>
  )
}
