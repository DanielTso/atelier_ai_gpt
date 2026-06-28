'use client'
import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Loader2, Camera, PenTool, Sparkles, Network } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { GeneratedImageSummary } from '@/types'
import { getGeneratedImages, deleteGeneratedImage } from '@/app/actions'
import { ImageCard } from '@/components/chat/ImageCard'
import { Lightbox } from '@/components/ui/Lightbox'
import { downloadFile, imageExt } from '@/lib/download'

interface ImagesViewProps {
  projects: { id: number; name: string }[]
}

// Starter "templates" shown as tiles under the prompt (Gemini-style). Clicking one
// seeds the prompt box so you can fill in the rest — no stock images required.
const TEMPLATES: { label: string; seed: string; icon: typeof Camera; tint: string; color: string }[] = [
  { label: 'Photoreal', seed: 'A photorealistic photo of ', icon: Camera, tint: 'bg-primary/10', color: 'text-primary' },
  { label: 'Logo', seed: 'A minimal flat vector logo of ', icon: PenTool, tint: 'bg-success/10', color: 'text-success' },
  { label: 'Concept art', seed: 'Cinematic concept art of ', icon: Sparkles, tint: 'bg-warning/10', color: 'text-warning' },
  { label: 'Diagram', seed: 'A clean labeled diagram of ', icon: Network, tint: 'bg-primary/10', color: 'text-primary' },
]

export function ImagesView({ projects }: ImagesViewProps) {
  const [images, setImages] = useState<GeneratedImageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [genProjectId, setGenProjectId] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'standalone' | number>('all')
  const [lightboxImage, setLightboxImage] = useState<GeneratedImageSummary | null>(null)
  const [noKey, setNoKey] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setLoading(true)
    const arg = filter === 'all' ? undefined : filter === 'standalone' ? null : filter
    getGeneratedImages(arg)
      .then(setImages)
      .catch(() => setImages([]))
      .finally(() => setLoading(false))
  }, [filter])

  function seedPrompt(seed: string) {
    setPrompt(seed)
    promptRef.current?.focus()
  }

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
      setNoKey(false)
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

  const heroOnly = images.length === 0 && !loading

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero — centered "Create images" prompt (Gemini-style). When there are no
          images yet, the hero floats to the vertical center of the view. */}
      <div
        className={cn(
          'max-w-3xl mx-auto w-full px-6 flex flex-col items-center text-center',
          heroOnly ? 'min-h-full justify-center pt-6 pb-12' : 'pt-12',
        )}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10">
          <ImageIcon className="h-6 w-6 text-primary" />
        </div>
        <h2 className="mt-3 text-3xl font-serif font-medium text-foreground">Create images</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Try a template or describe an idea. Created with Nano Banana 2.
        </p>

        {/* no-key hint */}
        {noKey && (
          <div className="mt-4 w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No Gemini API key configured.{' '}
            <span className="text-foreground">Add one in Settings → API Keys to enable image generation.</span>
          </div>
        )}

        {/* Prompt bar */}
        <div className="mt-6 w-full rounded-2xl border border-border bg-card p-3 text-left shadow-sm">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe your image"
            rows={2}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
          />
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <select
              aria-label="Aspect ratio"
              value={aspectRatio}
              onChange={e => setAspectRatio(e.target.value)}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
            >
              {['1:1', '16:9', '9:16', '4:3', '3:4'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              aria-label="Target project"
              value={genProjectId ?? ''}
              onChange={e => setGenProjectId(e.target.value === '' ? null : Number(e.target.value))}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">Standalone</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="hidden sm:inline text-xs text-muted-foreground">Nano Banana 2</span>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              Generate
            </button>
          </div>
        </div>

        {/* Template tiles */}
        <div className="mt-5 flex gap-3 overflow-x-auto pb-1 max-w-full justify-center">
          {TEMPLATES.map(t => (
            <button
              key={t.label}
              onClick={() => seedPrompt(t.seed)}
              className="group shrink-0 w-32 h-24 rounded-2xl border border-border bg-card p-3 flex flex-col justify-between text-left transition-colors hover:bg-accent"
            >
              <div className={cn('flex items-center justify-center w-8 h-8 rounded-lg', t.tint)}>
                <t.icon className={cn('h-4 w-4', t.color)} />
              </div>
              <span className="text-xs font-medium text-foreground">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Gallery — your generated images (hidden in the empty hero state) */}
      {(loading || images.length > 0) && (
        <div className="max-w-5xl mx-auto w-full px-6 pb-12 pt-8">
          {/* Filter row */}
          <div className="mb-5 flex items-center justify-center gap-2 flex-wrap">
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

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {images.map(img => (
                <ImageCard
                  key={img.id}
                  image={img}
                  onOpen={setLightboxImage}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <Lightbox
        url={lightboxImage?.url ?? null}
        onClose={() => setLightboxImage(null)}
        onDownload={lightboxImage?.url ? () => downloadFile(lightboxImage.url!, `atelier-image-${lightboxImage.id}.${imageExt(lightboxImage.mediaType)}`) : undefined}
      />
    </div>
  )
}
