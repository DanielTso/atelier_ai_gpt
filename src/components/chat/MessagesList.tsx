"use client"

import { memo, useState, useCallback, useEffect } from "react"
import { Folder, MessageSquare, ExternalLink, Globe, Paperclip, Sparkles, ChevronRight } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { motion, AnimatePresence } from "framer-motion"
import * as Tooltip from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import type { UIMessage } from "ai"
import { CodeBlock, InlineCode } from "./CodeBlock"
import { SmoothStreamingWrapper } from "./SmoothStreamingWrapper"
import { MessageActions } from "./MessageActions"
import { ThinkingStatus } from "./ThinkingStatus"
import { deriveAssistantStage, assistantHasVisibleContent } from "@/lib/chatStage"
import { ToolProgressCard, isToolCardPart, extractInlineArtifactIds } from "./ToolProgressCard"
import { formatMessageTime, formatFullTime } from "@/lib/formatTime"
import { parseFileMetadata, stripFilePrefix, getFileTypeLabel, type FileMetadata } from "@/lib/fileAttachments"
import { formatFileSize } from "@/lib/fileUtils"
import type { ArtifactSummary } from "@/types"
import { ArtifactCard } from "./ArtifactCard"
import { Lightbox } from "@/components/ui/Lightbox"
import { MessageSkeleton } from "./LoadingSkeletons"
import { staggerDelay } from "@/lib/motion"

export type ChatMessage = UIMessage & { createdAt?: Date }

interface MessagesListProps {
  messages: ChatMessage[]
  isLoading: boolean
  activeChatId: number | null
  selectedModel: string
  onDeleteMessage?: (id: string) => void
  artifacts?: ArtifactSummary[]
  onOpenArtifact?: (id: number) => void
  /** True while the chat's history is fetching — skeletons hold the layout. */
  messagesLoading?: boolean
  /** useChat status — drives the staged thinking/tool indicator. */
  status?: string
}

// Helper to extract text content from message parts, stripping file prefix for display
function getMessageText(message: UIMessage): string {
  const raw = message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
  return stripFilePrefix(raw)
}

// Helper to extract raw text without stripping (for copy/actions)
function getRawMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
}

// Helper to extract file metadata from a message
function getMessageFiles(message: UIMessage): FileMetadata[] | null {
  const raw = getRawMessageText(message)
  return parseFileMetadata(raw)
}

// Display-only file chips for messages that included file attachments
function MessageFileChips({ files }: { files: FileMetadata[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-xs"
        >
          <Paperclip className="h-2.5 w-2.5 text-primary/70" />
          <span className="font-medium truncate max-w-[120px]">{file.name}</span>
          <span className="text-muted-foreground">
            {getFileTypeLabel(file.type, file.name)} · {formatFileSize(file.size)}
          </span>
        </div>
      ))}
    </div>
  )
}

// Helper to extract image file parts from a message
interface ImagePart {
  mediaType: string
  url: string
}

function getMessageImages(message: UIMessage): ImagePart[] {
  return message.parts.filter((part): part is ImagePart & { type: 'file' } =>
    part.type === 'file' && typeof (part as Record<string, unknown>).mediaType === 'string' &&
    ((part as Record<string, unknown>).mediaType as string).startsWith('image/')
  ).map(p => ({ mediaType: p.mediaType, url: p.url }))
}

// Helper to extract source-url parts from a message
interface SourceUrl {
  sourceId: string
  url: string
  title?: string
}

function getMessageSources(message: UIMessage): SourceUrl[] {
  return message.parts
    .filter((part): part is SourceUrl & { type: 'source-url' } => part.type === 'source-url')
    .reduce((unique, src) => {
      if (!unique.some(s => s.url === src.url)) unique.push(src)
      return unique
    }, [] as SourceUrl[])
}

// Concatenate the assistant's reasoning ("thinking") parts.
function getMessageReasoning(message: UIMessage): string {
  return message.parts
    .map(p => (p.type === 'reasoning' ? (p as { text?: string }).text ?? '' : ''))
    .join('')
    .trim()
}

