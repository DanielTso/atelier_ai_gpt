"use client"

import { AlertCircle, Menu } from "lucide-react"
import { useTheme } from "next-themes"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { extractText } from "@/lib/messageParts"
import { getProjects, createProject, getAllProjectChats, createChat, getChatMessages, saveMessage, deleteProject, updateProjectName, updateProjectContext, updateChatTitle, getStandaloneChats, createStandaloneChat, deleteChat, moveChatToProject, archiveChat, restoreChat, getArchivedChats, getMessageCount, getChatWithContext, updateChatSystemPrompt, getProjectDefaults, recordPersonaUsage, incrementUsageMessageCount, getProjectChatPreviews, saveMessageAttachments, saveGeneratedImage, getChatAttachments, getSetting, setSetting } from "./actions"
import { Sidebar } from "@/components/chat/sidebar"
import type { SidebarActions, AppView } from "@/components/chat/sidebar"
import { HomeGreeting } from "@/components/chat/HomeGreeting"
import { QuickActions } from "@/components/chat/QuickActions"
import { ProjectsView } from "@/components/chat/ProjectsView"
import { ArtifactsView } from "@/components/chat/ArtifactsView"
import { ArtifactWorkspace } from "@/components/chat/ArtifactWorkspace"
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
import { usePersonas, type Effort } from "@/hooks/usePersonas"
import { PersonaSuggestionBanner } from "@/components/chat/PersonaSuggestionBanner"
import { ProjectLandingPage } from "@/components/chat/ProjectLandingPage"
import type { AttachedFile, AttachedImage } from "@/lib/fileAttachments"
import { buildFileMessage } from "@/lib/fileAttachments"
import type { FileUIPart } from "ai"
import type { Model, ArtifactSummary } from "@/types"
import { extractGeneratedImageOutputs } from "@/lib/generatedImages"
import { useChatTitle } from "@/hooks/useChatTitle"
import { useSummarization, SUMMARIZATION_THRESHOLD } from "@/hooks/useSummarization"

