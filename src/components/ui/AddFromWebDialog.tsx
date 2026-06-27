'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Globe, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useWebIngest } from '@/hooks/useWebIngest'

interface AddFromWebDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  onIngested: () => void
}

type Mode = 'single' | 'crawl'

export function AddFromWebDialog({ open, onOpenChange, projectId, onIngested }: AddFromWebDialogProps) {
  const { mapSite, ingestUrls, busy } = useWebIngest()
  const [mode, setMode] = useState<Mode>('single')
  const [url, setUrl] = useState('')
  const [mapping, setMapping] = useState(false)
  const [noKey, setNoKey] = useState(false)
  const [found, setFound] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(0)

  const reset = () => { setUrl(''); setFound([]); setSelected(new Set()); setNoKey(false); setDone(0) }

  const handleClose = (o: boolean) => { if (!o) reset(); onOpenChange(o) }

  const runIngest = async (urls: string[]) => {
    let ok = 0
    await ingestUrls(urls, projectId, (r) => {
      setDone(d => d + 1)
      if (r.document) { ok++; onIngested() }
      else toast.error(`Failed: ${r.url}`)
    }, 3)
    if (ok > 0) toast.success(`Added ${ok} page${ok !== 1 ? 's' : ''} from the web`)
  }

  const handleAddSingle = async () => {
    if (!url.trim()) return
    await runIngest([url.trim()])
    handleClose(false)
  }

  const handleFindPages = async () => {
    if (!url.trim()) return
    setMapping(true); setNoKey(false); setFound([])
    try {
      const { urls, configured } = await mapSite(url.trim())
      if (!configured) { setNoKey(true); return }
      setFound(urls)
      setSelected(new Set(urls))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not map that site')
    } finally {
      setMapping(false)
    }
  }

  const toggle = (u: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(u)) next.delete(u); else next.add(u)
    return next
  })

  const handleIngestSelected = async () => {
    const urls = found.filter(u => selected.has(u))
    if (urls.length === 0) return
    await runIngest(urls)
    handleClose(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-foreground/30 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg glass-panel rounded-2xl p-6 z-50 shadow-xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Add from web
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 mb-4 bg-muted rounded-lg" role="tablist">
            <button role="tab" aria-selected={mode === 'single'} onClick={() => { setMode('single'); reset() }}
              className={cn('flex-1 text-sm py-1.5 rounded-md transition-colors', mode === 'single' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
              Single page
            </button>
            <button role="tab" aria-selected={mode === 'crawl'} onClick={() => { setMode('crawl'); reset() }}
              className={cn('flex-1 text-sm py-1.5 rounded-md transition-colors', mode === 'crawl' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
              Crawl site
            </button>
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/page"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />

          {mode === 'single' ? (
            <button onClick={handleAddSingle} disabled={busy || !url.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add page
            </button>
          ) : (
            <div className="flex flex-col min-h-0">
              <button onClick={handleFindPages} disabled={mapping || !url.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-secondary hover:bg-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-3">
                {mapping && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Find pages
              </button>

              {noKey && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Set a Tavily API key in Settings → API Keys to crawl sites.
                </p>
              )}

              {found.length > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>{selected.size} of {found.length} selected</span>
                    <button className="hover:text-foreground" onClick={() => setSelected(selected.size === found.length ? new Set() : new Set(found))}>
                      {selected.size === found.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0 space-y-1 mb-3 max-h-64">
                    {found.map(u => (
                      <label key={u} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                        <input type="checkbox" checked={selected.has(u)} onChange={() => toggle(u)} />
                        <span className="truncate">{u}</span>
                      </label>
                    ))}
                  </div>
                  <button onClick={handleIngestSelected} disabled={busy || selected.size === 0}
                    className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Ingesting {done}/{selected.size}…</> : <><Check className="h-3.5 w-3.5" /> Ingest {selected.size} page{selected.size !== 1 ? 's' : ''}</>}
                  </button>
                </>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
