'use client'

export function CapacityBar({ usedBytes, capBytes }: { usedBytes: number; capBytes: number }) {
  const ratio = capBytes > 0 ? Math.min(1, usedBytes / capBytes) : 0
  const pct = Math.round(ratio * 100)
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className="h-full rounded-full bg-primary/70 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{pct}% of project capacity used</p>
    </div>
  )
}
