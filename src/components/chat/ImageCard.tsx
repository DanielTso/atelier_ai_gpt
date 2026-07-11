'use client'
import { memo } from 'react'
import { Download, Trash2 } from 'lucide-react'
import type { GeneratedImageSummary } from '@/types'
import { downloadFile, imageExt } from '@/lib/download'

interface ImageCardProps {
  image: GeneratedImageSummary
  onOpen: (image: GeneratedImageSummary) => void
  onDelete: (id: number) => void
}

export const ImageCard = memo(function ImageCard({ image, onOpen, onDelete }: ImageCardProps) {
  const url = image.url ?? ''

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    onDelete(image.id)
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation()
    void downloadFile(url, `atelier-image-${image.id}.${imageExt(image.mediaType)}`)
  }

  return (
    <div
      className="group relative rounded-xl border border-border/30 overflow-hidden cursor-pointer hover:border-border/60 hover:shadow-md motion-safe:hover:-translate-y-0.5 transition-[transform,box-shadow,border-color] duration-200 bg-card"
      onClick={() => url && onOpen(image)}
    >
      <div className="aspect-square bg-muted/40 overflow-hidden">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL
          <img src={url} alt={image.prompt} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">No preview</div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{image.prompt}</p>
      </div>

      {/* Hover actions */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {url && (
          <button
            type="button"
            onClick={handleDownload}
            className="p-1 rounded bg-background/80 text-muted-foreground hover:text-foreground"
            aria-label="Download image"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={handleDelete}
          className="p-1 rounded bg-background/80 text-muted-foreground hover:text-destructive"
          aria-label="Delete image"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})
