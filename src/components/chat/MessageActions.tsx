"use client"

import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { MoreHorizontal, Copy, Trash2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface MessageActionsProps {
  messageText: string
  messageRole: 'user' | 'assistant'
  onDelete?: () => void
  onRegenerate?: () => void
}

export function MessageActions({
  messageText,
  messageRole,
  onDelete,
  onRegenerate,
}: MessageActionsProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageText)
      toast.success("Message copied")
    } catch {
      toast.error("Failed to copy message")
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            "p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity",
            "hover:bg-accent text-muted-foreground hover:text-foreground"
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[140px] overflow-hidden rounded-lg p-1",
            "bg-popover border border-border shadow-xl",
            "animate-in fade-in-0 zoom-in-95"
          )}
          sideOffset={5}
          align="end"
        >
          <DropdownMenu.Item
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer outline-none",
              "text-foreground/80 hover:bg-accent hover:text-foreground",
              "transition-colors"
            )}
            onSelect={handleCopy}
          >
            <Copy className="h-4 w-4" />
            Copy
          </DropdownMenu.Item>

          {messageRole === 'assistant' && onRegenerate && (
            <DropdownMenu.Item
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer outline-none",
                "text-foreground/80 hover:bg-accent hover:text-foreground",
                "transition-colors"
              )}
              onSelect={onRegenerate}
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </DropdownMenu.Item>
          )}

          {onDelete && (
            <>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer outline-none",
                  "text-red-400 hover:bg-red-500/10",
                  "transition-colors"
                )}
                onSelect={onDelete}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
