'use client'
import { useState, useCallback } from 'react'
import { readError } from '@/lib/readError'

// /api/documents/process runs to the function's time limit on a large PDF; past
// it the platform answers 504 with an HTML page. The work may still have landed.
const PROCESS_TIMEOUT_MESSAGE = 'Processing timed out — the document may still be indexing; refresh in a minute'

async function processError(res: Response): Promise<Error> {
  return new Error(await readError(res, res.status === 504 ? PROCESS_TIMEOUT_MESSAGE : 'Processing failed'))
}

/** Shared 3-step direct-to-Storage upload: mint signed URL → PUT to Storage → process. */
export function useDocumentUpload() {
  const [uploading, setUploading] = useState(false)

  const upload = useCallback(async (file: File, projectId: number) => {
    setUploading(true)
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
      })
      if (!urlRes.ok) throw new Error(await readError(urlRes, 'Upload failed'))
      const { documentId, path, token, bucket } = await urlRes.json()

      const { getBrowserSupabase } = await import('@/lib/storageClient')
      const { error: upErr } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr

      const procRes = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (!procRes.ok) throw await processError(procRes)
    } finally {
      setUploading(false)
    }
  }, [])

  /** Replace an existing document with a new revision (same 3 steps, replace flow). */
  const replace = useCallback(async (file: File, documentId: number) => {
    setUploading(true)
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, replaceDocumentId: documentId }),
      })
      if (!urlRes.ok) throw new Error(await readError(urlRes, 'Replace failed'))
      const { documentId: id, path, token, bucket } = await urlRes.json()

      const { getBrowserSupabase } = await import('@/lib/storageClient')
      const { error: upErr } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr

      const procRes = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: id, filename: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size }),
      })
      if (!procRes.ok) throw await processError(procRes)
    } finally {
      setUploading(false)
    }
  }, [])

  return { upload, replace, uploading }
}
