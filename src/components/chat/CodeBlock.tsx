"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { codeToHtmlSafe } from "@/lib/highlighter"

interface CodeBlockProps {
  children: React.ReactNode
  className?: string
}

/** Pull the language-x class off the child <code> (react-markdown puts it there). */
function extractLang(children: React.ReactNode): string | null {
  if (
    children && typeof children === "object" && "props" in children &&
    typeof (children as { props?: { className?: unknown } }).props?.className === "string"
  ) {
    const m = ((children as { props: { className: string } }).props.className).match(/language-([\w-]+)/)
    return m ? m[1] : null
  }
  return null
}

/** Text content of the child <code> for highlighting (mirrors what copy reads). */
function extractText(children: React.ReactNode): string {
  if (children && typeof children === "object" && "props" in children) {
    const inner = (children as { props?: { children?: unknown } }).props?.children
    if (typeof inner === "string") return inner
    if (Array.isArray(inner)) return inner.filter((x): x is string => typeof x === "string").join("")
  }
  return ""
}

export function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const lang = extractLang(children)
  const code = extractText(children)

  // Debounced progressive enhancement: highlight ~150ms after the content
  // stabilizes so streaming token updates don't thrash shiki; until then (and
  // for unsupported languages) the plain <pre> below is what renders.
  useEffect(() => {
    if (!lang || !code) { setHtml(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      codeToHtmlSafe(code, lang).then(result => {
        if (!cancelled) setHtml(result)
      })
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [code, lang])

  const handleCopy = async () => {
    // Scope to THIS block — works for both the plain and highlighted renderings.
    const host = html ? wrapRef.current : preRef.current
    const text = host?.querySelector("code")?.textContent ?? host?.textContent ?? ""
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy code:", err)
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
      {html ? (
        // Shiki output is locally generated from message text — trusted HTML.
        <div
          ref={wrapRef}
          className={`${className ?? ""} [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-2 [&_code]:whitespace-pre`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre ref={preRef} className={className}>
          {children}
        </pre>
      )}
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
