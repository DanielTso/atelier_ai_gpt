'use client'
import { useEffect, useState } from 'react'
import { ImageIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { GeneratedImageSummary } from '@/types'
import { getGeneratedImages, deleteGeneratedImage } from '@/app/actions'
import { ImageCard } from '@/components/chat/ImageCard'

interface ImagesViewProps {
  projects: { id: number; name: string }[]
}

export function ImagesView({ projects }: ImagesViewProps) {
  const [images, setImages] = useState<GeneratedImageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [genProjectId, setGenProjectId] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'standalone' | number>('all')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [noKey, setNoKey] = useState(false)

  useEffect(() => {
    setLoading(true)
    const arg = filter === 'all' ? undefined : filter === 'standalone' ? null : filter
    getGeneratedImages(arg)
      .then(setImages)
      .catch(() => setImages([]))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => {
    if (!lightboxUrl) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightboxUrl])

  async function handleGenerate() {
    if (!prompt.trim() || generating) return
    setGenerating(true)
    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), aspectRatio, projectId: genProjectId ?? undefined }),
      })
      if (res.status === 503) {
        setNoKey(true)
        toast.error('Set a Gemini API key in Settings to generate images.')
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error((body as { error?: string }).error ?? 'Image generation failed.')
        return
      }
      const { image } = await res.json() as { image: GeneratedImageSummary }
      setImages(prev => [image, ...prev])
      setPrompt('')
      toast.success('Image generated.')
    } catch {
      toast.error('Image generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  function handleDelete(id: number) {
    deleteGeneratedImage(id)
      .then(() => {
        setImages(prev => prev.filter(img => img.id !== id))
        toast.success('Image deleted.')
      })
      .catch(() => toast.error('Delete failed.'))
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-serif font-medium text-foreground">Images</h2>
      </div>

      {/* no-key hint */}
      {noKey && (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          No Gemini API key configured.{' '}
          <span className="text-foreground">Add one in Settings → API Keys to enable image generation.</span>
        </div>
      )}

      {/* Generate box */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4 space-y-3">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Ratio</label>
            <select
              value={aspectRatio}
              onChange={e => setAspectRatio(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              {['1:1', '16:9', '9:16', '4:3', '3:4'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Project</label>
            <select
              value={genProjectId ?? ''}
              onChange={e => setGenProjectId(e.target.value === '' ? null : Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">None (standalone)</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            Generate
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        {(['all', 'standalone'] as const).map(val => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              filter === val ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >{val === 'all' ? 'All' : 'Standalone'}</button>
        ))}
        {projects.map(p => (
          <button
            key={p.id}
            onClick={() => setFilter(p.id)}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              filter === p.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >{p.name}</button>
        ))}
      </div>

      {/* Gallery */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No images yet. Generate one above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {images.map(img => (
            <ImageCard
              key={img.id}
              image={img}
              onOpen={setLightboxUrl}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-label="Image preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL */}
          <img
            src={lightboxUrl}
            alt="Full size preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