// Collapsible "Thinking" block — auto-expands while the model is still thinking
// (streaming, no answer text yet), then collapses to a header you can re-open.
function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const expanded = open || live
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <Sparkles className={cn("h-3.5 w-3.5 shrink-0", live && "animate-pulse text-primary")} />
        <span className="font-medium">{live ? 'Thinking…' : 'Thought process'}</span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="mt-1.5 pl-2 border-l-2 border-border/50 text-xs text-muted-foreground/80 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  )
}

function SourcesList({ sources }: { sources: SourceUrl[] }) {
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return null
  return (
    <div className="mt-2 pt-2 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
      >
        <Globe className="h-3 w-3" />
        <span className="text-[11px] font-medium">{sources.length} source{sources.length === 1 ? '' : 's'}</span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {sources.map((src) => {
          let hostname = ''
          try { hostname = new URL(src.url).hostname.replace(/^www\./, '') } catch { hostname = src.url }
          return (
            <a
              key={src.sourceId}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-muted border border-border text-muted-foreground hover:text-foreground hover:bg-accent hover:border-border transition-colors"
              title={src.title || src.url}
            >
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate max-w-[200px]">{src.title || hostname}</span>
            </a>
          )
        })}
      </div>
      )}
    </div>
  )
}

// Move markdown components outside to prevent recreation on every render
const MARKDOWN_COMPONENTS = {
  pre: ({children, ...props}: React.HTMLAttributes<HTMLPreElement>) => (
    <CodeBlock className="overflow-x-auto max-w-full my-2 bg-muted p-3 rounded-lg [&_code]:whitespace-pre-wrap [&_code]:wrap-break-word [&_code]:break-all" {...props}>
      {children}
    </CodeBlock>
  ),
  code: ({className, ...props}: React.HTMLAttributes<HTMLElement>) => {
    // react-markdown v10 removed the `inline` prop. A fenced code block carries a
    // `language-*` className (and is wrapped by the `pre` renderer above); everything
    // else is an inline span → render it with the styled InlineCode.
    const isBlock = typeof className === 'string' && /(^|\s)language-/.test(className)
    return isBlock ? <code className={className} {...props} /> : <InlineCode className={className} {...props} />
  },
  // Article/video links open in a new tab — in-tab navigation would drop the chat.
  a: ({href, children, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  ),
}

const EMPTY_URL_SET: ReadonlySet<string> = new Set()

// Message animation variants
const messageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

// The message bubble (images + markdown + sources) is the expensive part — a full
// ReactMarkdown parse per message. Memoized so that during streaming only the
// active row re-parses; prior messages (stable `m` reference, isStreaming=false)
// skip re-render entirely instead of re-parsing on every token.
const MessageBody = memo(function MessageBody({
  m, isStreaming, onImageClick, onOpenArtifact,
}: { m: ChatMessage; isStreaming: boolean; onImageClick: (url: string) => void; onOpenArtifact?: (id: number) => void }) {
  const images = getMessageImages(m)
  const isGenerated = m.role === 'assistant'
  const files = m.role === 'user' ? getMessageFiles(m) : null
  const reasoning = isGenerated ? getMessageReasoning(m) : ''
  const answerText = getMessageText(m)
  // Live tool parts (generate_image / generate_artifact) render inline: an
  // in-progress card while the tool runs, the settled image/artifact after.
  const toolParts = isGenerated ? m.parts.filter(isToolCardPart) : []
  // Only needed for settled image dedup — skip the allocation on the common
  // no-tool path (this row re-renders per streamed token).
  const fileUrls = toolParts.length > 0 ? new Set(images.map(img => img.url)) : EMPTY_URL_SET
  return (
    <div className={cn(
      "p-4 rounded-2xl border transition-all hover:border-border relative",
      m.role === 'user'
        ? "bg-primary/20 border-primary/10 rounded-tr-none"
        : "bg-muted border-border rounded-tl-none"
    )}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-2">
          {images.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onImageClick(img.url)}
              className={cn(
                "block rounded-lg overflow-hidden border border-border hover:border-border transition-colors cursor-zoom-in",
                isGenerated && "shadow-lg"
              )}
            >
              <img
                src={img.url}
                alt={isGenerated ? "Generated image" : "Attached image"}
                className={cn("object-contain", isGenerated ? "max-w-lg max-h-128" : "max-w-75 max-h-75")}
              />
            </button>
          ))}
        </div>
      )}
      {files && <MessageFileChips files={files} />}
      {isGenerated && <ReasoningBlock text={reasoning} live={isStreaming && answerText.trim().length === 0} />}
      {toolParts.map((p, idx) => (
        <ToolProgressCard key={idx} part={p} fileUrls={fileUrls} onImageClick={onImageClick} onOpenArtifact={onOpenArtifact} stalled={!isStreaming} />
      ))}
      <div className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden",
        isStreaming && "streaming-cursor"
      )}>
        <SmoothStreamingWrapper isStreaming={isStreaming}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {answerText}
          </ReactMarkdown>
        </SmoothStreamingWrapper>
      </div>
      {m.role === 'assistant' && <SourcesList sources={getMessageSources(m)} />}
    </div>
  )
})

