"use client"

import { Command } from "cmdk"
import { useState, memo } from "react"
import { MessageSquare, Sun, Moon, Plus, Folder, Cpu, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Model } from "@/types"

interface Project {
  id: number
  name: string
}

interface Chat {
  id: number
  projectId: number | null
  title: string
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewChat: () => void
  onToggleTheme: () => void
  models: Model[]
  selectedModel: string
  onModelChange: (model: string) => void
  projects: Project[]
  standaloneChats: Chat[]
  chats: Chat[]
  onSelectProject: (id: number) => void
  onSelectChat: (id: number) => void
  onSelectStandaloneChat: (id: number) => void
}

export const CommandPalette = memo(function CommandPalette({
  open,
  onOpenChange,
  onNewChat,
  onToggleTheme,
  models,
  selectedModel,
  onModelChange,
  projects,
  standaloneChats,
  chats,
  onSelectProject,
  onSelectChat,
  onSelectStandaloneChat,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("")

  // Handler to close and reset search
  const handleClose = () => {
    setSearch("")
    onOpenChange(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={handleClose}
      />

      {/* Command Dialog */}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg animate-in fade-in slide-in-from-bottom-4 duration-200">
        <Command
          className="bg-popover border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          shouldFilter={true}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground bg-white/5 rounded border border-white/10">
              esc
            </kbd>
          </div>

          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Quick Actions */}
            <Command.Group heading="Quick Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
              <CommandItem
                onSelect={() => {
                  onNewChat()
                  handleClose()
                }}
              >
                <Plus className="h-4 w-4" />
                <span>New Chat</span>
                <kbd className="ml-auto text-xs text-muted-foreground">Create</kbd>
              </CommandItem>

              <CommandItem
                onSelect={() => {
                  onToggleTheme()
                  handleClose()
                }}
              >
                <Sun className="h-4 w-4 dark:hidden" />
                <Moon className="h-4 w-4 hidden dark:block" />
                <span>Toggle Theme</span>
                <kbd className="ml-auto text-xs text-muted-foreground">Appearance</kbd>
              </CommandItem>
            </Command.Group>

            {/* Models */}
            {models.length > 0 && (
              <Command.Group heading="Switch Model" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {models.map((model) => (
                  <CommandItem
                    key={model.digest}
                    onSelect={() => {
                      onModelChange(model.model)
                      handleClose()
                    }}
                  >
                    <Cpu className="h-4 w-4" />
                    <span>{model.name}</span>
                    {selectedModel === model.model && (
                      <span className="ml-auto text-xs text-primary">Active</span>
                    )}
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Standalone Chats */}
            {standaloneChats.length > 0 && (
              <Command.Group heading="Quick Chats" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {standaloneChats.map((chat) => (
                  <CommandItem
                    key={chat.id}
                    onSelect={() => {
                      onSelectStandaloneChat(chat.id)
                      handleClose()
                    }}
                  >
                    <MessageSquare className="h-4 w-4" />
                    <span>{chat.title}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Projects */}
            {projects.length > 0 && (
              <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    onSelect={() => {
                      onSelectProject(project.id)
                      handleClose()
                    }}
                  >
                    <Folder className="h-4 w-4" />
                    <span>{project.name}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Project Chats */}
            {chats.length > 0 && (
              <Command.Group heading="Project Chats" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {chats.map((chat) => (
                  <CommandItem
                    key={chat.id}
                    onSelect={() => {
                      onSelectChat(chat.id)
                      handleClose()
                    }}
                  >
                    <MessageSquare className="h-4 w-4" />
                    <span>{chat.title}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="px-4 py-2 border-t border-white/10 flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">up/down</kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">enter</kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">esc</kbd>
              <span>Close</span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  )
})

function CommandItem({
  children,
  onSelect,
}: {
  children: React.ReactNode
  onSelect: () => void
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm",
        "text-foreground/80 hover:text-foreground",
        "data-[selected=true]:bg-white/10 data-[selected=true]:text-foreground",
        "transition-colors"
      )}
    >
      {children}
    </Command.Item>
  )
}
