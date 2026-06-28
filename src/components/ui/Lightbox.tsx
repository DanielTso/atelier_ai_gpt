'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Download } from 'lucide-react'

interface LightboxProps {
  url: string | null
  onClose: () => void
  onDownload?: () => void
}

export function Lightbox({ url, onClose, onDownload }: LightboxProps) {
  useEffect(() => {
    if (!url) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [url, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {url && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={onClose}
          role="dialog"
          aria-label="Image preview"
        >
          {onDownload && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDownload() }}
              className="absolute top-4 right-4 bg-background/80 hover:bg-background rounded-lg p-2 text-foreground transition-colors"
              aria-label="Download image"
            >
              <Download className="h-5 w-5" />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL */}
          <img
            src={url}
            alt="Full size preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
