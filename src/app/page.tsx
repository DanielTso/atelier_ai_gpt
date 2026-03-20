"use client"

import { AlertCircle } from "lucide-react"
import { useTheme } from "next-themes"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getProjects, createProject, getAllProjectChats, createChat, getChatMessages, saveMessage, deleteProject, updateProjectName, updateChatTitle, getStandaloneChats, createStandaloneChat, deleteChat, moveChatToProject, archiveChat, restoreChat, getArchivedChats, getMessageCount, getChatWithContext, updateChatSystemPrompt, getProjectDefaults, recordPersonaUsage, incrementUsageMessageCount, getProjectChatPreviews, saveMessageAttachments, getChatAttachments } from "./actions"
import { Sidebar } from "@/components/chat/Sidebar"
import { ChatHeader } from "@/components/chat/ChatHeader"
import { ChatInputArea } from "@/components/chat/ChatInputArea"
import { MessagesList, type ChatMessage } from "@/components/chat/MessagesList"
import { CommandPalette } from "@/components/ui/CommandPalette"
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog"
import { RenameDialog } from "@/components/ui/RenameDialog"
import { SystemPromptDialog } from "@/components/ui/SystemPromptDialog"
import { SettingsDialog } from "@/components/ui/SettingsDialog"
import { ProjectDefaultsDialog } from "@/components/ui/ProjectDefaultsDialog"
import { ProjectDocumentsDialog } from "@/components/ui/ProjectDocumentsDialog"
import { CreateProjectDialog } from "@/components/ui/CreateProjectDialog"
import { useAppearanceSettings } from "@/hooks/useAppearanceSettings"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { useSmartDefaults } from "@/hooks/useSmartDefaults"
import { usePersonas } from "@/hooks/usePersonas"
import { PersonaSuggestionBanner } from "@/components/chat/PersonaSuggestionBanner"
import { ProjectLandingPage } from "@/components/chat/ProjectLandingPage"
import type { AttachedFile, AttachedImage } from "@/lib/fileAttachments"
import { buildFileMessage } from "@/lib/fileAttachments"
import type { FileUIPart } from "ai"

interface Model {
  name: string
  model: string
  digest: string
}

// Types matching DB schema roughly
type Project = { id: number; name: string }
type Chat = { id: number; projectId: number | null; title: string; archived?: boolean | null }