export const MessagesList = memo(function MessagesList({
  messages,
  isLoading,
  activeChatId,
  selectedModel,
  onDeleteMessage,
  artifacts,
  onOpenArtifact,
  messagesLoading = false,
  status,
}: MessagesListProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const onImageClick = useCallback((url: string) => setLightboxUrl(url), [])
  const closeLightbox = useCallback(() => setLightboxUrl(null), [])

  // Stagger the entrance only for the chat's opening batch. The list remounts
  // per chat (keyed view wrapper) but the history usually lands AFTER mount
  // (async load behind the skeleton), so the batch is captured at the first
  // non-empty render: while `staggerBatchIds` is still null every row is part
  // of the opening batch; once recorded, later (streamed) rows mount with no
  // delay.
  const [staggerBatchIds, setStaggerBatchIds] = useState<Set<string> | null>(
    () => (messages.length > 0 ? new Set(messages.map(m => m.id)) : null),
  )
  useEffect(() => {
    if (staggerBatchIds === null && messages.length > 0) {
      setStaggerBatchIds(new Set(messages.map(m => m.id)))
    }
  }, [staggerBatchIds, messages])

  if (!activeChatId) {
    return (
      <motion.div
        className="h-full flex flex-col items-center justify-center text-muted-foreground px-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-primary/15 to-primary/5 ring-1 ring-primary/15 flex items-center justify-center mb-4">
          <Folder className="h-7 w-7 text-primary/70" />
        </div>
        <p className="text-lg font-medium text-foreground mb-2">No Chat Selected</p>
        <p className="text-sm text-center max-w-md text-muted-foreground">
          Create a new project and chat to start your conversation with AI models
        </p>
      </motion.div>
    )
  }

  if (messagesLoading && messages.length === 0) {
    return (
      <div className="flex flex-col gap-6 max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto pb-4">
        <MessageSkeleton align="right" />
        <MessageSkeleton />
        <MessageSkeleton align="right" />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <motion.div
        className="h-full flex flex-col items-center justify-center text-muted-foreground px-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-primary/15 to-primary/5 ring-1 ring-primary/15 flex items-center justify-center mb-4">
          <MessageSquare className="h-7 w-7 text-primary/70" />
        </div>
        <p className="text-lg font-medium text-foreground mb-2">Start Your Conversation</p>
        <p className="text-sm text-center max-w-md text-muted-foreground">
          Type your message below to chat with <span className="text-primary font-medium">{selectedModel || "your AI"}</span>
        </p>
      </motion.div>
    )
  }

  // Find the last assistant message for streaming cursor
  const lastAssistantIndex = messages.reduce((lastIdx, m, idx) =>
    m.role === 'assistant' ? idx : lastIdx, -1)

  // Staged response status: derived from the streaming message's real parts
  // (reasoning, tool calls, text) — never timers. Hidden as soon as the reply
  // bubble has anything visible of its own (text, live reasoning, images).
  const lastMessage = messages[messages.length - 1]
  const stage = deriveAssistantStage(status ?? (isLoading ? 'streaming' : 'ready'), lastMessage)
  const showThinking = stage !== 'idle' && stage !== 'writing' && !assistantHasVisibleContent(lastMessage)

  // Artifacts already rendered inline from live tool outputs are filtered out of
  // the bottom block: live session → inline card; reloaded history (DB messages
  // carry no tool parts) → bottom block. Never both. The full-history scan only
  // runs when there are artifacts to filter — not on every streamed token.
  let bottomArtifacts = artifacts
  if (artifacts && artifacts.length > 0) {
    const inlineIds = extractInlineArtifactIds(messages)
    if (inlineIds.size > 0) bottomArtifacts = artifacts.filter(a => !inlineIds.has(a.id))
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex flex-col gap-6 max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto pb-4">
        <AnimatePresence>
          {messages.map((m, index) => {
            // Show streaming cursor on last assistant message while loading
            const isStreamingMessage = isLoading && m.role === 'assistant' && index === lastAssistantIndex

            return (
            <motion.div
              key={m.id}
              variants={messageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, delay: staggerBatchIds === null || staggerBatchIds.has(m.id) ? staggerDelay(index) : 0 }}
              className={cn(
                "flex gap-4 group",
                m.role === 'user' ? "flex-row-reverse" : ""
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold",
                m.role === 'user' ? "bg-blue-500/20 text-blue-500" : "bg-primary/20 text-primary"
              )}>
                {m.role === 'user' ? 'You' : 'AI'}
              </div>
              <div className={cn(
                "flex flex-col gap-1 max-w-[80%] min-w-0",
                m.role === 'user' ? "items-end" : "items-start"
              )}>
                <MessageBody m={m} isStreaming={isStreamingMessage} onImageClick={onImageClick} onOpenArtifact={onOpenArtifact} />

                {/* Timestamp and Actions Row */}
                <div className={cn(
                  "flex items-center gap-2 px-1",
                  m.role === 'user' ? "flex-row-reverse" : ""
                )}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <span className="text-xs text-muted-foreground/60 cursor-default">
                        {formatMessageTime(m.createdAt ?? new Date())}
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className="z-50 px-3 py-1.5 text-xs bg-popover border border-border rounded-lg shadow-lg animate-in fade-in-0 zoom-in-95"
                        sideOffset={5}
                      >
                        {formatFullTime(m.createdAt ?? new Date())}
                        <Tooltip.Arrow className="fill-popover" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>

                  <MessageActions
                    messageText={getMessageText(m)}
                    messageRole={m.role as 'user' | 'assistant'}
                    onDelete={onDeleteMessage ? () => onDeleteMessage(m.id) : undefined}
                  />
                </div>
              </div>
            </motion.div>
          )})}
        </AnimatePresence>

        {/* Artifact Cards (historical — live tool outputs render inline instead) */}
        {bottomArtifacts && bottomArtifacts.length > 0 && (
          <div className="px-4 pb-2">{bottomArtifacts.map(a => <ArtifactCard key={a.id} artifact={a} onOpen={onOpenArtifact} />)}</div>
        )}

        {/* Staged response status — covers the gap before the reply bubble has any
            visible content: shimmer for a quick plain reply, labelled stages
            ("Thinking…", "Searching the web…", "Creating image…") when real
            reasoning/tool events are on the wire. */}
        <AnimatePresence>
          {showThinking && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ThinkingStatus stage={stage} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Lightbox url={lightboxUrl} onClose={closeLightbox} />
    </Tooltip.Provider>
  )
})
