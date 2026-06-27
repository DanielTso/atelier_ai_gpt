'use client'
import { useState, useCallback } from 'react'
import type { DocumentSummary } from '@/types'

/** Map a site + per-page ingest of web URLs into a project (mirrors useDocumentUpload). */
export function useWebIngest() {
  const [busy, setBusy] = useState(false)

  const mapSite = useCallback(async (
    url: string, opts?: { maxDepth?: number; limit?: number },
  ): Promise<{ urls: string[]; configured: boolean }> => {
    const res = await fetch('/api/documents/web-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...opts }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Map failed')
    return res.json()
  }, [])

  const ingestUrl = useCallback(async (url: string, projectId: number): Promise<DocumentSummary> => {
    const res = await fetch('/api/documents/web-ingest', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, projectId }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Ingest failed')
    return (await res.json()).document
  }, [])

  const ingestUrls = useCallback(async (
    urls: string[], projectId: number,
    onResult: (r: { url: string; document?: DocumentSummary; error?: string }) => void,
    concurrency = 3,
  ): Promise<void> => {
    setBusy(true)
    try {
      const queue = [...urls]
      const worker = async () => {
        for (;;) {
          const url = queue.shift()
          if (!url) return
          try { onResult({ url, document: await ingestUrl(url, projectId) }) }
          catch (e) { onResult({ url, error: e instanceof Error ? e.message : 'Ingest failed' }) }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) || 1 }, worker))
    } finally {
      setBusy(false)
    }
  }, [ingestUrl])

  return { mapSite, ingestUrl, ingestUrls, busy }
}