export default function Home() {
  const { setTheme, theme } = useTheme()
  const [models, setModels] = useState<Model[]>([])
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const pendingImagesRef = useRef<AttachedImage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Use ref to always get current model in transport body function
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel

  // Data State
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [standaloneChats, setStandaloneChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<number | null>(null)

  // Project landing page state
  const [chatPreviews, setChatPreviews] = useState<{ id: number; title: string; preview: string | null; createdAt: Date | null }[]>([])
  const [chatPreviewsLoading, setChatPreviewsLoading] = useState(false)

  // Refs for values used in closures (must be after state declaration)
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const standaloneChatsRef = useRef(standaloneChats)
  standaloneChatsRef.current = standaloneChats

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Archived chats state
  const [archivedChats, setArchivedChats] = useState<Chat[]>([])

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: number; title: string } | null>(null)
  const [systemPromptDialogOpen, setSystemPromptDialogOpen] = useState(false)
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState<string | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [projectDefaultsDialogOpen, setProjectDefaultsDialogOpen] = useState(false)
  const [projectDefaultsTarget, setProjectDefaultsTarget] = useState<{ id: number; name: string } | null>(null)
  const [projectDocumentsDialogOpen, setProjectDocumentsDialogOpen] = useState(false)
  const [projectDocumentsTarget, setProjectDocumentsTarget] = useState<{ id: number; name: string } | null>(null)
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)

  // Sidebar collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('sidebar-collapsed', false)

  // Appearance settings
  const { fontSize, setFontSize, messageDensity, setMessageDensity } = useAppearanceSettings()

  // Persona management
  const { getPersonaById, getPersonaByPrompt } = usePersonas()

  // Create transport with body as function to always get current values
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => ({
      model: selectedModelRef.current,
      chatId: activeChatIdRef.current,
    }),
  }), [])

  // Context management configuration
  const SUMMARIZATION_THRESHOLD = 30 // Trigger summarization when message count exceeds this
  const MESSAGES_TO_KEEP = 10 // Keep this many recent messages after summarization

  const triggerSummarization = useCallback(async (chatId: number, messageCount: number) => {
    if (messageCount <= SUMMARIZATION_THRESHOLD) return

    // Calculate cutoff: summarize all but the most recent MESSAGES_TO_KEEP
    const messages = await getChatMessages(chatId)
    if (messages.length <= MESSAGES_TO_KEEP) return

    const cutoffIndex = messages.length - MESSAGES_TO_KEEP
    const cutoffMessageId = messages[cutoffIndex - 1]?.id

    if (!cutoffMessageId) return

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          cutoffMessageId,
          model: selectedModelRef.current,
        }),
      })

      if (response.ok) {
        await response.json()
        toast.success('Conversation summarized for better context management')
      }
    } catch (error) {
      console.error('[Summarization] Error:', error)
    }
  }, [])

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error: chatError
  } = useChat({
    transport,
    onFinish: async ({ message }) => {
      const currentChatId = activeChatIdRef.current
      const currentProjectId = activeProjectIdRef.current

      // Extract text content from message parts
      const textContent = message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map(part => part.text)
        .join('')

      if (currentChatId && (textContent.trim() || message.parts.some(p => p.type === 'file'))) {
        const result = await saveMessage(currentChatId, 'assistant', textContent || '(image)')

        // Save AI-generated images (file parts) to messageAttachments
        if (result?.[0]?.id) {
          console.log('[onFinish] message.parts types:', message.parts.map(p => ({ type: p.type, keys: Object.keys(p) })))
          const fileParts = message.parts.filter(
            (p): p is { type: 'file'; mediaType: string; url: string } =>
              p.type === 'file' && typeof (p as Record<string, unknown>).mediaType === 'string'
          )
          console.log('[onFinish] fileParts found:', fileParts.length)
          if (fileParts.length > 0) {
            try {
              await saveMessageAttachments(
                result[0].id,
                currentChatId,
                fileParts.map((p, i) => ({
                  filename: `generated-image-${i + 1}.png`,
                  mediaType: p.mediaType,
                  dataUrl: p.url,
                  fileSize: p.url.length,
                }))
              )
            } catch (err) {
              console.error('[onFinish] Failed to save image attachments:', err)
            }
          }
        }

        // Async embed the assistant message (best-effort)
        if (result?.[0]?.id && textContent.trim()) {
          fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: result[0].id,
              chatId: currentChatId,
              projectId: currentProjectId,
              content: textContent,
            }),
          }).catch(() => {}) // Embedding is best-effort
        }

        // Increment persona usage message count (best-effort)
        incrementUsageMessageCount(currentChatId).catch(() => {})

        // Check if summarization is needed
        const messageCount = await getMessageCount(currentChatId)
        if (messageCount > SUMMARIZATION_THRESHOLD) {
          triggerSummarization(currentChatId, messageCount)
        }

        // Auto-generate title when still "New Chat" (retries up to 10 messages)
        if (messageCount >= 2 && messageCount <= 10) {
          const chat = [...chatsRef.current, ...standaloneChatsRef.current]
            .find(c => c.id === currentChatId)
          if (chat && chat.title === 'New Chat') {
            const dbMessages = await getChatMessages(currentChatId, 2)
            const userMsg = dbMessages.find(m => m.role === 'user')
            try {
              // Truncate content for title generation to keep requests small
              const userSnippet = (userMsg?.content || '').slice(0, 500)
              const assistantSnippet = textContent.slice(0, 500)
              const res = await fetch('/api/generate-title', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chatId: currentChatId,
                  messages: [
                    { role: 'user', content: userSnippet },
                    { role: 'assistant', content: assistantSnippet },
                  ],
                  model: selectedModelRef.current,
                }),
              })
              if (res.ok) {
                const data = await res.json()
                if (data?.title) {
                  await updateChatTitle(currentChatId, data.title)
                  setChats(prev => prev.map(c =>
                    c.id === currentChatId ? { ...c, title: data.title } : c
                  ))
                  setStandaloneChats(prev => prev.map(c =>
                    c.id === currentChatId ? { ...c, title: data.title } : c
                  ))
                }
              }
            } catch {
              // Title generation is best-effort; silently ignore failures
            }
          }
        }
      }
    }
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // Extract user message texts for smart defaults
  const userMessageTexts = useMemo(() =>
    messages
      .filter(m => m.role === 'user')
      .map(m => m.parts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .join('') || ''
      ),
    [messages]
  )

  // Smart persona/model suggestions
  const { suggestion: smartSuggestion, dismiss: dismissSuggestion } = useSmartDefaults(
    activeProjectId,
    activeChatId,
    userMessageTexts,
    currentSystemPrompt ? 'has-persona' : null, // Simplified: if system prompt is set, don't suggest
  )

  const suggestedPersona = smartSuggestion.suggestedPersonaId
    ? getPersonaById(smartSuggestion.suggestedPersonaId)
    : null

  // Sync chat errors to UI
  useEffect(() => {
    if (chatError) {
      setError(chatError.message)
    }
  }, [chatError])

  // Auto-dismiss errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timeout)
    }
  }, [error])

  // Helper Functions defined with useCallback
  const fetchModels = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch("/api/models")
      if (!res.ok) throw new Error("Failed to fetch models")

      const data = await res.json()
      if (data.models) setModels(data.models)
      if (data.models?.length > 0) {
         setSelectedModel(data.models[0].model)
      } else {
         setError("No models found. Please check your Gemini API key or start Ollama.")
      }
    } catch (e) {
      console.error(e)
      setError("Failed to load models. Please check your configuration.")
    }
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      const p = await getProjects()
      setProjects(p)
    } catch (e) {
      console.error(e)
      setError("Failed to load projects.")
    }
  }, [])

  const loadStandaloneChats = useCallback(async () => {
    try {
      const c = await getStandaloneChats()
      setStandaloneChats(c)
    } catch (e) {
      console.error(e)
      setError("Failed to load chats.")
    }
  }, [])

  const loadArchivedChats = useCallback(async () => {
    try {
      const c = await getArchivedChats()
      setArchivedChats(c)
    } catch (e) {
      console.error(e)
      setError("Failed to load archived chats.")
    }
  }, [])

  const loadAllProjectChats = useCallback(async () => {
    try {
      const c = await getAllProjectChats()
      setChats(c)
    } catch (e) {
      console.error(e)
      setError("Failed to load chats.")
    }
  }, [])

  const loadMessages = useCallback(async (cid: number) => {
    try {
      const [msgs, attachments] = await Promise.all([
        getChatMessages(cid),
        getChatAttachments(cid),
      ])

      // Group attachments by messageId
      const attachmentsByMessageId = new Map<number, typeof attachments>()
      for (const att of attachments) {
        const existing = attachmentsByMessageId.get(att.messageId) ?? []
        existing.push(att)
        attachmentsByMessageId.set(att.messageId, existing)
      }

      // Convert DB messages to AI SDK UIMessage format with parts
      setMessages(msgs.map(m => {
        const msgAttachments = attachmentsByMessageId.get(m.id)
        const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mediaType: string; url: string }> = [
          { type: 'text' as const, text: m.content },
        ]
        // Append image file parts from saved attachments
        if (msgAttachments) {
          for (const att of msgAttachments) {
            parts.push({
              type: 'file' as const,
              mediaType: att.mediaType,
              url: att.dataUrl,
            })
          }
        }
        return {
          id: m.id.toString(),
          role: m.role as 'user' | 'assistant',
          parts,
          createdAt: m.createdAt ?? new Date(),
        }
      }))
    } catch (e) {
      console.error(e)
      setError("Failed to load messages.")
    }
  }, [setMessages])

  const refreshChatPreviews = useCallback(async () => {
    if (activeProjectId) {
      const previews = await getProjectChatPreviews(activeProjectId)
      setChatPreviews(previews)
    }
  }, [activeProjectId])

  // Load Projects and all chats on mount
  useEffect(() => {
    loadProjects()
    loadStandaloneChats()
    loadAllProjectChats()
    loadArchivedChats()
    fetchModels()
  }, [loadProjects, loadStandaloneChats, loadAllProjectChats, loadArchivedChats, fetchModels])

  // Load chat previews when viewing a project (no active chat)
  useEffect(() => {
    if (activeProjectId && !activeChatId) {
      setChatPreviewsLoading(true)
      getProjectChatPreviews(activeProjectId)
        .then(setChatPreviews)
        .catch(console.error)
        .finally(() => setChatPreviewsLoading(false))
    }
  }, [activeProjectId, activeChatId])

  // Load Messages and System Prompt when Chat Changes
  useEffect(() => {
    if (activeChatId) {
      loadMessages(activeChatId)
      // Load system prompt for this chat
      getChatWithContext(activeChatId).then(chat => {
        setCurrentSystemPrompt(chat?.systemPrompt ?? null)
      })
    } else {
      setMessages([])
      setCurrentSystemPrompt(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId])

  // Auto-scroll with requestAnimationFrame for smoother scrolling
  useEffect(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer) return

    const animationId = requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    })

    return () => cancelAnimationFrame(animationId)
  }, [messages])

  // Command palette keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(open => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleCreateProject = async () => {
    setCreateProjectDialogOpen(true)
  }

  const handleConfirmCreateProject = async (name: string) => {
    try {
      const [newP] = await createProject(name)
      setProjects([...projects, newP])
      setActiveProjectId(newP.id)
      toast.success("Project created")
    } catch (e) {
      console.error(e)
      setError("Failed to create project.")
    }
  }

  const handleCreateChat = async () => {
    if (!activeProjectId) {
      toast.error("Select a project first")
      return
    }
    try {
      const [newC] = await createChat(activeProjectId, "New Chat")
      setChats([newC, ...chats])
      setActiveChatId(newC.id)

      // Auto-apply project defaults if configured
      try {
        const defaults = await getProjectDefaults(activeProjectId)
        if (defaults.defaultPersonaId) {
          const persona = getPersonaById(defaults.defaultPersonaId)
          if (persona?.prompt) {
            await updateChatSystemPrompt(newC.id, persona.prompt)
            setCurrentSystemPrompt(persona.prompt)
            toast.success(`Applied project default: ${persona.name}`)
          }
        }
        if (defaults.defaultModel) {
          setSelectedModel(defaults.defaultModel)
        }
      } catch {
        // Defaults are optional, don't block chat creation
      }

      toast.success("Chat created")
    } catch (e) {
      console.error(e)
      setError("Failed to create chat.")
    }
  }

  const handleCreateChatInProject = async (projectId: number) => {
    try {
      setActiveProjectId(projectId)
      const [newC] = await createChat(projectId, "New Chat")
      setChats([newC, ...chats])
      setActiveChatId(newC.id)

      // Auto-apply project defaults if configured
      try {
        const defaults = await getProjectDefaults(projectId)
        if (defaults.defaultPersonaId) {
          const persona = getPersonaById(defaults.defaultPersonaId)
          if (persona?.prompt) {
            await updateChatSystemPrompt(newC.id, persona.prompt)
            setCurrentSystemPrompt(persona.prompt)
            toast.success(`Applied project default: ${persona.name}`)
          }
        }
        if (defaults.defaultModel) {
          setSelectedModel(defaults.defaultModel)
        }
      } catch {
        // Defaults are optional, don't block chat creation
      }

      toast.success("Chat created")
    } catch (e) {
      console.error(e)
      setError("Failed to create chat.")
    }
  }

  const handleCreateStandaloneChat = async () => {
    try {
      const [newC] = await createStandaloneChat("New Chat")
      setStandaloneChats([newC, ...standaloneChats])
      setActiveChatId(newC.id)
      setActiveProjectId(null) // Clear project selection
      toast.success("Chat created")
    } catch (e) {
      console.error(e)
      setError("Failed to create chat.")
    }
  }

  const handleSendMessage = async () => {
    if ((!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0) || isLoading) return

    // Auto-create a quick chat if no chat is selected
    if (!activeChatId) {
      try {
        const [newC] = await createStandaloneChat("New Chat")
        setStandaloneChats(prev => [newC, ...prev])
        setActiveChatId(newC.id)
        setActiveProjectId(null)
        // Wait for the chat to be set before sending
        // sendMessage will fire after activeChatId updates via the ref
        activeChatIdRef.current = newC.id
      } catch (e) {
        console.error(e)
        setError("Failed to create chat.")
        return
      }
    }

    // Capture images in ref before clearing state
    pendingImagesRef.current = [...attachedImages]

    const userMessage = attachedFiles.length > 0
      ? buildFileMessage(input.trim(), attachedFiles)
      : input.trim()

    // Build FileUIPart[] from attached images
    const fileParts: FileUIPart[] = attachedImages.map(img => ({
      type: 'file' as const,
      mediaType: img.mediaType,
      url: img.dataUrl,
    }))

    setInput("")
    setAttachedFiles([])
    setAttachedImages([])

    if (fileParts.length > 0) {
      await sendMessage({ text: userMessage, files: fileParts })
    } else {
      await sendMessage({ text: userMessage })
    }
  }

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    handleSendMessage()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Ctrl+Enter or Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSendMessage()
    }
    // Clear on Escape
    if (e.key === 'Escape') {
      setInput("")
      ;(e.target as HTMLTextAreaElement).blur()
    }
  }

  // Save user messages to database when messages array changes
  useEffect(() => {
    if (messages.length === 0 || !activeChatId) return

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role === 'user') {
      // Extract text content from message parts
      const textContent = lastMessage.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map(part => part.text)
        .join('')
      // Save user message to database and trigger embedding
      saveMessage(activeChatId, 'user', textContent)
        .then((result) => {
          // Async embed the user message (best-effort)
          if (result?.[0]?.id) {
            const messageId = result[0].id
            fetch('/api/embed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messageId,
                chatId: activeChatId,
                projectId: activeProjectIdRef.current,
                content: textContent,
              }),
            }).catch(() => {}) // Embedding is best-effort

            // Save image attachments if any were pending
            const pending = pendingImagesRef.current
            if (pending.length > 0) {
              pendingImagesRef.current = []
              saveMessageAttachments(
                messageId,
                activeChatId,
                pending.map(img => ({
                  filename: img.name,
                  mediaType: img.mediaType,
                  dataUrl: img.dataUrl,
                  fileSize: img.size,
                }))
              ).catch(err => console.error('[useEffect] Error saving attachments:', err))
            }
          }
        })
        .catch(err => console.error('[useEffect] Error saving user message:', err))
    }
  }, [messages, activeChatId])

  const handleDeleteProject = useCallback(async (id: number) => {
    await deleteProject(id)
    setProjects(projects.filter(p => p.id !== id))
    if (activeProjectId === id) setActiveProjectId(null)
    toast.success("Project deleted")
  }, [projects, activeProjectId])

  const handleRenameProject = useCallback(async (id: number, name: string) => {
    try {
      await updateProjectName(id, name)
      setProjects(projects.map(p => p.id === id ? { ...p, name } : p))
      toast.success("Project renamed")
    } catch (e) {
      console.error(e)
      setError("Failed to rename project.")
    }
  }, [projects])

  const handleRequestDelete = useCallback((id: number) => {
    setDeleteTargetId(id)
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTargetId) return
    try {
      await deleteChat(deleteTargetId)
      setChats(chats.filter(c => c.id !== deleteTargetId))
      setStandaloneChats(standaloneChats.filter(c => c.id !== deleteTargetId))
      setArchivedChats(archivedChats.filter(c => c.id !== deleteTargetId))
      if (activeChatId === deleteTargetId) setActiveChatId(null)
      setDeleteTargetId(null)
      refreshChatPreviews()
      toast.success("Chat deleted")
    } catch (e) {
      console.error("Delete failed:", e)
      toast.error("Failed to delete chat")
    }
  }, [deleteTargetId, chats, standaloneChats, archivedChats, activeChatId, refreshChatPreviews])

  const handleRequestRename = useCallback((id: number) => {
    const chat = [...chats, ...standaloneChats, ...archivedChats].find(c => c.id === id)
    if (chat) {
      setRenameTarget({ id: chat.id, title: chat.title })
      setRenameDialogOpen(true)
    }
  }, [chats, standaloneChats, archivedChats])

  const handleConfirmRename = useCallback(async (newTitle: string) => {
    if (!renameTarget) return
    await updateChatTitle(renameTarget.id, newTitle)
    setChats(chats.map(c => c.id === renameTarget.id ? { ...c, title: newTitle } : c))
    setStandaloneChats(standaloneChats.map(c => c.id === renameTarget.id ? { ...c, title: newTitle } : c))
    setArchivedChats(archivedChats.map(c => c.id === renameTarget.id ? { ...c, title: newTitle } : c))
    setRenameTarget(null)
    refreshChatPreviews()
    toast.success("Chat renamed")
  }, [renameTarget, chats, standaloneChats, archivedChats, refreshChatPreviews])

  const handleMoveChat = useCallback(async (chatId: number, projectId: number | null) => {
    await moveChatToProject(chatId, projectId)
    // Refresh all chat lists
    loadStandaloneChats()
    loadAllProjectChats()
    refreshChatPreviews()
    toast.success(projectId ? "Chat moved to project" : "Chat moved to Quick Chats")
  }, [loadAllProjectChats, loadStandaloneChats, refreshChatPreviews])

  const handleArchiveChat = useCallback(async (chatId: number) => {
    await archiveChat(chatId)
    setChats(chats.filter(c => c.id !== chatId))
    setStandaloneChats(standaloneChats.filter(c => c.id !== chatId))
    if (activeChatId === chatId) setActiveChatId(null)
    loadArchivedChats()
    toast.success("Chat archived")
  }, [chats, standaloneChats, activeChatId, loadArchivedChats])

  const handleRestoreChat = useCallback(async (chatId: number) => {
    await restoreChat(chatId)
    loadArchivedChats()
    loadStandaloneChats()
    loadAllProjectChats()
    toast.success("Chat restored")
  }, [loadArchivedChats, loadStandaloneChats, loadAllProjectChats])

  const handleSelectProject = useCallback((id: number) => {
    setActiveProjectId(id)
    setActiveChatId(null) // Reset chat when switching project
  }, [])

  const handleSelectStandaloneChat = useCallback((id: number) => {
    setActiveProjectId(null) // Clear project when selecting standalone chat
    setActiveChatId(id)
  }, [])

  const handleUpdateChatTitle = useCallback(async (id: number, title: string) => {
    try {
      await updateChatTitle(id, title)
      // Update local state for both types of chats
      setChats(chats.map(c => c.id === id ? { ...c, title } : c))
      setStandaloneChats(standaloneChats.map(c => c.id === id ? { ...c, title } : c))
    } catch (e) {
      console.error(e)
      setError("Failed to update chat title.")
    }
  }, [chats, standaloneChats])

  const handleSaveSystemPrompt = useCallback(async (prompt: string | null) => {
    if (!activeChatId) return
    try {
      await updateChatSystemPrompt(activeChatId, prompt)
      setCurrentSystemPrompt(prompt)
      toast.success(prompt ? "System instruction saved" : "System instruction cleared")

      // Record persona usage for tracking
      const matchedPersona = getPersonaByPrompt(prompt)
      recordPersonaUsage({
        projectId: activeProjectIdRef.current,
        chatId: activeChatId,
        personaId: matchedPersona?.id ?? (prompt ? 'custom' : 'default'),
        modelUsed: selectedModelRef.current || null,
      }).catch(() => {}) // Best-effort
    } catch (e) {
      console.error(e)
      setError("Failed to update system instruction.")
    }
  }, [activeChatId])

  const handleOpenProjectSettings = useCallback((projectId: number) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      setProjectDefaultsTarget({ id: project.id, name: project.name })
      setProjectDefaultsDialogOpen(true)
    }
  }, [projects])

  const handleOpenProjectDocuments = useCallback((projectId: number) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      setProjectDocumentsTarget({ id: project.id, name: project.name })
      setProjectDocumentsDialogOpen(true)
    }
  }, [projects])

  const handleApplySuggestion = useCallback(async () => {
    if (!suggestedPersona) return
    await handleSaveSystemPrompt(suggestedPersona.prompt || null)
    if (suggestedPersona.preferredModel) {
      setSelectedModel(suggestedPersona.preferredModel)
    }
    dismissSuggestion()
    toast.success(`Switched to ${suggestedPersona.name}`)
  }, [suggestedPersona, handleSaveSystemPrompt, dismissSuggestion])

  // Get the current chat title from either chats or standaloneChats
  const currentChatTitle = activeChatId
    ? chats.find(c => c.id === activeChatId)?.title || standaloneChats.find(c => c.id === activeChatId)?.title
    : undefined

  return (
    <div className={cn(
      "flex h-screen w-full overflow-hidden p-4 gap-4",
      fontSize === 'small' && 'text-sm',
      fontSize === 'large' && 'text-lg',
    )}>
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        chats={chats}
        activeChatId={activeChatId}
        standaloneChats={standaloneChats}
        archivedChats={archivedChats}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onThemeToggle={() => setTheme(theme === "dark" ? "light" : "dark")}
        onCreateProject={handleCreateProject}
        onCreateChat={handleCreateChat}
        onCreateStandaloneChat={handleCreateStandaloneChat}
        onCreateChatInProject={handleCreateChatInProject}
        onSelectProject={handleSelectProject}
        onSelectChat={setActiveChatId}
        onSelectStandaloneChat={handleSelectStandaloneChat}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onMoveChat={handleMoveChat}
        onRenameChat={handleRequestRename}
        onArchiveChat={handleArchiveChat}
        onRestoreChat={handleRestoreChat}
        onDeleteChat={handleRequestDelete}
        onOpenSettings={() => setSettingsDialogOpen(true)}
        onProjectSettings={handleOpenProjectSettings}
        onProjectDocuments={handleOpenProjectDocuments}
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden relative">
        {activeChatId ? (
          <>
            <ChatHeader
              chatId={activeChatId}
              chatTitle={currentChatTitle}
              onTitleChange={handleUpdateChatTitle}
            />

            {/* Error Banner */}
            {error && (
              <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2 flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
                  Dismiss
                </button>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className={cn(
              "flex-1 overflow-y-auto p-6",
              messageDensity === 'compact' && 'space-y-2',
              messageDensity === 'comfortable' && 'space-y-6',
              messageDensity === 'spacious' && 'space-y-10',
            )}>
              <MessagesList
                messages={messages as ChatMessage[]}
                isLoading={isLoading}
                activeChatId={activeChatId}
                selectedModel={selectedModel}
              />
            </div>

            {/* Smart Persona Suggestion */}
            {suggestedPersona && smartSuggestion.reason && (
              <div className="px-4 pt-2">
                <PersonaSuggestionBanner
                  personaName={suggestedPersona.name}
                  personaIcon={suggestedPersona.icon}
                  reason={smartSuggestion.reason}
                  onApply={handleApplySuggestion}
                  onDismiss={dismissSuggestion}
                  visible={true}
                />
              </div>
            )}

            {/* Input Area */}
            <ChatInputArea
              input={input}
              onInputChange={setInput}
              onSend={handleSendMessage}
              onFormSubmit={handleFormSubmit}
              onKeyDown={handleKeyDown}
              isLoading={isLoading}
              activeChatId={activeChatId}
              activeProjectId={activeProjectId}
              systemPrompt={currentSystemPrompt}
              onSystemPromptChange={handleSaveSystemPrompt}
              onSystemPromptClick={() => setSystemPromptDialogOpen(true)}
              models={models}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              attachedFiles={attachedFiles}
              onFilesChange={setAttachedFiles}
              attachedImages={attachedImages}
              onImagesChange={setAttachedImages}
            />
          </>
        ) : activeProjectId ? (
          <ProjectLandingPage
            project={projects.find(p => p.id === activeProjectId)!}
            chatPreviews={chatPreviews}
            loading={chatPreviewsLoading}
            onSelectChat={setActiveChatId}
            onCreateChat={handleCreateChat}
            onAddFiles={() => handleOpenProjectDocuments(activeProjectId)}
          />
        ) : (
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <img src="/logo.svg" alt="Atelier AI" className="h-12 w-12 opacity-60" />
              <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                Atelier AI
              </h2>
              <p className="text-sm text-muted-foreground">Start typing to begin a conversation</p>
            </div>
            <ChatInputArea
              input={input}
              onInputChange={setInput}
              onSend={handleSendMessage}
              onFormSubmit={handleFormSubmit}
              onKeyDown={handleKeyDown}
              isLoading={isLoading}
              activeChatId={activeChatId}
              activeProjectId={activeProjectId}
              systemPrompt={currentSystemPrompt}
              onSystemPromptChange={handleSaveSystemPrompt}
              onSystemPromptClick={() => setSystemPromptDialogOpen(true)}
              models={models}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              attachedFiles={attachedFiles}
              onFilesChange={setAttachedFiles}
              attachedImages={attachedImages}
              onImagesChange={setAttachedImages}
            />
          </>
        )}
      </main>

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onNewChat={handleCreateStandaloneChat}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        projects={projects}
        standaloneChats={standaloneChats}
        chats={chats}
        onSelectProject={handleSelectProject}
        onSelectChat={setActiveChatId}
        onSelectStandaloneChat={handleSelectStandaloneChat}
      />

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onOpenChange={setCreateProjectDialogOpen}
        onCreate={handleConfirmCreateProject}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Chat"
        description="Are you sure you want to delete this chat? This action cannot be undone."
        onConfirm={handleConfirmDelete}
      />

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        currentTitle={renameTarget?.title ?? ""}
        onRename={handleConfirmRename}
      />

      {/* System Prompt Dialog */}
      <SystemPromptDialog
        open={systemPromptDialogOpen}
        onOpenChange={setSystemPromptDialogOpen}
        currentPrompt={currentSystemPrompt}
        onSave={handleSaveSystemPrompt}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        models={models}
        onSettingsChanged={fetchModels}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        messageDensity={messageDensity}
        onMessageDensityChange={setMessageDensity}
      />

      {/* Project Defaults Dialog */}
      {projectDefaultsTarget && (
        <ProjectDefaultsDialog
          open={projectDefaultsDialogOpen}
          onOpenChange={setProjectDefaultsDialogOpen}
          projectId={projectDefaultsTarget.id}
          projectName={projectDefaultsTarget.name}
          models={models}
        />
      )}

      {/* Project Documents Dialog */}
      {projectDocumentsTarget && (
        <ProjectDocumentsDialog
          open={projectDocumentsDialogOpen}
          onOpenChange={setProjectDocumentsDialogOpen}
          projectId={projectDocumentsTarget.id}
          projectName={projectDocumentsTarget.name}
        />
      )}
    </div>
  )
}
