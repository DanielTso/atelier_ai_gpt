'use client'

// global-error replaces the root layout, so it must render its own <html>/<body>.
// This only fires for errors thrown in the root layout itself; route-level errors
// are handled by error.tsx.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#6F7781', marginTop: 8 }}>
              The app hit an unexpected error{error?.digest ? ` (ref ${error.digest})` : ''}. Please try again.
            </p>
            <button
              onClick={reset}
              style={{ marginTop: 20, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#4F7396', color: '#fff', fontSize: 14, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
