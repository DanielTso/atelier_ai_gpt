'use client'

import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app error boundary]', error)
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="glass-panel w-full max-w-md rounded-2xl p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. You can try again — your data is safe.
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
