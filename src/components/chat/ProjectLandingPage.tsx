'use client'

import { memo } from "react"
import { Folder, Plus, MessageSquare, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
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
  onSelectChat: (chatId: number) => void
  onCreateChat: () => void
  onAddFiles: () => void
  onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void
  onDeleteProject: (id: number) => void
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
  onSelectChat,
  onCreateChat,
  onAddFiles,
  onSaveContext,
  onDeleteProject,
}: ProjectLandingPageProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border/40">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
          <Folder className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-xl font-serif font-medium text-foreground">{project.name}</h1>
        <button
          onClick={() => onDeleteProject(project.id)}
          aria-label={`Delete project ${project.name}`}
          title="Delete project"
          className="ml-auto p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Chats column + context rail */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Chats */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* New Chat Row */}
          <button
            onClick={onCreateChat}
            className="flex items-center gap-3 mx-4 mt-4 px-4 py-3.5 rounded-xl border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">New chat in {project.name}</span>
          </button>

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
