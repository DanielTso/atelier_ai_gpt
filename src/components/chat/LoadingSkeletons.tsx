export function MessageSkeleton() {
  return (
    <div className="flex gap-4 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
      <div className="flex flex-col gap-2 max-w-[80%] flex-1">
        <div className="h-3 w-16 bg-foreground/10 rounded" />
        <div className="p-4 rounded-2xl border border-border bg-muted space-y-2">
          <div className="h-4 bg-foreground/10 rounded w-3/4" />
          <div className="h-4 bg-foreground/10 rounded w-full" />
          <div className="h-4 bg-foreground/10 rounded w-2/3" />
        </div>
      </div>
    </div>
  )
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2 p-2">
          <div className="h-3 w-3 bg-foreground/10 rounded" />
          <div className="h-4 flex-1 bg-foreground/10 rounded" />
        </div>
      ))}
    </div>
  )
}

export function ProjectListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 p-2">
          <div className="h-4 w-4 bg-foreground/10 rounded" />
          <div className="h-4 flex-1 bg-foreground/10 rounded" />
        </div>
      ))}
    </div>
  )
}
