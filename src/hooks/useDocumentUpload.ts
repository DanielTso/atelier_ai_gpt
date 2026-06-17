'use client'
import { useState, useCallback } from 'react'

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
      if (!urlRes.ok) throw new Error((await urlRes.json()).error || 'Upload failed')
      const { documentId, path, token, bucket } = await urlRes.json()

      const { getBrowserSupabase } = await import('@/lib/storageClient')
      const { error: upErr } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr

      const procRes = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (!procRes.ok) throw new Error((await procRes.json()).error || 'Processing failed')
    } finally {
      setUploading(false)
    }
  }, [])

  return { upload, uploading }
}
