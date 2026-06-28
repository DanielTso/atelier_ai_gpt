"use client"

import { useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

interface CodeBlockProps {
  children: React.ReactNode
  className?: string
}

export function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const handleCopy = async () => {
    // Scope to THIS block's <pre> — a document-wide querySelector('pre code') copied
    // the first code block on the page regardless of which button was clicked.
    const code = preRef.current?.querySelector('code')?.textContent ?? preRef.current?.textContent ?? ''

    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 p-1.5 rounded-lg bg-muted hover:bg-accent opacity-0 group-hover:opacity-100 transition-all duration-200 z-10"
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <pre ref={preRef} className={className}>
        {children}
      </pre>
    </div>
  )
}

interface InlineCodeProps {
  children?: React.ReactNode
  className?: string
}

export function InlineCode({ children, className, ...props }: InlineCodeProps & React.HTMLAttributes<HTMLElement>) {
  return (
    <code className={`bg-muted rounded px-1 py-0.5 text-sm font-mono ${className || ''}`} {...props}>
      {children}
    </code>
  )
}
