import { cn } from '@/lib/utils'

/** Base shimmer block — warm gradient sweep (see .skeleton-shimmer in globals.css). */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer', className)} />
}

export function MessageSkeleton({ align = 'left' }: { align?: 'left' | 'right' }) {
  return (
    <div className={cn('flex gap-4', align === 'right' && 'flex-row-reverse')}>
      <Shimmer className="w-8 h-8 rounded-full shrink-0" />
      <div className={cn('flex flex-col gap-2 max-w-[80%] flex-1', align === 'right' && 'items-end')}>
        <Shimmer className="h-3 w-16" />
        <div className={cn(
          'p-4 rounded-2xl border border-border bg-muted space-y-2 w-full',
          align === 'right' ? 'rounded-tr-none' : 'rounded-tl-none',
        )}>
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2 p-2">
          <Shimmer className="h-3 w-3" />
          <Shimmer className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

export function ProjectListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 p-2">
          <Shimmer className="h-4 w-4" />
          <Shimmer className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

/** Artifacts gallery loading state — holds the real grid layout so content lands in place. */
export function GalleryGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-3 space-y-3">
          <Shimmer className="aspect-4/3 w-full rounded-lg" />
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

/** Images gallery loading state — mirrors the gallery's grid classes. */
export function ImageGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <Shimmer key={i} className="aspect-square w-full rounded-xl" />
      ))}
    </div>
  )
}

/** Project Files rail loading state — icon tile + label rows. */
export function FilesRailSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 p-2">
          <Shimmer className="h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-3.5 w-3/4" />
            <Shimmer className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
