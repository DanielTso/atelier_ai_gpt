"use client"

import { AlertCircle, Menu } from "lucide-react"
import { MotionConfig, AnimatePresence, motion } from "framer-motion"
import { viewVariants } from "@/lib/motion"
import { useTheme } from "next-themes"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { extractText } from "@/lib/messageParts"
import { getProjects, getProjectFileCounts, createProject, getAllProjectChats, createChat, getChatMessages, saveMessage, deleteProject, updateProjectName, updateProjectContext, updateChatTitle, getStandaloneChats, createStandaloneChat, deleteChat, moveChatToProject, archiveChat, restoreChat, getArchivedChats, getChatWithContext, updateChatSystemPrompt, getProjectDefaults, recordPersonaUsage, getProjectChatPreviews, saveMessageAttachments, getChatAttachments, getSetting, setSetting } from "./actions"
import { Sidebar } from "@/components/chat/sidebar"
import type { SidebarActions, AppView } from "@/components/chat/sidebar"
import { HomeGreeting } from "@/components/chat/HomeGreeting"
import { QuickActions } from "@/components/chat/QuickActions"
import { ProjectsView } from "@/components/chat/ProjectsView"
import { ArtifactsView } from "@/components/chat/ArtifactsView"
import { ImagesView } from "@/components/chat/ImagesView"
import { ArtifactWorkspace } from "@/components/chat/ArtifactWorkspace"
import { ChatHeader } from "@/components/chat/ChatHeader"
import { ChatInputArea } from "@/components/chat/ChatInputArea"
import { MessagesList, type ChatMessage, type DocumentsById } from "@/components/chat/MessagesList"
import { DocumentPreviewDialog } from "@/components/ui/DocumentPreviewDialog"
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
import { useGroundedCompose } from "@/hooks/useGroundedCompose"
import { PersonaSuggestionBanner } from "@/components/chat/PersonaSuggestionBanner"
import { ProjectLandingPage } from "@/components/chat/ProjectLandingPage"
import type { AttachedFile, AttachedImage } from "@/lib/fileAttachments"
import { buildFileMessage } from "@/lib/fileAttachments"
import type { FileUIPart, UIMessage } from "ai"
import type { Model, ArtifactSummary, ChatPreview, DocumentSummary } from "@/types"
import { useChatTitle } from "@/hooks/useChatTitle"
import { useFollowUps } from "@/hooks/useFollowUps"
import { FollowUpChips } from "@/components/chat/FollowUpChips"
import { toolPartName } from "@/lib/chatStage"
import { useSummarization } from "@/hooks/useSummarization"
import { useAutoCollapseSidebar } from "@/hooks/useAutoCollapseSidebar"
import { useDialogs } from "@/hooks/useDialogs"
import { useChatPersistence } from "@/hooks/useChatPersistence"
import { useUrlNavSync } from "@/hooks/useUrlNavSync"

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
  // Dedup ref for the assistant-message save — guards against a double-firing onFinish
  // (error+retry / remount) persisting, embedding, and rendering the reply twice.
  const lastSavedAssistantIdRef = useRef<string | null>(null)
  // One-shot flag: suppress the next loadMessages for a chat we just created in
  // handleSendMessage, so the deferred-create optimistic + streaming state isn't
  // clobbered by an empty/partial DB snapshot.
  const skipLoadOnceRef = useRef<number | null>(null)

  // Data State
  const [projects, setProjects] = useState<Project[]>([])
  const [projectFileCounts, setProjectFileCounts] = useState<Record<number, number>>({})
  // Not persisted: the app should start on Home each launch, not reopen the last project/chat.
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [standaloneChats, setStandaloneChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<number | null>(null)
  // "New chat" started inside a project: show a compose surface (not the project
  // landing) WITHOUT persisting a chat row. The chat is created only when the first
  // message is sent (see handleSendMessage), scoped to the active project.
  const [newChatCompose, setNewChatCompose] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('home')
  const [displayName, setDisplayName] = useState('')

  // Project landing page state
  const [chatPreviews, setChatPreviews] = useState<ChatPreview[]>([])
  const [chatPreviewsLoading, setChatPreviewsLoading] = useState(false)

  // Artifact state
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<number | null>(null)

  // Project documents for the active chat's project — feeds citation-chip
  // resolution (documentsById) and the citation-preview dialog.
  const [projectDocuments, setProjectDocuments] = useState<DocumentSummary[]>([])
  const [citationDoc, setCitationDoc] = useState<DocumentSummary | null>(null)
  const [citationTarget, setCitationTarget] = useState<{ page?: number; chunkId?: number } | undefined>(undefined)

  // Refs for values used in closures (must be after state declaration)
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const standaloneChatsRef = useRef(standaloneChats)
  standaloneChatsRef.current = standaloneChats

  // Get the current chat (and its project) from either chats or standaloneChats
  const currentChat = activeChatId
    ? chats.find(c => c.id === activeChatId) ?? standaloneChats.find(c => c.id === activeChatId)
    : undefined
  const currentChatTitle = currentChat?.title
  const currentChatProjectName = currentChat?.projectId
    ? projects.find(p => p.id === currentChat.projectId)?.name ?? null
    : null
  const currentChatProjectId = currentChat?.projectId ?? null

  // Fetch the active chat's project documents so citation chips can resolve a
  // docId → filename/pageCount and the citation-preview dialog has the full row.
  useEffect(() => {
    if (!currentChatProjectId) { setProjectDocuments([]); return }
    let cancelled = false
    fetch(`/api/documents?projectId=${currentChatProjectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.documents) setProjectDocuments(d.documents) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentChatProjectId])

  const documentsById = useMemo<DocumentsById>(() => {
    const map: DocumentsById = new Map()
    for (const d of projectDocuments) map.set(d.id, { filename: d.filename, pageCount: d.pageCount ?? null })
    return map
  }, [projectDocuments])

  const handleOpenCitation = useCallback((docId: number, target: { page?: number; chunkId?: number }) => {
    const doc = projectDocuments.find(d => d.id === docId)
    if (!doc) return
    setCitationTarget(target)
    setCitationDoc(doc)
  }, [projectDocuments])

  // Browser back/forward + deep links: mirror nav state into the URL. Deliberately
  // excluded from history: newChatCompose, dialogs, lightboxes, and the artifact
  // panel — back navigates views, it never closes overlays.
  const navSync = useUrlNavSync({
    activeView,
    activeProjectId,
    activeChatId,
    // The chat's OWN project, not activeProjectId — that goes stale when a chat is
    // opened from the artifact gallery or after selectView (neither clears it).
    currentChatProjectId: currentChat?.projectId ?? (currentChat ? null : undefined),
    setActiveView,
    setActiveProjectId,
    setActiveChatId,
  })

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
  // Chats whose auto-title is currently generating — the sidebar shimmers these.
  const [titlePendingIds, setTitlePendingIds] = useState<Set<number>>(new Set())
  const handleTitlePending = useCallback((chatId: number, pending: boolean) => {
    setTitlePendingIds(prev => {
      const next = new Set(prev)
      if (pending) next.add(chatId)
      else next.delete(chatId)
      return next
    })
  }, [])
  const maybeGenerateTitle = useChatTitle({ readChats: readTitleChats, modelRef: selectedModelRef, applyTitle: applyChatTitle, onPendingChange: handleTitlePending })

  // Dialog state — centralised in useDialogs
  const dialogs = useDialogs()

  // Archived chats state
  const [archivedChats, setArchivedChats] = useState<Chat[]>([])

  // Composer state (NOT in useDialogs — owned by the composer, not the dialog layer)
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState<string | null>(null)
  // True once the user explicitly picks a persona in a not-yet-created chat's
  // composer — guards the pick against being clobbered by the async project-
  // defaults load in createChatForProject (reset there per compose session).
  const composePersonaPickedRef = useRef(false)

  // Sidebar collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('sidebar-collapsed', false)
  const [artifactPanelWidth, setArtifactPanelWidth] = useLocalStorage('artifact-panel-width', 448)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  sidebarCollapsedRef.current = sidebarCollapsed

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

  // Grounded answers (restrict Claude to project documents + require citations).
  // Defaults to the active persona's `grounded` flag; a manual pill toggle survives
  // async persona/default loads (see useGroundedCompose — mirrors composePersonaPickedRef).
  const { grounded, toggle: toggleGrounded, resetPick: resetGroundedPick, applyPersonaDefault: applyGroundedDefault } =
    useGroundedCompose(!!defaultPersona.grounded)
  const groundedRef = useRef(grounded)
  groundedRef.current = grounded

  // Per-chat source scoping (grounded retrieval): EXCLUDED document ids. Keyed by
  // the active chat; the compose surface (no chat) shows no scoping UI.
  const [excludedDocIds, setExcludedDocIds] = useLocalStorage<number[]>(
    'chat-doc-scope-' + activeChatId,
    [],
    v => Array.isArray(v) && v.every(x => typeof x === 'number'),
  )
  const excludedDocIdsRef = useRef(excludedDocIds)
  excludedDocIdsRef.current = excludedDocIds

  // Create transport with body as function to always get current values
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => ({
      model: selectedModelRef.current,
      chatId: activeChatIdRef.current,
      effort: selectedEffortRef.current,
      grounded: groundedRef.current,
      excludedDocumentIds: excludedDocIdsRef.current,
    }),
  }), [])

  // Auto-memory: per-chat message count at the last suggestion pass. Gating on a
  // monotonic delta (count - last >= 6) instead of `count % 6` avoids both missed
  // boundaries (count jumps) and double-fires (overlapping onFinish).
  const lastSuggestedAtRef = useRef<Map<number, number>>(new Map())
  // Summarization: per-chat message count at the last fold. Monotonic delta-gate
  // (count - last >= SUMMARIZE_EVERY) so a long chat folds infrequently, not per turn.
  const lastSummarizedCountRef = useRef<Map<number, number>>(new Map())

  // Context-window management (auto-summarize older messages past the threshold).
  const triggerSummarization = useSummarization(selectedModelRef)

  // onFinish ref: allows useChatPersistence to be called after useChat (which provides
  // setMessages/setArtifacts) while still passing a stable onFinish to useChat itself.
  const onFinishRef = useRef<({ message }: { message: UIMessage }) => Promise<void>>(async () => {})

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    status,
    error: chatError
  } = useChat({
    transport,
    onFinish: useCallback((args: { message: UIMessage }) => onFinishRef.current(args), []),
  })

  // Suggested follow-up chips after each finished response (best-effort, Gemini Flash).
  const { followUps, clearFollowUps } = useFollowUps({ messages, status, activeChatId })

  // Auto-open a just-built artifact in the workspace the moment its tool output
  // lands MID-STREAM (Claude.ai-style) — the user shouldn't have to notice a card
  // and click it. Each artifact auto-opens once; closing the panel is respected
  // (we never re-open the same id).
  const autoOpenedArtifactIdsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !activeChatId) return
    for (const p of last.parts) {
      if (toolPartName(p) !== 'generate_artifact') continue
      const part = p as { state?: string; output?: { artifactId?: unknown } }
      if (part.state !== 'output-available') continue
      const id = part.output?.artifactId
      if (typeof id !== 'number' || autoOpenedArtifactIdsRef.current.has(id)) continue
      autoOpenedArtifactIdsRef.current.add(id)
      const cid = activeChatId
      fetch(`/api/artifacts?chatId=${cid}`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!data?.artifacts || activeChatIdRef.current !== cid) return
          setArtifacts(data.artifacts)
          setActiveArtifactId(id)
        })
        .catch(() => { /* best-effort — the card in the message still opens it */ })
    }
  }, [messages, activeChatId])

  // Message-persistence pipeline: save → embed → summarize → memory-suggest → title → artifact-refetch.
  // Must be called AFTER useChat so setMessages / setArtifacts are in scope.
  const onFinish = useChatPersistence({
    activeChatIdRef,
    activeProjectIdRef,
    lastSavedAssistantIdRef,
    lastSuggestedAtRef,
    lastSummarizedCountRef,
    setMessages,
    setArtifacts,
    triggerSummarization,
    maybeGenerateTitle,
  })
  // Keep the ref current every render so useChat always calls the latest handler.
  onFinishRef.current = onFinish

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
      const [p, counts] = await Promise.all([getProjects(), getProjectFileCounts().catch(() => ({}))])
      setProjects(p)
      setProjectFileCounts(counts)
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

  // True while a chat's history is being fetched — MessagesList holds layout
  // with skeletons instead of flashing empty-then-pop.
  const [messagesLoading, setMessagesLoading] = useState(false)

  const loadMessages = useCallback(async (cid: number) => {
    try {
      const [msgs, attachments, artifactsData] = await Promise.all([
        getChatMessages(cid),
        getChatAttachments(cid),
        fetch(`/api/artifacts?chatId=${cid}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
      ])
      // Bail if the active chat changed while we were awaiting — a stale load must not
      // clobber the chat the user switched to (or a freshly-created chat's live state).
      if (activeChatIdRef.current !== cid) return

      // Apply artifacts result (best-effort — null means the fetch failed or returned non-ok;
      // on success always set to the list or [] so a chat with no artifacts clears stale cards)
      if (artifactsData !== null) setArtifacts(artifactsData.artifacts ?? [])

      // Group attachments by messageId
      const attachmentsByMessageId = new Map<number, typeof attachments>()
      for (const att of attachments) {
        const existing = attachmentsByMessageId.get(att.messageId) ?? []
        existing.push(att)
        attachmentsByMessageId.set(att.messageId, existing)
      }

      // Re-check after the artifact fetch's awaits: don't overwrite the live message
      // list if the user switched chats (or the deferred-create stream started) meanwhile.
      if (activeChatIdRef.current !== cid) return

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

  // Validate persisted activeChatId/activeProjectId after data loads. Also cleans
  // stale deep links (useUrlNavSync restores ids from the URL optimistically);
  // suppressNextPush makes the URL correction a replaceState so history gets no
  // dead entry pointing at the broken URL.
  useEffect(() => {
    if (activeChatId !== null) {
      const allChats = [...chats, ...standaloneChats]
      if (allChats.length > 0 && !allChats.find(c => c.id === activeChatId)) {
        navSync.suppressNextPush()
        setActiveChatId(null)
      }
    }
    if (activeProjectId !== null) {
      if (projects.length > 0 && !projects.find(p => p.id === activeProjectId)) {
        navSync.suppressNextPush()
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
      // Skip the DB message-load exactly once for a chat we just created in
      // handleSendMessage: useChat already holds the authoritative optimistic user
      // message + streaming reply, so loading the empty/partial snapshot would clobber
      // them. Subsequent opens of the same chat load normally.
      if (skipLoadOnceRef.current === activeChatId) {
        skipLoadOnceRef.current = null
      } else {
        // Clear the previous chat's content immediately: without this a chat→chat
        // switch renders the OLD chat's messages under the new chat's key while
        // the fetch is in flight (and the loading skeleton never shows).
        setMessages([])
        setArtifacts([])
        setMessagesLoading(true)
        loadMessages(activeChatId).finally(() => {
          // A stale finish must not clear the loading state of the chat we switched to.
          if (activeChatIdRef.current === activeChatId) setMessagesLoading(false)
        })
      }
      // Backfill the title if this chat is still "New Chat" but already has an exchange.
      maybeGenerateTitle(activeChatId)
      // Load system prompt for this chat
      getChatWithContext(activeChatId).then(chat => {
        // Ignore a stale resolve if the user switched chats while this was in flight.
        if (activeChatIdRef.current === activeChatId) setCurrentSystemPrompt(chat?.systemPrompt ?? null)
      })
    } else {
      setMessages([])
      setCurrentSystemPrompt(null)
      setArtifacts([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId])

  // Auto-collapse the sidebar when the chat's artifact panel is dragged wide enough to
  // cramp the chat. Gated to the chat workspace being visible so it doesn't fight the
  // gallery's own copy of this behavior (ArtifactsView runs the same hook for its panel).
  useAutoCollapseSidebar({
    active: activeArtifactId != null && activeChatId != null && activeView !== 'artifacts' && activeView !== 'projects',
    panelWidth: artifactPanelWidth,
    sidebarCollapsedRef,
    setSidebarCollapsed,
  })

  // Whether the user is pinned near the bottom, maintained by a passive scroll
  // listener — measured on USER scrolls, not after each content commit, so a
  // single tall chunk (image, code fence) can't silently detach auto-follow,
  // and the streaming effect below does zero layout reads per token.
  const nearBottomRef = useRef(true)
  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])
  // Callback ref: the scroll container remounts with each keyed view swap, and
  // AnimatePresence mode='wait' can mount it AFTER messagesLoading settles — so
  // pin to the bottom at attach time (no effect re-fires on ref changes).
  const attachScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current?.removeEventListener('scroll', updateNearBottom)
    scrollRef.current = node
    if (node) {
      node.addEventListener('scroll', updateNearBottom, { passive: true })
      nearBottomRef.current = true
      node.scrollTop = node.scrollHeight
    }
  }, [updateNearBottom])

  // Position at the latest message BEFORE paint when a chat's history lands in
  // an already-mounted container, so the user never sees a visible jump.
  useLayoutEffect(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer || messagesLoading) return
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    nearBottomRef.current = true
  }, [activeChatId, messagesLoading])

  // Streaming follow: keep pinned while the user is near the bottom — never
  // fight an upward scroll mid-response. The user's OWN send always scrolls,
  // even from deep in the history.
  useEffect(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer) return
    const justSent = messages[messages.length - 1]?.role === 'user'
    if (!nearBottomRef.current && !justSent) return

    const animationId = requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
      nearBottomRef.current = true
    })

    return () => cancelAnimationFrame(animationId)
  }, [messages])

  // Command palette keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        dialogs.commandPalette.toggle()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dialogs.commandPalette])

  // The sidebar-facing create handlers below are useCallback'd because they sit in the
  // sidebarActions useMemo dep array — a plain function here recreates sidebarActions
  // every render, defeating memo(Sidebar) on every streamed token.
  const handleCreateProject = useCallback(async () => {
    dialogs.createProject.setOpen(true)
  }, [dialogs.createProject])

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
  // "New chat" inside a project — DEFERRED. Don't persist a chat row; just enter a
  // project-scoped compose surface and pre-apply the project's defaults to the composer.
  // The actual chat is created on the first message send (handleSendMessage), so hitting
  // "New chat" and walking away never spawns an empty "New Chat" row.
  const createChatForProject = useCallback(async (projectId: number) => {
    setActiveProjectId(projectId)
    setActiveChatId(null)
    setNewChatCompose(true)
    setActiveView('home')
    setInput('')
    // Reflect project defaults in the composer now; persisted to the new chat on send.
    // Set the system prompt explicitly (default persona's, else null) so a previous
    // chat's prompt is never carried into — or persisted onto — the new project chat.
    composePersonaPickedRef.current = false
    resetGroundedPick()
    // Fresh compose: default the grounded pill to the house default; a project's
    // default persona (loaded below) may raise it — both respect a manual toggle.
    applyGroundedDefault(!!defaultPersona.grounded)
    let promptToApply: string | null = null
    try {
      const defaults = await getProjectDefaults(projectId)
      if (defaults.defaultPersonaId) {
        const persona = getPersonaById(defaults.defaultPersonaId)
        if (persona?.prompt) {
          promptToApply = persona.prompt
          setSelectedEffort(persona.effort)
          applyGroundedDefault(!!persona.grounded)
        }
      }
      if (defaults.defaultModel) setSelectedModel(defaults.defaultModel)
    } catch {
      // Defaults are optional.
    }
    // A persona the user picked while the defaults round-trip was in flight WINS —
    // without this guard the late resolve silently reverted the pick (live bug).
    if (!composePersonaPickedRef.current) setCurrentSystemPrompt(promptToApply)
  }, [getPersonaById, resetGroundedPick, applyGroundedDefault, defaultPersona.grounded])

  const handleCreateChat = useCallback(async () => {
    if (!activeProjectId) {
      toast.error("Select a project first")
      return
    }
    await createChatForProject(activeProjectId)
  }, [activeProjectId, createChatForProject])

  const handleCreateChatInProject = useCallback(
    (projectId: number) => createChatForProject(projectId),
    [createChatForProject],
  )

  // "New chat" goes to a fresh Home compose — it does NOT persist an empty chat.
  // The first message sent auto-creates the standalone chat (see handleSendMessage),
  // so clicking New chat repeatedly no longer spawns empty "New Chat" rows.
  const handleCreateStandaloneChat = useCallback(() => {
    setActiveView('home')
    setActiveChatId(null)
    setActiveProjectId(null)
    setNewChatCompose(false)
    setInput('')
    // Fresh compose — clear the grounded pick guard and reset to the house default.
    resetGroundedPick()
    applyGroundedDefault(!!defaultPersona.grounded)
  }, [resetGroundedPick, applyGroundedDefault, defaultPersona.grounded])

  const handleSendMessage = async () => {
    if ((!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0) || isLoading) return

    // No chat yet → create it now (deferred create). In a project compose, create the
    // chat in that project and persist the (default) system prompt; otherwise a quick
    // standalone chat. Either way nothing is persisted until this first message.
    if (!activeChatId) {
      try {
        const projectId = activeProjectIdRef.current
        if (projectId != null) {
          const [newC] = await createChat(projectId, "New Chat")
          setChats(prev => [newC, ...prev])
          if (currentSystemPrompt) {
            await updateChatSystemPrompt(newC.id, currentSystemPrompt).catch(() => {})
          }
          skipLoadOnceRef.current = newC.id
          setActiveChatId(newC.id)
          activeChatIdRef.current = newC.id
        } else {
          const [newC] = await createStandaloneChat("New Chat")
          setStandaloneChats(prev => [newC, ...prev])
          // Persist the composer's selected persona prompt (if any) so it survives the
          // post-create reload and applies to the first message — mirrors the project branch.
          if (currentSystemPrompt) {
            await updateChatSystemPrompt(newC.id, currentSystemPrompt).catch(() => {})
          }
          skipLoadOnceRef.current = newC.id
          setActiveChatId(newC.id)
          activeChatIdRef.current = newC.id
        }
        setNewChatCompose(false)
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

  // Project-landing composer: create a chat in the CURRENT project (applying its
  // persona/model defaults), open it, and send the first message — all inline using
  // local values to avoid setState-then-read timing bugs (mirrors handleSendMessage).
  const handleProjectLandingCompose = useCallback(async () => {
    if ((!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0) || isLoading) return
    const projectId = activeProjectIdRef.current
    if (projectId == null) return

    // An explicit persona picked in this composer wins (currentSystemPrompt is
    // null on the landing surface unless the user picked one — the chat-switch
    // effect clears it whenever activeChatId goes null). Project defaults only
    // fill the gap. Ignoring the pick here was a live bug: selecting a persona
    // on the landing composer silently reverted to the project default.
    let systemPrompt: string | null = currentSystemPrompt
    if (systemPrompt == null) {
      try {
        const defaults = await getProjectDefaults(projectId)
        if (defaults.defaultPersonaId) {
          const persona = getPersonaById(defaults.defaultPersonaId)
          if (persona?.prompt) {
            systemPrompt = persona.prompt
            setSelectedEffort(persona.effort)
            selectedEffortRef.current = persona.effort
            applyGroundedDefault(!!persona.grounded)
          }
        }
        if (defaults.defaultModel) {
          setSelectedModel(defaults.defaultModel)
          selectedModelRef.current = defaults.defaultModel
        }
      } catch {
        // Defaults are optional.
      }
    }

    try {
      const [newC] = await createChat(projectId, "New Chat")
      setChats(prev => [newC, ...prev])
      if (systemPrompt) {
        await updateChatSystemPrompt(newC.id, systemPrompt).catch(() => {})
        setCurrentSystemPrompt(systemPrompt)
      }
      skipLoadOnceRef.current = newC.id
      setActiveChatId(newC.id)
      activeChatIdRef.current = newC.id
      setNewChatCompose(false)
    } catch (e) {
      console.error(e)
      setError("Failed to create chat.")
      return
    }

    // Capture images in ref before clearing state (mirrors handleSendMessage's tail).
    pendingImagesRef.current = [...attachedImages]

    const userMessage = attachedFiles.length > 0
      ? buildFileMessage(input.trim(), attachedFiles)
      : input.trim()

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
  }, [input, attachedFiles, attachedImages, isLoading, getPersonaById, sendMessage, currentSystemPrompt, applyGroundedDefault])

  const handleProjectLandingKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleProjectLandingCompose()
    }
    if (e.key === 'Escape') {
      setInput("")
      ;(e.target as HTMLTextAreaElement).blur()
    }
  }

  const handleProjectLandingFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    handleProjectLandingCompose()
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
    dialogs.deleteProject.open(id)
  }, [dialogs.deleteProject])

  const handleConfirmDeleteProject = useCallback(async () => {
    if (dialogs.deleteProject.target == null) return
    const targetId = dialogs.deleteProject.target
    try {
      await deleteProject(targetId)
      setProjects(prev => prev.filter(p => p.id !== targetId))
      if (activeProjectId === targetId) setActiveProjectId(null)
      dialogs.deleteProject.close()
      toast.success("Project deleted")
    } catch (e) {
      console.error("Delete project failed:", e)
      toast.error("Failed to delete project")
    }
  }, [dialogs.deleteProject, activeProjectId])

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
      dialogs.renameProject.open({ id: project.id, name: project.name })
    }
  }, [projects, dialogs.renameProject])

  const handleConfirmRenameProject = useCallback((name: string) => {
    if (dialogs.renameProject.target) handleRenameProject(dialogs.renameProject.target.id, name)
  }, [dialogs.renameProject, handleRenameProject])

  const handleRequestDelete = useCallback((id: number) => {
    dialogs.deleteChat.open(id)
  }, [dialogs.deleteChat])

  const handleConfirmDelete = useCallback(async () => {
    if (!dialogs.deleteChat.target) return
    const targetId = dialogs.deleteChat.target
    try {
      await deleteChat(targetId)
      setChats(prev => prev.filter(c => c.id !== targetId))
      setStandaloneChats(prev => prev.filter(c => c.id !== targetId))
      setArchivedChats(prev => prev.filter(c => c.id !== targetId))
      if (activeChatId === targetId) setActiveChatId(null)
      dialogs.deleteChat.close()
      refreshChatPreviews()
      toast.success("Chat deleted")
    } catch (e) {
      console.error("Delete failed:", e)
      toast.error("Failed to delete chat")
    }
  }, [dialogs.deleteChat, activeChatId, refreshChatPreviews])

  const handleRequestRename = useCallback((id: number) => {
    const chat = [...chats, ...standaloneChats, ...archivedChats].find(c => c.id === id)
    if (chat) {
      dialogs.renameChat.open({ id: chat.id, title: chat.title })
    }
  }, [chats, standaloneChats, archivedChats, dialogs.renameChat])

  const handleConfirmRename = useCallback(async (newTitle: string) => {
    if (!dialogs.renameChat.target) return
    const target = dialogs.renameChat.target
    await updateChatTitle(target.id, newTitle)
    setChats(prev => prev.map(c => c.id === target.id ? { ...c, title: newTitle } : c))
    setStandaloneChats(prev => prev.map(c => c.id === target.id ? { ...c, title: newTitle } : c))
    setArchivedChats(prev => prev.map(c => c.id === target.id ? { ...c, title: newTitle } : c))
    dialogs.renameChat.close()
    refreshChatPreviews()
    toast.success("Chat renamed")
  }, [dialogs.renameChat, refreshChatPreviews])

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
    // Keep the project landing list in sync (archive is reachable from its rows
    // now); no-ops when no project is active.
    refreshChatPreviews()
    toast.success("Chat archived")
  }, [activeChatId, loadArchivedChats, refreshChatPreviews])

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
    setNewChatCompose(false) // Opening a project shows its landing, not a new-chat compose
  }, [])

  // Selecting/opening any real chat exits new-chat compose mode.
  useEffect(() => { if (activeChatId != null) setNewChatCompose(false) }, [activeChatId])

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
    // Persona selection resets the grounded pill to the new persona's default,
    // unless the user manually toggled it this compose (applyGroundedDefault guards).
    applyGroundedDefault(!!getPersonaByPrompt(prompt).grounded)
    // No chat yet (compose/empty state — the default now that chats are created lazily on
    // first send): update the composer state locally so the persona chip reflects the
    // choice immediately. The prompt is persisted to the chat when it's created in
    // handleSendMessage. Without this, selecting a persona before sending did nothing and
    // the chip stayed on the default "General Assistant".
    if (!activeChatId) {
      composePersonaPickedRef.current = true
      setCurrentSystemPrompt(prompt)
      return
    }
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
  }, [activeChatId, applyGroundedDefault, getPersonaByPrompt])

  const handleOpenProjectSettings = useCallback((projectId: number) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      dialogs.projectDefaults.open({ id: project.id, name: project.name })
    }
  }, [projects, dialogs.projectDefaults])

  const handleOpenProjectDocuments = useCallback((projectId: number) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      dialogs.projectDocuments.open({ id: project.id, name: project.name })
    }
  }, [projects, dialogs.projectDocuments])

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
    openSettings: () => dialogs.settings.setOpen(true),
    selectView: (view: AppView) => { setActiveView(view); setActiveChatId(null); },
    activeView,
    titlePendingIds,
  }), [handleCreateProject, handleRenameProject, handleRequestDeleteProject, handleSelectProject, handleOpenProjectDocuments, handleOpenProjectSettings, handleCreateChat, handleCreateStandaloneChat, handleCreateChatInProject, setActiveChatId, handleSelectStandaloneChat, handleMoveChat, handleRequestRename, handleArchiveChat, handleRestoreChat, handleRequestDelete, theme, activeView, dialogs.settings, titlePendingIds])

  // One key per distinct main-pane surface: tab views, individual chats, and
  // project landings each get their own crossfade (soft fade + rise, no pop-in).
  const viewKey =
    activeView !== 'home' ? activeView
    : activeChatId ? `chat-${activeChatId}`
    : activeProjectId && !newChatCompose ? `project-${activeProjectId}`
    : 'home'

  return (
    <MotionConfig reducedMotion="user">
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
        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={viewKey}
          variants={viewVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
        {activeView === 'images' ? (
          <ImagesView projects={projects} />
        ) : activeView === 'projects' ? (
          <ProjectsView
            projects={projects}
            fileCounts={projectFileCounts}
            onSelectProject={(id) => { setActiveView('home'); handleSelectProject(id); }}
            onDeleteProject={handleRequestDeleteProject}
            onRenameProject={handleRequestRenameProject}
            onNewProject={handleCreateProject}
          />
        ) : activeView === 'artifacts' ? (
          <ArtifactsView
            onOpenChat={(chatId) => { setActiveView('home'); setActiveChatId(chatId) }}
            sidebarCollapsedRef={sidebarCollapsedRef}
            setSidebarCollapsed={setSidebarCollapsed}
          />
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
            <div ref={attachScrollContainer} className={cn(
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
                messagesLoading={messagesLoading}
                status={status}
                documentsById={documentsById}
                onOpenCitation={handleOpenCitation}
                grounded={grounded}
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

            {/* Suggested follow-ups (best-effort, cleared on the next turn) */}
            <FollowUpChips
              suggestions={followUps}
              onPick={(s) => { setInput(s); clearFollowUps() }}
            />

            {/* Input Area */}
            <ChatInputArea
              input={input}
              onInputChange={setInput}
              onFormSubmit={handleFormSubmit}
              onKeyDown={handleKeyDown}
              isLoading={isLoading}
              onStop={stop}
              canStop={status === 'streaming'}
              activeChatId={activeChatId}
              activeProjectId={activeProjectId}
              systemPrompt={currentSystemPrompt}
              onSystemPromptChange={handleSaveSystemPrompt}
              onSystemPromptClick={() => dialogs.systemPrompt.setOpen(true)}
              models={models}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              selectedEffort={selectedEffort}
              onEffortChange={handleEffortChange}
              grounded={grounded}
              onGroundedToggle={toggleGrounded}
              showGroundedPill={currentChat?.projectId != null}
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
        ) : activeProjectId && !newChatCompose && projects.find(p => p.id === activeProjectId) ? (
          <ProjectLandingPage
            project={projects.find(p => p.id === activeProjectId)!}
            projects={projects}
            chatPreviews={chatPreviews}
            loading={chatPreviewsLoading}
            composer={
              <ChatInputArea
                input={input}
                onInputChange={setInput}
                onFormSubmit={handleProjectLandingFormSubmit}
                onKeyDown={handleProjectLandingKeyDown}
                isLoading={isLoading}
                onStop={stop}
                canStop={status === 'streaming'}
                activeChatId={activeChatId}
                activeProjectId={activeProjectId}
                systemPrompt={currentSystemPrompt}
                onSystemPromptChange={handleSaveSystemPrompt}
                onSystemPromptClick={() => dialogs.systemPrompt.setOpen(true)}
                models={models}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                selectedEffort={selectedEffort}
                onEffortChange={handleEffortChange}
                grounded={grounded}
                onGroundedToggle={toggleGrounded}
                showGroundedPill={activeProjectId != null}
                attachedFiles={attachedFiles}
                onFilesChange={setAttachedFiles}
                attachedImages={attachedImages}
                onImagesChange={setAttachedImages}
              />
            }
            onSelectChat={setActiveChatId}
            onAddFiles={() => handleOpenProjectDocuments(activeProjectId)}
            onSaveContext={handleSaveProjectContext}
            onDeleteProject={handleRequestDeleteProject}
            onBack={() => { setActiveView('projects'); setActiveChatId(null); setActiveProjectId(null) }}
            onRename={() => handleRequestRenameProject(activeProjectId)}
            chatActions={sidebarActions}
            excludedDocIds={excludedDocIds}
            onExcludedChange={setExcludedDocIds}
          />
        ) : (
          <div className="relative isolate flex-1 flex flex-col items-center justify-center w-full max-w-(--thread-max-width) mx-auto px-4">
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-225 max-w-[130vw] h-140 -z-10 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%)]" />
            <HomeGreeting displayName={displayName || undefined} />
            <div className="w-full">
              <ChatInputArea
                input={input}
                onInputChange={setInput}
                onFormSubmit={handleFormSubmit}
                onKeyDown={handleKeyDown}
                isLoading={isLoading}
                onStop={stop}
                canStop={status === 'streaming'}
                activeChatId={activeChatId}
                activeProjectId={activeProjectId}
                systemPrompt={currentSystemPrompt}
                onSystemPromptChange={handleSaveSystemPrompt}
                onSystemPromptClick={() => dialogs.systemPrompt.setOpen(true)}
                models={models}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                selectedEffort={selectedEffort}
                onEffortChange={handleEffortChange}
                grounded={grounded}
                onGroundedToggle={toggleGrounded}
                showGroundedPill={activeProjectId != null}
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
        </motion.div>
        </AnimatePresence>
      </main>

      {/* Command Palette */}
      <CommandPalette
        open={dialogs.commandPalette.isOpen}
        onOpenChange={dialogs.commandPalette.setOpen}
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
        open={dialogs.createProject.isOpen}
        onOpenChange={dialogs.createProject.setOpen}
        onCreate={handleConfirmCreateProject}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={dialogs.deleteChat.isOpen}
        onOpenChange={dialogs.deleteChat.setOpen}
        title="Delete Chat"
        description="Are you sure you want to delete this chat? This action cannot be undone."
        onConfirm={handleConfirmDelete}
      />

      {/* Delete Project Confirmation Dialog */}
      <DeleteConfirmDialog
        open={dialogs.deleteProject.isOpen}
        onOpenChange={dialogs.deleteProject.setOpen}
        title="Delete Project"
        description={`Delete "${projects.find(p => p.id === dialogs.deleteProject.target)?.name ?? "this project"}"? This permanently removes the project and all of its chats, messages, and documents. This cannot be undone.`}
        onConfirm={handleConfirmDeleteProject}
      />

      {/* Rename Project Dialog */}
      <RenameDialog
        open={dialogs.renameProject.isOpen}
        onOpenChange={dialogs.renameProject.setOpen}
        currentTitle={dialogs.renameProject.target?.name ?? ""}
        onRename={handleConfirmRenameProject}
        title="Rename Project"
        placeholder="Enter project name..."
      />

      {/* Rename Dialog */}
      <RenameDialog
        open={dialogs.renameChat.isOpen}
        onOpenChange={dialogs.renameChat.setOpen}
        currentTitle={dialogs.renameChat.target?.title ?? ""}
        onRename={handleConfirmRename}
      />

      {/* System Prompt Dialog */}
      <SystemPromptDialog
        open={dialogs.systemPrompt.isOpen}
        onOpenChange={dialogs.systemPrompt.setOpen}
        currentPrompt={currentSystemPrompt}
        onSave={handleSaveSystemPrompt}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={dialogs.settings.isOpen}
        onOpenChange={dialogs.settings.setOpen}
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
      {dialogs.projectDefaults.target && (
        <ProjectDefaultsDialog
          open={dialogs.projectDefaults.isOpen}
          onOpenChange={dialogs.projectDefaults.setOpen}
          projectId={dialogs.projectDefaults.target.id}
          projectName={dialogs.projectDefaults.target.name}
          models={models}
        />
      )}

      {/* Citation preview — opened from a citation chip in an assistant reply. */}
      <DocumentPreviewDialog
        open={citationDoc !== null}
        onOpenChange={(o) => { if (!o) setCitationDoc(null) }}
        document={citationDoc}
        target={citationTarget}
      />

      {/* Project Documents Dialog */}
      {dialogs.projectDocuments.target && (
        <ProjectDocumentsDialog
          open={dialogs.projectDocuments.isOpen}
          onOpenChange={dialogs.projectDocuments.setOpen}
          projectId={dialogs.projectDocuments.target.id}
          projectName={dialogs.projectDocuments.target.name}
        />
      )}
    </div>
    </MotionConfig>
  )
}
