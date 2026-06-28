'use client'

import { memo, type ReactNode } from "react"
import { ArrowLeft, MessageSquare, Pin, MoreVertical, Pencil, Trash2 } from "lucide-react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { cn } from "@/lib/utils"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { ProjectContextRail } from "@/components/chat/ProjectContextRail"

interface ChatPreview {
  id: number
  title: string
  preview: string | null
  createdAt: Date | null
}

interface ProjectLandingPageProps {
  project: { id: number; name: string; memory?: string | null; instructions?: string | null }
  chatPreviews: ChatPreview[]
  loading: boolean
  composer: ReactNode
  onSelectChat: (chatId: number) => void
  onAddFiles: () => void
  onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void
  onDeleteProject: (id: number) => void
  onBack: () => void
  onRename: () => void
}

function formatShortDate(date: Date | null): string {
  if (!date) return ""
  const d = new Date(date)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export const ProjectLandingPage = memo(function ProjectLandingPage({
  project,
  chatPreviews,
  loading,
  composer,
  onSelectChat,
  onAddFiles,
  onSaveContext,
  onDeleteProject,
  onBack,
  onRename,
}: ProjectLandingPageProps) {
  const [pinnedIds, setPinnedIds] = useLocalStorage<number[]>(
    'pinned-project-ids',
    [],
    v => Array.isArray(v) && v.every(x => typeof x === 'number'),
  )
  const isPinned = pinnedIds.includes(project.id)
  const togglePin = () =>
    setPinnedIds(prev => (prev.includes(project.id) ? prev.filter(id => id !== project.id) : [...prev, project.id]))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/40">
        <div className="flex flex-col gap-1.5 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft className="h-4 w-4" />
            All projects
          </button>
          <h1 className="text-xl font-serif font-medium text-foreground truncate">{project.name}</h1>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={togglePin}
            aria-label={isPinned ? `Unpin project ${project.name}` : `Pin project ${project.name}`}
            title={isPinned ? "Unpin project" : "Pin project"}
            className={cn(
              "p-2 rounded-lg transition-colors",
              isPinned ? "text-primary hover:bg-accent" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Pin className={cn("h-4 w-4", isPinned && "fill-current")} />
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={`Project options for ${project.name}`}
                className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="min-w-[160px] glass-panel rounded-xl p-1.5 shadow-2xl border border-border z-50"
              >
                <DropdownMenu.Item
                  onClick={onRename}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-accent outline-none transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onClick={() => onDeleteProject(project.id)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer text-destructive hover:bg-destructive/10 outline-none transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Chats column + context rail */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Chats */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Composer — start a new chat in this project */}
          <div className="mx-4 mt-4">{composer}</div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto mt-2 px-4 pb-4">
            {loading ? (
              <div className="space-y-3 mt-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse rounded-xl border border-border/30 p-4">
                    <div className="flex items-center justify-between">
                      <div className="h-4 w-40 bg-muted/60 rounded" />
                      <div className="h-3 w-14 bg-muted/40 rounded" />
                    </div>
                    <div className="h-3 w-64 bg-muted/30 rounded mt-2.5" />
                  </div>
                ))}
              </div>
            ) : chatPreviews.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <MessageSquare className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">No chats yet</p>
                <p className="text-xs mt-1 opacity-70">Start a conversation in this project</p>
              </div>
            ) : (
              <div className="mt-1">
                {chatPreviews.map((chat, idx) => (
                  <button
                    key={chat.id}
                    onClick={() => onSelectChat(chat.id)}
                    className={cn(
                      "w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-muted/40 transition-colors",
                      idx !== chatPreviews.length - 1 && "border-b border-border/30"
                    )}
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground/60" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-sm text-foreground truncate">
                          {chat.title}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatShortDate(chat.createdAt)}
                        </span>
                      </div>
                      {chat.preview && (
                        <p className="text-xs text-muted-foreground/70 mt-1 truncate">
                          {chat.preview}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Context rail — keyed by project so local edit state resets per project */}
        <ProjectContextRail key={project.id} project={project} onSaveContext={onSaveContext} onAddFiles={onAddFiles} />
      </div>
    </div>
  )
})