// Types matching DB schema roughly
type Project = { id: number; name: string; memory?: string | null; instructions?: string | null; createdAt?: Date | null; updatedAt?: Date | null }
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

  // Dedup ref for message saving
  const lastSavedMessageIdRef = useRef<string | null>(null)

  // Data State
  const [projects, setProjects] = useState<Project[]>([])
  // Not persisted: the app should start on Home each launch, not reopen the last project/chat.
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [standaloneChats, setStandaloneChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<AppView>('home')
  const [displayName, setDisplayName] = useState('')

  // Project landing page state
  const [chatPreviews, setChatPreviews] = useState<{ id: number; title: string; preview: string | null; createdAt: Date | null }[]>([])
  const [chatPreviewsLoading, setChatPreviewsLoading] = useState(false)

  // Artifact state
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<number | null>(null)

  // Refs for values used in closures (must be after state declaration)
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const standaloneChatsRef = useRef(standaloneChats)
  standaloneChatsRef.current = standaloneChats

  // Auto-name a still-"New Chat" once it has a full exchange. Logic lives in useChatTitle;
  // page state is injected via stable callbacks.
  const readTitleChats = useCallback(
    () => [...chatsRef.current, ...standaloneChatsRef.current].map(c => ({ id: c.id, title: c.title })),
    [],
  )
  const applyChatTitle = useCallback((chatId: number, title: string) => {
    setChats(prev => prev.map(c => (c.id === chatId ? { ...c, title } : c)))
    setStandaloneChats(prev => prev.map(c => (c.id === chatId ? { ...c, title } : c)))
  }, [])
  const maybeGenerateTitle = useChatTitle({ readChats: readTitleChats, modelRef: selectedModelRef, applyTitle: applyChatTitle })

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Archived chats state
  const [archivedChats, setArchivedChats] = useState<Chat[]>([])

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false)
  const [deleteProjectTargetId, setDeleteProjectTargetId] = useState<number | null>(null)
  const [renameProjectDialogOpen, setRenameProjectDialogOpen] = useState(false)
  const [renameProjectTarget, setRenameProjectTarget] = useState<{ id: number; name: string } | null>(null)
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
  const [artifactPanelWidth, setArtifactPanelWidth] = useLocalStorage('artifact-panel-width', 448)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  sidebarCollapsedRef.current = sidebarCollapsed
  const autoCollapsedSidebarRef = useRef(false)

  // Appearance settings
  const { fontSize, setFontSize, messageDensity, setMessageDensity } = useAppearanceSettings()

  // Persona management
  const { getPersonaById, getPersonaByPrompt, defaultPersona } = usePersonas()

  // Reasoning effort (Claude adaptive thinking). Defaults to the default persona's
  // effort; selecting a persona sets it; the composer effort pill can override it.
  const [selectedEffort, setSelectedEffort] = useState<Effort | undefined>(defaultPersona.effort)
  const selectedEffortRef = useRef(selectedEffort)
  selectedEffortRef.current = selectedEffort
  const handleEffortChange = useCallback((effort?: Effort) => setSelectedEffort(effort), [])

  // Create transport with body as function to always get current values
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => ({
      model: selectedModelRef.current,
      chatId: activeChatIdRef.current,
      effort: selectedEffortRef.current,
    }),
  }), [])

  // Auto-memory: per-chat message count at the last suggestion pass. Gating on a
  // monotonic delta (count - last >= 6) instead of `count % 6` avoids both missed
  // boundaries (count jumps) and double-fires (overlapping onFinish).
  const lastSuggestedAtRef = useRef<Map<number, number>>(new Map())
  const MEMORY_SUGGEST_EVERY = 6

  // Context-window management (auto-summarize older messages past the threshold).
  const triggerSummarization = useSummarization(selectedModelRef)

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
      const textContent = extractText(message.parts)
      // Images produced by the generate_image tool (surfaced as tool-result parts).
      const imageOutputs = extractGeneratedImageOutputs(message.parts)
      // Artifacts produced by the generate_artifact tool surface as tool-result parts
      // (not file parts). Detect them so an artifact-only turn (no prose) is still saved.
      const hasArtifactOutput = message.parts.some(
        p => typeof p.type === 'string' && p.type.startsWith('tool-generate_artifact')
      )

      if (currentChatId && (textContent.trim() || message.parts.some(p => p.type === 'file') || imageOutputs.length > 0 || hasArtifactOutput)) {
        // Persist empty content (not an '(image)' placeholder) for media-only turns:
        // loadMessages reconstructs the image/artifact, and an empty string renders no
        // stray text bubble on reload (the old placeholder leaked the literal "(image)").
        const result = await saveMessage(currentChatId, 'assistant', textContent)

        // Persist + inline-render images from the generate_image tool. The bytes are
        // already in storage (uploaded by the tool); link them to this message, then
        // optimistically append file parts so they show without a reload.
        if (result?.[0]?.id && imageOutputs.length > 0) {
          try {
            await saveGeneratedImage(result[0].id, currentChatId, imageOutputs.map(o => ({
              storagePath: o.storagePath, mediaType: o.mediaType, filename: o.filename ?? 'generated-image.png',
            })))
          } catch (err) {
            console.error('[onFinish] Failed to save generated image:', err)
          }
          setMessages(prev => prev.map(m => m.id === message.id
            ? { ...m, parts: [...m.parts, ...imageOutputs.map(o => ({ type: 'file' as const, mediaType: o.mediaType, url: o.url }))] }
            : m))
        }

        // Save AI-generated images (file parts) to messageAttachments
        if (result?.[0]?.id) {
          const fileParts = message.parts.filter(
            (p): p is { type: 'file'; mediaType: string; url: string } =>
              p.type === 'file' && typeof (p as Record<string, unknown>).mediaType === 'string'
          )
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
          triggerSummarization(currentChatId, messageCount).catch(() => {})
        }

        // Best-effort: throttled auto-memory suggestion pass (project chats only).
        // Monotonic gate — fire once per ~6 new messages, robust to count jumps.
        const lastSuggested = lastSuggestedAtRef.current.get(currentChatId) ?? 0
        if (currentProjectId && messageCount - lastSuggested >= MEMORY_SUGGEST_EVERY) {
          lastSuggestedAtRef.current.set(currentChatId, messageCount)
          getChatMessages(currentChatId, 12)
            .then(dbMessages =>
              fetch('/api/memory/suggest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectId: currentProjectId,
                  chatId: currentChatId,
                  messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
                }),
              })
            )
            .catch(() => {}) // suggestion pass is best-effort
        }

        // Auto-generate the chat title once there's a full exchange (best-effort).
        maybeGenerateTitle(currentChatId)

        // Best-effort: re-fetch artifacts so a freshly-generated one appears
        fetch(`/api/artifacts?chatId=${currentChatId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.artifacts) setArtifacts(data.artifacts) })
          .catch(() => {})
      }
    }
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // Extract user message texts for smart defaults
  const userMessageTexts = useMemo(() =>
    messages
      .filter(m => m.role === 'user')
      .map(m => extractText(m.parts)),
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
         // Use configured default model if it exists in the available models
         const defaultModel = await getSetting('default-model')
         const modelExists = defaultModel && data.models.some((m: { model: string }) => m.model === defaultModel)
         // Fallback seeds from the default persona's model (Sonnet 4.6) if available,
         // else the first listed model — keeps model + default persona consistent.
         const personaModelAvailable = data.models.some((m: { model: string }) => m.model === defaultPersona.model)
         const fallbackModel = personaModelAvailable ? defaultPersona.model : data.models[0].model
         setSelectedModel(modelExists ? defaultModel : fallbackModel)
      } else {
         setError("No models found. Please check your API keys in Settings.")
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

      // Best-effort: fetch artifacts for this chat
      try {
        const artifactsRes = await fetch(`/api/artifacts?chatId=${cid}`)
        if (artifactsRes.ok) {
          const artifactsData = await artifactsRes.json()
          setArtifacts(artifactsData.artifacts ?? [])
        }
      } catch {
        // Artifact fetch failure must not break message loading
      }

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
        // Skip empty text parts: media-only turns (generated image / artifact) are saved
        // with empty content, and a blank text part would otherwise render a stray bubble.
        const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mediaType: string; url: string }> =
          m.content ? [{ type: 'text' as const, text: m.content }] : []
        // Append image file parts from saved attachments. `url` is resolved
        // server-side: a signed Storage URL for storage-backed rows, or the
        // legacy base64 data URL for old rows. Skip any that failed to resolve.
        if (msgAttachments) {
          for (const att of msgAttachments) {
            if (!att.url) continue
            parts.push({
              type: 'file' as const,
              mediaType: att.mediaType,
              url: att.url,
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

  // Validate persisted activeChatId/activeProjectId after data loads
  useEffect(() => {
    if (activeChatId !== null) {
      const allChats = [...chats, ...standaloneChats]
      if (allChats.length > 0 && !allChats.find(c => c.id === activeChatId)) {
        setActiveChatId(null)
      }
    }
    if (activeProjectId !== null) {
      if (projects.length > 0 && !projects.find(p => p.id === activeProjectId)) {
        setActiveProjectId(null)
      }
    }
  }, [projects, chats, standaloneChats]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Backfill the title if this chat is still "New Chat" but already has an exchange.
      maybeGenerateTitle(activeChatId)
      // Load system prompt for this chat
      getChatWithContext(activeChatId).then(chat => {
        setCurrentSystemPrompt(chat?.systemPrompt ?? null)
      })
    } else {
      setMessages([])
      setCurrentSystemPrompt(null)
      setArtifacts([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId])

  // Auto-collapse the sidebar when a wide artifact panel would cramp the chat, and
  // restore it when the panel narrows or the artifact closes. Keyed only on the panel
  // width + whether an artifact is open (NOT on sidebarCollapsed) so it reacts to drags
  // without fighting a manual sidebar toggle. We only auto-restore what we auto-collapsed.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (activeArtifactId == null) {
      if (autoCollapsedSidebarRef.current) {
        autoCollapsedSidebarRef.current = false
        setSidebarCollapsed(false)
      }
      return
    }
    // "Cramped" = the chat column would be narrower than ~520px with the sidebar expanded.
    const SIDEBAR_W = 288
    const cramped = window.innerWidth - SIDEBAR_W - artifactPanelWidth < 520
    if (cramped && !sidebarCollapsedRef.current) {
      autoCollapsedSidebarRef.current = true
      setSidebarCollapsed(true)
    } else if (!cramped && autoCollapsedSidebarRef.current) {
      autoCollapsedSidebarRef.current = false
      setSidebarCollapsed(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactPanelWidth, activeArtifactId])

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

  // Create a "New Chat" in the given project, make it active, and apply the project's
  // configured defaults (persona system prompt + model). Shared by the toolbar "+"
  // (current project) and the projects-view per-project create.
  const createChatForProject = async (projectId: number) => {
    try {
      setActiveProjectId(projectId)
      const [newC] = await createChat(projectId, "New Chat")
      setChats(prev => [newC, ...prev])
      setActiveChatId(newC.id)

      // Auto-apply project defaults if configured (optional — never blocks creation).
      try {
        const defaults = await getProjectDefaults(projectId)
        if (defaults.defaultPersonaId) {
          const persona = getPersonaById(defaults.defaultPersonaId)
          if (persona?.prompt) {
            await updateChatSystemPrompt(newC.id, persona.prompt)
            setCurrentSystemPrompt(persona.prompt)
            setSelectedEffort(persona.effort)
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

  const handleCreateChat = async () => {
    if (!activeProjectId) {
      toast.error("Select a project first")
      return
    }
    await createChatForProject(activeProjectId)
  }

  const handleCreateChatInProject = (projectId: number) => createChatForProject(projectId)

  // "New chat" goes to a fresh Home compose — it does NOT persist an empty chat.
  // The first message sent auto-creates the standalone chat (see handleSendMessage),
  // so clicking New chat repeatedly no longer spawns empty "New Chat" rows.
  const handleCreateStandaloneChat = () => {
    setActiveView('home')
    setActiveChatId(null)
    setActiveProjectId(null)
    setInput('')
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
    // Enter sends; Shift+Enter inserts a newline. Ignore Enter while an IME
    // composition is active (e.g. CJK input) so it doesn't send mid-word.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    if (lastMessage.role === 'user' && lastMessage.id !== lastSavedMessageIdRef.current) {
      lastSavedMessageIdRef.current = lastMessage.id
      // Extract text content from message parts
      const textContent = extractText(lastMessage.parts)
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

  const handleRequestDeleteProject = useCallback((id: number) => {
    setDeleteProjectTargetId(id)
    setDeleteProjectDialogOpen(true)
  }, [])

  const handleConfirmDeleteProject = useCallback(async () => {
    if (deleteProjectTargetId == null) return
    try {
      await deleteProject(deleteProjectTargetId)
      setProjects(prev => prev.filter(p => p.id !== deleteProjectTargetId))
      if (activeProjectId === deleteProjectTargetId) setActiveProjectId(null)
      setDeleteProjectTargetId(null)
      toast.success("Project deleted")
    } catch (e) {
      console.error("Delete project failed:", e)
      toast.error("Failed to delete project")
    }
  }, [deleteProjectTargetId, activeProjectId])

  const handleRenameProject = useCallback(async (id: number, name: string) => {
    try {
      await updateProjectName(id, name)
      setProjects(prev => prev.map(p => p.id === id ? { ...p, name, updatedAt: new Date() } : p))
      toast.success("Project renamed")
    } catch (e) {
      console.error(e)
      setError("Failed to rename project.")
    }
  }, [])

  const handleRequestRenameProject = useCallback((id: number) => {
    const project = projects.find(p => p.id === id)
    if (project) {
      setRenameProjectTarget({ id: project.id, name: project.name })
      setRenameProjectDialogOpen(true)
    }
  }, [projects])

  const handleConfirmRenameProject = useCallback((name: string) => {
    if (renameProjectTarget) handleRenameProject(renameProjectTarget.id, name)
  }, [renameProjectTarget, handleRenameProject])

  const handleRequestDelete = useCallback((id: number) => {
    setDeleteTargetId(id)
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTargetId) return
    try {
      await deleteChat(deleteTargetId)
      setChats(prev => prev.filter(c => c.id !== deleteTargetId))
      setStandaloneChats(prev => prev.filter(c => c.id !== deleteTargetId))
      setArchivedChats(prev => prev.filter(c => c.id !== deleteTargetId))
      if (activeChatId === deleteTargetId) setActiveChatId(null)
      setDeleteTargetId(null)
      refreshChatPreviews()
      toast.success("Chat deleted")
    } catch (e) {
      console.error("Delete failed:", e)
      toast.error("Failed to delete chat")
    }
  }, [deleteTargetId, activeChatId, refreshChatPreviews])

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
    setChats(prev => prev.map(c => c.id === renameTarget.id ? { ...c, title: newTitle } : c))
    setStandaloneChats(prev => prev.map(c => c.id === renameTarget.id ? { ...c, title: newTitle } : c))
    setArchivedChats(prev => prev.map(c => c.id === renameTarget.id ? { ...c, title: newTitle } : c))
    setRenameTarget(null)
    refreshChatPreviews()
    toast.success("Chat renamed")
  }, [renameTarget, refreshChatPreviews])

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
    setChats(prev => prev.filter(c => c.id !== chatId))
    setStandaloneChats(prev => prev.filter(c => c.id !== chatId))
    if (activeChatId === chatId) setActiveChatId(null)
    loadArchivedChats()
    toast.success("Chat archived")
  }, [activeChatId, loadArchivedChats])

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
      setChats(prev => prev.map(c => c.id === id ? { ...c, title } : c))
      setStandaloneChats(prev => prev.map(c => c.id === id ? { ...c, title } : c))
    } catch (e) {
      console.error(e)
      setError("Failed to update chat title.")
    }
  }, [])

  // Only switch model if it exists in the loaded list (guards against stale persona prefs)
  const handleModelChange = useCallback((model: string) => {
    if (models.some(m => m.model === model)) setSelectedModel(model)
  }, [models])

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
    if (suggestedPersona.model) {
      setSelectedModel(suggestedPersona.model)
    }
    setSelectedEffort(suggestedPersona.effort)
    dismissSuggestion()
    toast.success(`Switched to ${suggestedPersona.name}`)
  }, [suggestedPersona, handleSaveSystemPrompt, dismissSuggestion])

  const handleSaveProjectContext = useCallback(async (id: number, fields: { memory?: string; instructions?: string }) => {
    await updateProjectContext(id, fields)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...fields, updatedAt: new Date() } : p))
  }, [])

  useEffect(() => { getSetting('display-name').then(v => { if (v) setDisplayName(v) }).catch(() => {}) }, [])

  const handleDisplayNameChange = useCallback((value: string) => {
    setDisplayName(value)
    setSetting('display-name', value).catch(() => {})
  }, [])

  const sidebarActions = useMemo<SidebarActions>(() => ({
    createProject: handleCreateProject,
    renameProject: handleRenameProject,
    deleteProject: handleRequestDeleteProject,
    selectProject: (id: number) => { setActiveView('home'); handleSelectProject(id); },
    openProjectDocuments: handleOpenProjectDocuments,
    openProjectSettings: handleOpenProjectSettings,
    createChat: handleCreateChat,
    createStandaloneChat: handleCreateStandaloneChat,
    createChatInProject: handleCreateChatInProject,
    selectChat: (id: number) => { setActiveView('home'); setActiveChatId(id); },
    selectStandaloneChat: (id: number) => { setActiveView('home'); handleSelectStandaloneChat(id); },
    moveChat: handleMoveChat,
    renameChat: handleRequestRename,
    archiveChat: handleArchiveChat,
    restoreChat: handleRestoreChat,
    deleteChat: handleRequestDelete,
    toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    toggleCollapse: () => setSidebarCollapsed(prev => !prev),
    openSettings: () => setSettingsDialogOpen(true),
    selectView: (view: AppView) => { setActiveView(view); setActiveChatId(null); },
    activeView,
  }), [handleCreateProject, handleRenameProject, handleRequestDeleteProject, handleSelectProject, handleOpenProjectDocuments, handleOpenProjectSettings, handleCreateChat, handleCreateStandaloneChat, handleCreateChatInProject, setActiveChatId, handleSelectStandaloneChat, handleMoveChat, handleRequestRename, handleArchiveChat, handleRestoreChat, handleRequestDelete, theme, activeView])

  // Get the current chat (and its project) from either chats or standaloneChats
  const currentChat = activeChatId
    ? chats.find(c => c.id === activeChatId) ?? standaloneChats.find(c => c.id === activeChatId)
    : undefined
  const currentChatTitle = currentChat?.title
  const currentChatProjectName = currentChat?.projectId
    ? projects.find(p => p.id === currentChat.projectId)?.name ?? null
    : null

  return (
    <div className={cn(
      "flex h-screen w-full overflow-hidden p-4 gap-4",
      fontSize === 'small' && 'text-sm',
      fontSize === 'large' && 'text-lg',
    )}>
      <div className={cn(
        "shrink-0 transition-transform duration-300",
        "max-md:absolute max-md:z-30 max-md:h-[calc(100vh-2rem)]",
        sidebarCollapsed && "max-md:-translate-x-[120%]",
      )}>
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          chats={chats}
          activeChatId={activeChatId}
          standaloneChats={standaloneChats}
          archivedChats={archivedChats}
          collapsed={sidebarCollapsed}
          actions={sidebarActions}
        />
      </div>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden relative">
        <button
          onClick={() => setSidebarCollapsed(prev => !prev)}
          className="md:hidden absolute top-3 left-3 z-20 p-2 rounded-lg hover:bg-accent text-muted-foreground"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        {activeView === 'projects' ? (
          <ProjectsView
            projects={projects}
            onSelectProject={(id) => { setActiveView('home'); handleSelectProject(id); }}
            onDeleteProject={handleRequestDeleteProject}
            onRenameProject={handleRequestRenameProject}
            onNewProject={handleCreateProject}
          />
        ) : activeView === 'artifacts' ? (
          <ArtifactsView onOpenChat={(chatId) => { setActiveView('home'); setActiveChatId(chatId) }} />
        ) : activeChatId ? (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
            <ChatHeader
              chatId={activeChatId}
              chatTitle={currentChatTitle}
              onTitleChange={handleUpdateChatTitle}
              projectName={currentChatProjectName}
              onProjectClick={currentChat?.projectId ? () => { setActiveView('home'); handleSelectProject(currentChat.projectId!); setActiveChatId(null); } : undefined}
            />

            {/* Error Banner */}
            {error && (
              <div className="bg-destructive/10 border-b border-destructive/30 px-6 py-2 flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-auto hover:opacity-80">
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
                artifacts={artifacts}
                onOpenArtifact={setActiveArtifactId}
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
              onModelChange={handleModelChange}
              selectedEffort={selectedEffort}
              onEffortChange={handleEffortChange}
              attachedFiles={attachedFiles}
              onFilesChange={setAttachedFiles}
              attachedImages={attachedImages}
              onImagesChange={setAttachedImages}
            />
            </div>
            {(() => {
              const activeArtifact = artifacts.find(a => a.id === activeArtifactId) ?? null
              return activeArtifact ? (
                <ArtifactWorkspace
                  artifact={activeArtifact}
                  width={artifactPanelWidth}
                  onWidthChange={setArtifactPanelWidth}
                  onClose={() => setActiveArtifactId(null)}
                  onChanged={() => {
                    if (activeChatId) {
                      fetch(`/api/artifacts?chatId=${activeChatId}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(d => { if (d?.artifacts) setArtifacts(d.artifacts) })
                        .catch(() => {})
                    }
                  }}
                />
              ) : null
            })()}
          </div>
        ) : activeProjectId && projects.find(p => p.id === activeProjectId) ? (
          <ProjectLandingPage
            project={projects.find(p => p.id === activeProjectId)!}
            chatPreviews={chatPreviews}
            loading={chatPreviewsLoading}
            onSelectChat={setActiveChatId}
            onCreateChat={handleCreateChat}
            onAddFiles={() => handleOpenProjectDocuments(activeProjectId)}
            onSaveContext={handleSaveProjectContext}
            onDeleteProject={handleRequestDeleteProject}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center w-full max-w-(--thread-max-width) mx-auto px-4">
            <HomeGreeting displayName={displayName || undefined} />
            <div className="w-full">
              <ChatInputArea
                input={input}
                onInputChange={setInput}
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
                onModelChange={handleModelChange}
                selectedEffort={selectedEffort}
                onEffortChange={handleEffortChange}
                attachedFiles={attachedFiles}
                onFilesChange={setAttachedFiles}
                attachedImages={attachedImages}
                onImagesChange={setAttachedImages}
              />
            </div>
            <QuickActions
              onNewProject={handleCreateProject}
              onAddDocuments={() => activeProjectId ? handleOpenProjectDocuments(activeProjectId) : setActiveView('projects')}
              onDraftRfi={() => setInput('Draft an RFI for: ')}
              onLookahead={() => setInput('Build a 3-week look-ahead schedule for: ')}
            />
          </div>
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
        onModelChange={handleModelChange}
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

      {/* Delete Project Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteProjectDialogOpen}
        onOpenChange={setDeleteProjectDialogOpen}
        title="Delete Project"
        description={`Delete "${projects.find(p => p.id === deleteProjectTargetId)?.name ?? "this project"}"? This permanently removes the project and all of its chats, messages, and documents. This cannot be undone.`}
        onConfirm={handleConfirmDeleteProject}
      />

      {/* Rename Project Dialog */}
      <RenameDialog
        open={renameProjectDialogOpen}
        onOpenChange={setRenameProjectDialogOpen}
        currentTitle={renameProjectTarget?.name ?? ""}
        onRename={handleConfirmRenameProject}
        title="Rename Project"
        placeholder="Enter project name..."
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
        displayName={displayName}
        onDisplayNameChange={handleDisplayNameChange}
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
