"use client"

import { Toaster as SonnerToaster } from "sonner"

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-popover border border-border text-foreground shadow-lg rounded-lg",
          title: "text-sm font-medium",
          description: "text-sm text-muted-foreground",
          success: "bg-green-500/10 border-green-500/20 text-green-400",
          error: "bg-red-500/10 border-red-500/20 text-red-400",
          info: "bg-blue-500/10 border-blue-500/20 text-blue-400",
        },
      }}
    />
  )
}
