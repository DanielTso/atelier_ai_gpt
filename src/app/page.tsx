"use client"

import { AlertCircle, Menu } from "lucide-react"
import { MotionConfig, AnimatePresence, motion } from "framer-motion"
import { viewVariants } from "@/lib/motion"
import { useTheme } from "next-themes"
import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { extractText } from "@/lib/messageParts"
import { getProjects, getProjectFileCounts, createProject, getAllProjectChats, createChat, getChatMessages, deleteProject, updateProjectName, updateProjectContext, updateChatTitle, getStandaloneChats, createStandaloneChat, deleteChat, moveChatToProject, archiveChat, restoreChat, getArchivedChats, getChatWithContext, updateChatSystemPrompt, getProjectDefaults, recordPersonaUsage, getProjectChatPreviews, getChatAttachments, getSetting, setSetting, deleteMessage } from "./actions"
import { replyHasSavedContent, resolveMessageDbId } from "@/lib/chatTurn"
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
import { usePersonas, resolvePersonaModel, type Effort } from "@/hooks/usePersonas"
import { useGroundedCompose } from "@/hooks/useGroundedCompose"
import { useDocScope, scopeProjectIdFor } from "@/hooks/useDocScope"
import { PersonaSuggestionBanner } from "@/components/chat/PersonaSuggestionBanner"
import { ProjectLandingPage } from "@/components/chat/ProjectLandingPage"
import type { AttachedFile, AttachedImage } from "@/lib/fileAttachments"
import { exceedsImageBudget, IMAGE_BUDGET_MESSAGE } from "@/lib/fileAttachments"
import { buildComposerMessage, chatRequestSizeError } from "@/lib/chatRequestSize"
import type { Model, ArtifactSummary, ChatPreview, DocumentSummary } from "@/types"
import { useChatTitle } from "@/hooks/useChatTitle"
import { useFollowUps } from "@/hooks/useFollowUps"
import { FollowUpChips } from "@/components/chat/FollowUpChips"
import { toolPartName } from "@/lib/chatStage"
import { useSummarization } from "@/hooks/useSummarization"
import { useAutoCollapseSidebar } from "@/hooks/useAutoCollapseSidebar"
import { useDialogs } from "@/hooks/useDialogs"
import { useChatPersistence, type FinishedTurn, type StartedTurn } from "@/hooks/useChatPersistence"
import { useChatSessions, type TurnFinish, type TurnStart } from "@/hooks/useChatSessions"
import { useUrlNavSync } from "@/hooks/useUrlNavSync"
import { findChatById, isStaleChatId, moveChatInLists, moveRestoredChat, removeProjectChats, type LoadedFlags } from "@/lib/chatLookup"

// Types matching DB schema roughly
type Project = { id: number; name: string; memory?: string | null; instructions?: string | null; createdAt?: Date | null; updatedAt?: Date | null }
type Chat = { id: number; projectId: number | null; title: string; archived?: boolean | null }
// The composer's contents, taken (and cleared) at the start of a send.
type ComposerSnapshot = { input: string; files: AttachedFile[]; images: AttachedImage[] }
// A message handed to its chat session; `turn` resolves when the reply ends.
type StartedSend = { turn: Promise<void> }

// The AI SDK's chat transport reports an HTTP error as Error(<response body>), and
// /api/chat's error bodies are JSON `{ error }` (apiError) — show that string,
// not the raw JSON. Anything else (a stream error's text, a plain body) as is.
function chatErrorText(message: string): string {
  try {
    const parsed: unknown = JSON.parse(message)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
      return (parsed as { error: string }).error
    }
  } catch {
    // not JSON
  }
  return message
}

// fetchModels' own banner messages — the only ones it may clear.
const NO_MODELS_ERROR = "No models found. Please check your API keys in Settings."
const MODELS_LOAD_ERROR = "Failed to load models. Please check your configuration."

export default function Home() {
  const { setTheme, theme } = useTheme()
  const [models, setModels] = useState<Model[]>([])
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  // Images attached to a chat's in-flight user message, keyed by chat id: turns in
  // different chats can overlap, and each turn's images belong to ITS user row.
  // Claimed by the turn pipeline once the server reports that row's id.
  const pendingImagesRef = useRef<Map<number, AttachedImage[]>>(new Map())
  const takePendingImages = useCallback((chatId: number) => {
    const images = pendingImagesRef.current.get(chatId) ?? []
    pendingImagesRef.current.delete(chatId)
    return images
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Use ref to always get current model in transport body function
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel

  // Dedup for the post-turn pipeline — guards against a double-firing onFinish
  // (error+retry / remount) attaching, embedding, and counting a turn twice. A set
  // of assistant message ids: turns from different chats can finish interleaved.
  const processedTurnIdsRef = useRef<Set<string>>(new Set())
  // One-shot flag: suppress the next loadMessages for a chat we just created in
  // handleSendMessage, so the deferred-create optimistic + streaming state isn't
  // clobbered by an empty/partial DB snapshot.
  const skipLoadOnceRef = useRef<number | null>(null)
  // The history load the chat-change effect started for the active chat. A send
  // waits on it: /api/chat builds the model's context from the posted transcript
  // only, so a message sent before the history lands would go out truncated.
  const historyLoadRef = useRef<{ chatId: number; done: Promise<boolean> } | null>(null)

  // Data State
  const [projects, setProjects] = useState<Project[]>([])
  const [projectFileCounts, setProjectFileCounts] = useState<Record<number, number>>({})
  // Not persisted: the app should start on Home each launch, not reopen the last project/chat.
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [standaloneChats, setStandaloneChats] = useState<Chat[]>([])
  const [archivedChats, setArchivedChats] = useState<Chat[]>([])
  // Which chat lists have finished their first load (success or failure). The
  // deep-link validator waits for all three: the server actions resolve one
  // round-trip apart, so judging an id against a partial set clears valid links.
  // A FAILED load counts as loaded on purpose: otherwise one failing list would
  // hold every stale id open forever. The cost — a deep link into a list that
  // failed to load is cleared — is visible: the load's error banner says why.
  const [chatListsLoaded, setChatListsLoaded] = useState<LoadedFlags>({ chats: false, standalone: false, archived: false })
  const [activeChatId, setActiveChatId] = useState<number | null>(null)
  // "New chat" started inside a project: show a compose surface (not the project
  // landing) WITHOUT persisting a chat row. The chat is created only when the first
  // message is sent (see handleSendMessage), scoped to the active project.
  const [newChatCompose, setNewChatCompose] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('home')
  const activeViewRef = useRef(activeView)
  activeViewRef.current = activeView
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
  const archivedChatsRef = useRef(archivedChats)
  archivedChatsRef.current = archivedChats

  // Get the current chat (and its project) from project, quick or archived chats
  const currentChat = findChatById(activeChatId, { chats, standaloneChats, archivedChats })
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
  const suppressNextNavPush = navSync.suppressNextPush

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
  const maybeGenerateTitle = useChatTitle({ readChats: readTitleChats, applyTitle: applyChatTitle, onPendingChange: handleTitlePending })

  // Dialog state — centralised in useDialogs
  const dialogs = useDialogs()

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
  // Assistant message ids completed THIS SESSION with grounded on (review F3).
  // Gates the "Answered from project documents" floor caption in MessagesList —
  // historical/reloaded messages can never show it.
  const groundedTurnIdsRef = useRef<Set<string>>(new Set())
  const isGroundedTurn = useCallback((id: string) => groundedTurnIdsRef.current.has(id), [])
  // Whether each chat's in-flight turn was SENT grounded. A turn can finish after
  // the user has moved on (and the pill has been reset), so the finish handler
  // must not read the composer's current state.
  const groundedAtSendRef = useRef<Map<number, boolean>>(new Map())

  // Project-level source scoping (review F1): EXCLUDED document ids, persisted per
  // PROJECT ('project-doc-scope-<id>'). The checkboxes live on the project landing
  // rail, and a chat inherits its own project's exclusions — the key derives from
  // currentChat.projectId first (activeProjectId goes stale, see the useUrlNavSync
  // comment above). Projectless context → 'none': always [] and never written.
  // Legacy 'chat-doc-scope-*' entries are deliberately never read.
  const scopeProjectId = scopeProjectIdFor(currentChat?.projectId, activeProjectId)
  const { excludedDocIds, setExcludedDocIds } = useDocScope(scopeProjectId)
  const excludedDocIdsRef = useRef(excludedDocIds)
  excludedDocIdsRef.current = excludedDocIds

  // Composer-level fields of the /api/chat body, read from refs at send time so
  // they are always current. `chatId` is deliberately NOT here: useChatSessions
  // derives it from the chat session a message is sent through.
  const getChatRequestBody = useCallback(() => ({
    model: selectedModelRef.current,
    effort: selectedEffortRef.current,
    grounded: groundedRef.current,
    excludedDocumentIds: excludedDocIdsRef.current,
  }), [])

  // Auto-memory: per-chat message count at the last suggestion pass. Gating on a
  // monotonic delta (count - last >= 6) instead of `count % 6` avoids both missed
  // boundaries (count jumps) and double-fires (overlapping onFinish).
  const lastSuggestedAtRef = useRef<Map<number, number>>(new Map())
  // Summarization: per-chat message count at the last fold. Monotonic delta-gate
  // (count - last >= SUMMARIZE_EVERY) so a long chat folds infrequently, not per turn.
  const lastSummarizedCountRef = useRef<Map<number, number>>(new Map())

  // Context-window management (auto-summarize older messages past the threshold).
  const triggerSummarization = useSummarization()

  // Turn-handler ref: allows useChatPersistence to be called after useChatSessions (which
  // provides updateChatMessages) while still passing it stable onTurnStart/onTurnFinish.
  const turnHandlersRef = useRef<{
    onTurnStart: (turn: StartedTurn) => void
    onTurnFinish: (turn: FinishedTurn) => Promise<void>
  }>({ onTurnStart: () => {}, onTurnFinish: async () => {} })

  // One chat session (store + in-flight request) per chat — see useChatSessions.
  // `messages`/`status`/`stop` are the ACTIVE chat's; a turn left streaming in
  // another chat keeps running in its own session and reports here when it ends.
  const {
    messages,
    setMessages,
    sendToChat,
    regenerateInChat,
    isChatBusy,
    updateChatMessages,
    peekChatMessages,
    stop,
    status,
    error: chatError
  } = useChatSessions({
    activeChatId,
    getRequestBody: getChatRequestBody,
    onTurnStart: useCallback((turn: TurnStart) => turnHandlersRef.current.onTurnStart(turn), []),
    onTurnFinish: useCallback((turn: TurnFinish) => {
      // Record grounded completions BEFORE the persistence pipeline (review F3):
      // the floor caption may render as soon as the stream settles.
      const sentGrounded = groundedAtSendRef.current.get(turn.chatId) === true
      groundedAtSendRef.current.delete(turn.chatId)
      if (turn.message.role === 'assistant' && sentGrounded) {
        groundedTurnIdsRef.current.add(turn.message.id)
      }
      return turnHandlersRef.current.onTurnFinish(turn)
    }, []),
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

  // Turn pipeline: attachments + user embed at turn start; then, when the turn ends,
  // image linking → embed → summarize → memory-suggest → title → artifact-refetch.
  // /api/chat saves both messages; every id comes from its turn metadata.
  // Must be called AFTER useChatSessions so updateChatMessages / setArtifacts are in scope.
  const turnHandlers = useChatPersistence({
    activeChatIdRef,
    processedTurnIdsRef,
    lastSuggestedAtRef,
    lastSummarizedCountRef,
    updateChatMessages,
    setArtifacts,
    takePendingImages,
    triggerSummarization,
    maybeGenerateTitle,
  })
  // Keep the ref current every render so a turn always calls the latest handlers.
  turnHandlersRef.current = turnHandlers

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

  // Sync chat errors to UI. `chatError` is the ACTIVE chat's: when it goes away
  // (the user switched chats, or that chat recovered), take its message down
  // too — unless something else has replaced it on the banner since.
  const shownChatErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (chatError) {
      const text = chatErrorText(chatError.message)
      shownChatErrorRef.current = text
      setError(text)
    } else if (shownChatErrorRef.current != null) {
      const stale = shownChatErrorRef.current
      shownChatErrorRef.current = null
      setError(prev => (prev === stale ? null : prev))
    }
  }, [chatError])

  // Errors stay on screen until dismissed or replaced — no auto-dismiss (F6 /
  // prior C9): a failure the user glanced away from must not vanish unseen.

  // Helper Functions defined with useCallback
  // `fresh` bypasses the browser cache: /api/models is served with a 5-minute
  // max-age, so after an API-key change a cached (possibly empty) list would
  // hide the new models (U8). 'reload' also re-primes the cache, so a page
  // reload right after a key change sees the new list too ('no-store' would not).
  const fetchModels = useCallback(async ({ fresh = false }: { fresh?: boolean } = {}) => {
    try {
      // Clear only this loader's own errors — errors no longer auto-dismiss, so
      // a settings save must not wipe, say, "Failed to create chat."
      setError(prev => (prev === NO_MODELS_ERROR || prev === MODELS_LOAD_ERROR ? null : prev))
      const res = await fetch("/api/models", fresh ? { cache: 'reload' } : undefined)
      if (!res.ok) throw new Error("Failed to fetch models")

      const data = await res.json()
      if (data.models) setModels(data.models)
      if (data.models?.length > 0) {
         // Use configured default model if it exists in the available models
         const defaultModel = await getSetting('default-model')
         const modelExists = defaultModel && data.models.some((m: { model: string }) => m.model === defaultModel)
         // Fallback seeds from the default persona's model (a tier — resolve it
         // against the just-fetched list) if available, else the first listed
         // model — keeps model + default persona consistent.
         const resolvedPersonaModel = resolvePersonaModel(defaultPersona, data.models)
         const personaModelAvailable = data.models.some((m: { model: string }) => m.model === resolvedPersonaModel)
         const fallbackModel = personaModelAvailable ? resolvedPersonaModel : data.models[0].model
         setSelectedModel(modelExists ? defaultModel : fallbackModel)
      } else {
         setError(NO_MODELS_ERROR)
      }
    } catch (e) {
      console.error(e)
      setError(MODELS_LOAD_ERROR)
    }
  }, [])
  const refreshModels = useCallback(() => fetchModels({ fresh: true }), [fetchModels])

  // Settings → Model Defaults → "Default system prompt" (D4/U9): written to a new
  // chat created with no persona or custom prompt (persona → custom → default).
  // Held in a ref, loaded on mount and again after every settings save, so the
  // create path normally reads it synchronously — no extra round-trip and no
  // extra await between creating the chat and handing it the message (an added
  // await there lets a fast failing turn end before its chat is on screen).
  // `undefined` = not loaded yet: a chat created that early awaits the load
  // (`defaultSystemPrompt()`) instead of silently skipping the default.
  const defaultSystemPromptRef = useRef<string | null | undefined>(undefined)
  const defaultSystemPromptLoadRef = useRef<Promise<string | null> | null>(null)
  const loadDefaultSystemPrompt = useCallback(() => {
    const load = (async () => {
      try {
        const value = await getSetting('default-system-prompt')
        defaultSystemPromptRef.current = value && value.trim() ? value : null
      } catch {
        // Best-effort: keep the last known value (none yet → no default).
        if (defaultSystemPromptRef.current === undefined) defaultSystemPromptRef.current = null
      }
      return defaultSystemPromptRef.current ?? null
    })()
    defaultSystemPromptLoadRef.current = load
    return load
  }, [])
  // The default system prompt for a chat being created now: from the ref, or —
  // before the first load has finished — once that load lands.
  const defaultSystemPrompt = useCallback(async (): Promise<string | null> => {
    const known = defaultSystemPromptRef.current
    if (known !== undefined) return known
    return defaultSystemPromptLoadRef.current ?? loadDefaultSystemPrompt()
  }, [loadDefaultSystemPrompt])
  const handleSettingsChanged = useCallback(() => {
    void refreshModels()
    void loadDefaultSystemPrompt()
  }, [refreshModels, loadDefaultSystemPrompt])

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
    } finally {
      setChatListsLoaded(prev => (prev.standalone ? prev : { ...prev, standalone: true }))
    }
  }, [])

  const loadArchivedChats = useCallback(async () => {
    try {
      const c = await getArchivedChats()
      setArchivedChats(c)
    } catch (e) {
      console.error(e)
      setError("Failed to load archived chats.")
    } finally {
      setChatListsLoaded(prev => (prev.archived ? prev : { ...prev, archived: true }))
    }
  }, [])

  const loadAllProjectChats = useCallback(async () => {
    try {
      const c = await getAllProjectChats()
      setChats(c)
    } catch (e) {
      console.error(e)
      setError("Failed to load chats.")
    } finally {
      setChatListsLoaded(prev => (prev.chats ? prev : { ...prev, chats: true }))
    }
  }, [])

  // True while a chat's history is being fetched — MessagesList holds layout
  // with skeletons instead of flashing empty-then-pop.
  const [messagesLoading, setMessagesLoading] = useState(false)

  // Resolves to true when the chat's transcript is in its session (applied here,
  // or a turn in flight makes the live session authoritative), false when the
  // load went stale or failed.
  const loadMessages = useCallback(async (cid: number): Promise<boolean> => {
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
      if (activeChatIdRef.current !== cid) return false

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
      if (activeChatIdRef.current !== cid) return false
      // A turn is in flight in this chat (the user left mid-stream and came back):
      // its session holds the live transcript, and the DB snapshot — which has no
      // reply yet — must not replace it.
      if (isChatBusy(cid)) return true

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
      return true
    } catch (e) {
      console.error(e)
      setError("Failed to load messages.")
      return false
    }
  }, [setMessages, isChatBusy])

  const refreshChatPreviews = useCallback(async () => {
    if (activeProjectId) {
      try {
        const previews = await getProjectChatPreviews(activeProjectId)
        setChatPreviews(previews)
      } catch (e) {
        // Best-effort refresh after an action that already succeeded.
        console.error(e)
      }
    }
  }, [activeProjectId])

  // Load Projects and all chats on mount
  useEffect(() => {
    loadProjects()
    loadStandaloneChats()
    loadAllProjectChats()
    loadArchivedChats()
    fetchModels()
    loadDefaultSystemPrompt()
  }, [loadProjects, loadStandaloneChats, loadAllProjectChats, loadArchivedChats, fetchModels, loadDefaultSystemPrompt])

  // Validate persisted activeChatId/activeProjectId after data loads. Also cleans
  // stale deep links (useUrlNavSync restores ids from the URL optimistically);
  // suppressNextPush makes the URL correction a replaceState so history gets no
  // dead entry pointing at the broken URL. A chat id is judged only once all three
  // chat lists have loaded, and an archived chat counts as known (U2).
  useEffect(() => {
    if (activeChatId !== null) {
      if (isStaleChatId(activeChatId, { chats, standaloneChats, archivedChats }, chatListsLoaded)) {
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
  }, [projects, chats, standaloneChats, archivedChats, chatListsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // handleSendMessage: its chat session already holds the authoritative optimistic user
      // message + streaming reply, so loading the empty/partial snapshot would clobber
      // them. Subsequent opens of the same chat load normally.
      if (skipLoadOnceRef.current === activeChatId) {
        skipLoadOnceRef.current = null
        // No load to wait for: the new chat's session is the whole transcript.
        historyLoadRef.current = null
      } else {
        // Opening an existing chat always starts ungrounded (review F2/F4): a
        // previous chat's or compose surface's grounded state must not leak in —
        // outside a project the pill can be hidden, so a leaked ON would silently
        // answer "Not found" with no visible cause. Clears the manual-pick guard
        // too (pickedRef). The user re-toggles per chat as needed; fresh composes
        // are untouched — they run their own reset + persona-default paths.
        resetGroundedPick()
        applyGroundedDefault(false)
        // Each chat has its own session, so this never touches another chat's
        // transcript — and switching never stops a stream. A chat reopened while
        // its turn is still streaming keeps its live transcript (loadMessages then
        // refreshes only the artifacts); any other chat starts empty and shows
        // the loading skeleton until its history lands.
        const turnInFlight = isChatBusy(activeChatId)
        if (!turnInFlight) setMessages([])
        setArtifacts([])
        setMessagesLoading(!turnInFlight)
        const done = loadMessages(activeChatId)
        historyLoadRef.current = { chatId: activeChatId, done }
        done.finally(() => {
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
      // No chat: the "home" session is never sent through, so its transcript is
      // always empty — there is nothing to clear (and a reply still streaming in
      // the chat just left stays in that chat's own session).
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
      if (defaults.defaultModel) {
        // Mirrors the membership check fetchModels already applies to the
        // persisted 'default-model' setting — a stale/retired project default
        // must not silently apply (defense in depth; updateProjectDefaults
        // also refuses to persist an unrecognized id at the source).
        if (models.some(m => m.model === defaults.defaultModel)) {
          setSelectedModel(defaults.defaultModel)
        } else {
          console.warn(`[models] project default model "${defaults.defaultModel}" is not available, keeping current selection`)
        }
      }
    } catch {
      // Defaults are optional.
    }
    // A persona the user picked while the defaults round-trip was in flight WINS —
    // without this guard the late resolve silently reverted the pick (live bug).
    if (!composePersonaPickedRef.current) setCurrentSystemPrompt(promptToApply)
  }, [getPersonaById, resetGroundedPick, applyGroundedDefault, defaultPersona.grounded, models])

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

  // Double-send guard (U5). Set synchronously when a send starts and released
  // once the message is handed to its chat session — NOT when the reply ends:
  // sending from another chat while a reply streams in the background is allowed.
  // Without it, a second Enter during the deferred-create round-trips created a
  // second chat. The composer is also cleared before the first await, so a
  // second keypress finds nothing to send.
  const sendingRef = useRef(false)

  // Snapshot the composer and clear it — synchronously, before any await.
  const takeComposer = useCallback((): ComposerSnapshot => {
    const snapshot = { input, files: attachedFiles, images: attachedImages }
    setInput("")
    setAttachedFiles([])
    setAttachedImages([])
    return snapshot
  }, [input, attachedFiles, attachedImages])

  // A send that failed before reaching a chat puts its message back, unless the
  // user has already started typing or attaching a new one.
  const restoreComposer = useCallback((snapshot: ComposerSnapshot) => {
    setInput(prev => prev || snapshot.input)
    setAttachedFiles(prev => (prev.length > 0 ? prev : snapshot.files))
    setAttachedImages(prev => (prev.length > 0 ? prev : snapshot.images))
  }, [])

  // Shared tail of every send path: send the composer snapshot through the TARGET
  // chat's own session. The chat id is passed in rather than read from state — a
  // chat created a moment ago (deferred create) is not the "active" one in this
  // render yet, and the turn must be bound to it regardless: its session starts
  // with an empty transcript, and /api/chat saves both messages to that chat.
  // Returns the turn's promise (it resolves when the reply ends).
  const sendComposerMessage = useCallback((chatId: number, snapshot: ComposerSnapshot) => {
    // Images wait for the server to report the saved user row (turn pipeline).
    if (snapshot.images.length > 0) pendingImagesRef.current.set(chatId, [...snapshot.images])
    else pendingImagesRef.current.delete(chatId)
    groundedAtSendRef.current.set(chatId, groundedRef.current)
    return sendToChat(chatId, buildComposerMessage(snapshot.input, snapshot.files, snapshot.images))
  }, [sendToChat])

  // Refuse a send whose /api/chat body would pass the platform's request limit —
  // measured as the real request: the target chat's whole live transcript (earlier
  // inline images, attached files' text) plus the new message. `chatId` null means
  // a chat that doesn't exist yet (empty transcript). Returns true when refused.
  const refuseOversizedSend = useCallback((chatId: number | null): boolean => {
    // Images ride inline in the /api/chat body; over budget the platform rejects
    // the request outright. Refuse before creating a chat or sending anything.
    if (exceedsImageBudget(attachedImages)) {
      toast.error(IMAGE_BUDGET_MESSAGE)
      return true
    }
    const problem = chatRequestSizeError(
      chatId == null ? [] : peekChatMessages(chatId),
      buildComposerMessage(input, attachedFiles, attachedImages),
    )
    if (problem) {
      toast.error(problem)
      return true
    }
    return false
  }, [input, attachedFiles, attachedImages, peekChatMessages])

  // Waits for the history load of the chat a send targets; true once its whole
  // transcript is in its session and the chat is still the active one. A failed
  // or stale load is retried once.
  const awaitChatHistory = async (chatId: number): Promise<boolean> => {
    const load = historyLoadRef.current
    if (load?.chatId !== chatId) return true
    if (await load.done) return activeChatIdRef.current === chatId
    if (activeChatIdRef.current !== chatId) return false
    const retry = loadMessages(chatId)
    historyLoadRef.current = { chatId, done: retry }
    return (await retry) && activeChatIdRef.current === chatId
  }

  const handleSendMessage = async () => {
    if ((!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0) || isLoading || sendingRef.current) return
    sendingRef.current = true
    let started: StartedSend | null = null
    try {
      // The posted messages are the model's whole context: never send before the
      // chat's history is in its session. The draft stays in the composer meanwhile.
      if (activeChatId && !(await awaitChatHistory(activeChatId))) {
        toast.error("Couldn't load this chat's history — your message was not sent")
        return
      }
      // Checked before creating a chat, so a refused send leaves nothing behind
      // (and the composer keeps the message). After the history wait, so the
      // measured transcript is the real one.
      if (refuseOversizedSend(activeChatId)) return
      const composed = takeComposer()
      started = await startSend(composed)
    } finally {
      sendingRef.current = false
    }
    await started?.turn
  }

  // Resolves once the message is handed to a chat session — the turn itself is
  // wrapped so awaiting this doesn't wait for the reply — or to null when the
  // chat could not be created (the composer is restored).
  const startSend = async (composed: ComposerSnapshot): Promise<StartedSend | null> => {
    // No chat yet → create it now (deferred create). In a project compose, create the
    // chat in that project and persist the (default) system prompt; otherwise a quick
    // standalone chat. Either way nothing is persisted until this first message.
    let targetChatId = activeChatId
    if (!targetChatId) {
      try {
        const projectId = activeProjectIdRef.current
        const [newC] = projectId != null ? await createChat(projectId, "New Chat") : await createStandaloneChat("New Chat")
        if (projectId != null) setChats(prev => [newC, ...prev])
        else setStandaloneChats(prev => [newC, ...prev])
        // Persist the chat's system prompt — the composer's persona/custom prompt,
        // else the default system prompt (D4/U9) — so it survives the post-create
        // reload and applies to the first message.
        let systemPrompt = currentSystemPrompt || defaultSystemPromptRef.current
        if (systemPrompt === undefined) systemPrompt = await defaultSystemPrompt()
        if (systemPrompt) {
          await updateChatSystemPrompt(newC.id, systemPrompt).catch(() => {})
        }
        skipLoadOnceRef.current = newC.id
        setActiveChatId(newC.id)
        activeChatIdRef.current = newC.id
        targetChatId = newC.id
        setNewChatCompose(false)
      } catch (e) {
        console.error(e)
        setError("Failed to create chat.")
        restoreComposer(composed)
        return null
      }
    }

    return { turn: sendComposerMessage(targetChatId, composed) }
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
  // Resolves once the message is handed to the new chat's session (null when the
  // chat could not be created — the composer is restored).
  const startLandingSend = useCallback(async (projectId: number, composed: ComposerSnapshot): Promise<StartedSend | null> => {
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
          // Mirrors the membership check fetchModels already applies to the
          // persisted 'default-model' setting — a stale/retired project default
          // must not silently apply (defense in depth; updateProjectDefaults
          // also refuses to persist an unrecognized id at the source).
          if (models.some(m => m.model === defaults.defaultModel)) {
            setSelectedModel(defaults.defaultModel)
            selectedModelRef.current = defaults.defaultModel
          } else {
            console.warn(`[models] project default model "${defaults.defaultModel}" is not available, keeping current selection`)
          }
        }
      } catch {
        // Defaults are optional.
      }
    }

    let newChatId: number
    try {
      const [newC] = await createChat(projectId, "New Chat")
      setChats(prev => [newC, ...prev])
      // No persona (picked or project default) and no custom prompt → the
      // default system prompt (D4/U9).
      const fallback = systemPrompt || defaultSystemPromptRef.current
      systemPrompt = fallback === undefined ? await defaultSystemPrompt() : fallback
      if (systemPrompt) {
        await updateChatSystemPrompt(newC.id, systemPrompt).catch(() => {})
        setCurrentSystemPrompt(systemPrompt)
      }
      skipLoadOnceRef.current = newC.id
      setActiveChatId(newC.id)
      activeChatIdRef.current = newC.id
      newChatId = newC.id
      setNewChatCompose(false)
    } catch (e) {
      console.error(e)
      setError("Failed to create chat.")
      restoreComposer(composed)
      return null
    }

    return { turn: sendComposerMessage(newChatId, composed) }
  }, [getPersonaById, sendComposerMessage, restoreComposer, defaultSystemPrompt, currentSystemPrompt, applyGroundedDefault, models])

  const handleProjectLandingCompose = useCallback(async () => {
    if ((!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0) || isLoading || sendingRef.current) return
    // Always a new chat: only the message itself is measured.
    if (refuseOversizedSend(null)) return
    const projectId = activeProjectIdRef.current
    if (projectId == null) return
    // Same double-send guard as handleSendMessage, over a wider window (defaults
    // load + create + system prompt, all before the message is handed over).
    sendingRef.current = true
    const composed = takeComposer()
    let started: StartedSend | null
    try {
      started = await startLandingSend(projectId, composed)
    } finally {
      sendingRef.current = false
    }
    await started?.turn
  }, [input, attachedFiles, attachedImages, isLoading, refuseOversizedSend, takeComposer, startLandingSend])

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

  const handleRequestDeleteProject = useCallback((id: number) => {
    dialogs.deleteProject.open(id)
  }, [dialogs.deleteProject])

  const handleConfirmDeleteProject = useCallback(async () => {
    if (dialogs.deleteProject.target == null) return
    const targetId = dialogs.deleteProject.target
    try {
      await deleteProject(targetId)
      setProjects(prev => prev.filter(p => p.id !== targetId))
      // The DB cascades the project's chats; drop them from page state too so the
      // palette and the deep-link validator stop treating them as live (U14).
      const lists = { chats: chatsRef.current, standaloneChats: standaloneChatsRef.current, archivedChats: archivedChatsRef.current }
      const next = removeProjectChats(lists, targetId)
      if (next !== lists) {
        setChats(next.chats)
        setArchivedChats(next.archivedChats)
      }
      const closesChat = findChatById(activeChatIdRef.current, lists)?.projectId === targetId
      const closesProject = activeProjectIdRef.current === targetId
      // Leaving a deleted project's page is a correction, not a navigation: replace
      // the URL so Back doesn't land on the dead ?project= / ?chat= entry. Only
      // when that page is ON SCREEN: behind a tab view (selectView keeps
      // activeProjectId) the URL doesn't change, the flag would stay armed, and
      // the next real navigation would become a replace.
      if ((closesChat || closesProject) && activeViewRef.current === 'home') suppressNextNavPush()
      if (closesChat) setActiveChatId(null)
      if (closesProject) setActiveProjectId(null)
      dialogs.deleteProject.close()
      toast.success("Project deleted")
    } catch (e) {
      console.error("Delete project failed:", e)
      toast.error("Failed to delete project")
    }
  }, [dialogs.deleteProject, suppressNextNavPush])

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
    try {
      await updateChatTitle(target.id, newTitle)
    } catch (e) {
      console.error("Rename failed:", e)
      toast.error("Failed to rename chat")
      return
    }
    setChats(prev => prev.map(c => c.id === target.id ? { ...c, title: newTitle } : c))
    setStandaloneChats(prev => prev.map(c => c.id === target.id ? { ...c, title: newTitle } : c))
    setArchivedChats(prev => prev.map(c => c.id === target.id ? { ...c, title: newTitle } : c))
    dialogs.renameChat.close()
    refreshChatPreviews()
    toast.success("Chat renamed")
  }, [dialogs.renameChat, refreshChatPreviews])

  const handleMoveChat = useCallback(async (chatId: number, projectId: number | null) => {
    try {
      await moveChatToProject(chatId, projectId)
    } catch (e) {
      console.error("Move failed:", e)
      toast.error("Failed to move chat")
      return
    }
    // Move it between lists now, in one batched tick (as handleRestoreChat does):
    // the two reloads below land independently, and the moved chat (possibly the
    // open one) must never be absent from every list in between or the validator
    // would close it.
    const next = moveChatInLists({ chats: chatsRef.current, standaloneChats: standaloneChatsRef.current, archivedChats: archivedChatsRef.current }, chatId, projectId)
    setChats(next.chats)
    setStandaloneChats(next.standaloneChats)
    setArchivedChats(next.archivedChats)
    loadStandaloneChats()
    loadAllProjectChats()
    refreshChatPreviews()
    toast.success(projectId ? "Chat moved to project" : "Chat moved to Quick Chats")
  }, [loadAllProjectChats, loadStandaloneChats, refreshChatPreviews])

  const handleArchiveChat = useCallback(async (chatId: number) => {
    try {
      await archiveChat(chatId)
    } catch (e) {
      console.error("Archive failed:", e)
      toast.error("Failed to archive chat")
      return
    }
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
    try {
      await restoreChat(chatId)
    } catch (e) {
      console.error("Restore failed:", e)
      toast.error("Failed to restore chat")
      return
    }
    // Move it between lists now, in one batched tick: the three reloads below land
    // independently, and the restored chat (possibly the open one) must never be
    // absent from all three in between or the validator would close it.
    const next = moveRestoredChat({ chats: chatsRef.current, standaloneChats: standaloneChatsRef.current, archivedChats: archivedChatsRef.current }, chatId)
    setChats(next.chats)
    setStandaloneChats(next.standaloneChats)
    setArchivedChats(next.archivedChats)
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

  // View-aware navigation, shared by the sidebar and the command palette: both can
  // fire from the Projects/Artifacts/Images tabs, which render ahead of the chat
  // pane, so each switches back to 'home' first (U7).
  const openProject = useCallback((id: number) => {
    setActiveView('home')
    handleSelectProject(id)
  }, [handleSelectProject])
  const openStandaloneChat = useCallback((id: number) => {
    setActiveView('home')
    handleSelectStandaloneChat(id)
  }, [handleSelectStandaloneChat])
  // Opens any chat — project, quick or archived — under its OWN project.
  const openChat = useCallback((id: number, projectId: number | null) => {
    setActiveView('home')
    setActiveProjectId(projectId)
    setActiveChatId(id)
  }, [])
  const openProjectChat = useCallback((id: number) => {
    openChat(id, chatsRef.current.find(c => c.id === id)?.projectId ?? null)
  }, [openChat])

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

      // Record persona usage for tracking. The server files it under the chat's own
      // project — the nav project (activeProjectIdRef) can be stale here.
      const matchedPersona = getPersonaByPrompt(prompt)
      recordPersonaUsage({
        chatId: activeChatId,
        personaId: matchedPersona?.id ?? (prompt ? 'custom' : 'default'),
        modelUsed: selectedModelRef.current || null,
      }).catch(() => {}) // Best-effort
    } catch (e) {
      console.error(e)
      setError("Failed to update system instruction.")
    }
  }, [activeChatId, applyGroundedDefault, getPersonaByPrompt])

  // "Project settings" (per-project default persona + model, D1): opened from the
  // project chat header menu, the project landing header menu and the Projects
  // view card menu.
  const handleOpenProjectSettings = useCallback((projectId: number) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      dialogs.projectDefaults.open({ id: project.id, name: project.name })
    }
  }, [projects, dialogs.projectDefaults])

  // Message Delete (D2). The DB row id is resolved from the transcript
  // (resolveMessageDbId): a loaded message's own id, a session reply's turn
  // metadata, or a session user message's id on the reply after it. MessagesList
  // only offers Delete when that id is known and no turn is in flight.
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const chatId = activeChatIdRef.current
    const index = messages.findIndex(m => m.id === messageId)
    const dbId = resolveMessageDbId(messages, index)
    if (chatId == null || dbId == null || isChatBusy(chatId)) return
    try {
      await deleteMessage(dbId)
    } catch (e) {
      console.error('Delete message failed:', e)
      toast.error("Couldn't delete the message")
      return
    }
    updateChatMessages(chatId, prev => prev.filter(m => m.id !== messageId))
    toast.success('Message deleted')
  }, [messages, isChatBusy, updateChatMessages])

  // Regenerate (D2): the last assistant reply only. The SDK drops it from the
  // store and re-posts the transcript up to the user message; the request carries
  // `regenerate: true` + the replaced reply's DB id, and /api/chat writes the new
  // reply over that row when it is persisted (nothing is deleted up front), so the
  // chat keeps exactly one reply and a regenerate that saves nothing keeps the old
  // one. The model, effort and grounded mode are the composer's current ones, like
  // any send.
  const handleRegenerate = useCallback((messageId: string) => {
    const chatId = activeChatIdRef.current
    if (chatId == null || isChatBusy(chatId) || sendingRef.current) return
    const index = messages.findIndex(m => m.id === messageId)
    if (index === -1 || index !== messages.length - 1 || messages[index].role !== 'assistant') return
    const replaceMessageDbId = resolveMessageDbId(messages, index)
    if (replaceMessageDbId == null) return
    // No images ride on a regenerate; anything left for this chat must not be
    // attached to the existing user row.
    pendingImagesRef.current.delete(chatId)
    groundedAtSendRef.current.set(chatId, groundedRef.current)
    clearFollowUps()
    // The SDK drops the reply from the store before posting. The server only
    // writes over it once a new reply exists, so when the turn ends with nothing
    // the server would save (an HTTP refusal or error before the stream, an error
    // or Stop before any text or media — possibly after reasoning or a web search
    // call) the old reply is still the saved one: put the kept copy back right
    // after the user message it answers, in place of any content-less reply.
    const replaced = messages[index]
    const answered = messages[index - 1]
    regenerateInChat(chatId, messageId, { regenerate: true, replaceMessageDbId })
      .then(() => {
        updateChatMessages(chatId, prev => {
          if (!answered) return prev
          const last = prev[prev.length - 1]
          if (last?.id === answered.id) return [...prev, replaced]
          const beforeLast = prev[prev.length - 2]
          if (last?.role === 'assistant' && beforeLast?.id === answered.id && !replyHasSavedContent(last.parts)) {
            return [...prev.slice(0, -1), replaced]
          }
          return prev
        })
      })
      .catch(err => console.error('[chat] regenerate failed:', err))
  }, [messages, isChatBusy, regenerateInChat, updateChatMessages, clearFollowUps])

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
      // Resolve a tier to a concrete id before it reaches selectedModel (and,
      // from there, the /api/chat request body).
      setSelectedModel(resolvePersonaModel(suggestedPersona, models))
    }
    setSelectedEffort(suggestedPersona.effort)
    dismissSuggestion()
    toast.success(`Switched to ${suggestedPersona.name}`)
  }, [suggestedPersona, handleSaveSystemPrompt, dismissSuggestion, models])

  // Rejects on failure (after a toast) so the rail can show "Not saved".
  const handleSaveProjectContext = useCallback(async (id: number, fields: { memory?: string; instructions?: string }) => {
    try {
      await updateProjectContext(id, fields)
    } catch (e) {
      console.error("Save project context failed:", e)
      toast.error("Couldn't save the project context")
      throw e
    }
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...fields, updatedAt: new Date() } : p))
  }, [])

  // The rail accepted a memory suggestion server-side. Mirror it into page state:
  // the rail remounts from `projects`, and a stale copy would be shown — then
  // debounce-saved back over the accepted fact — on the next visit (U6).
  const handleMemoryChanged = useCallback((projectId: number, memory: string) => {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, memory } : p))
  }, [])

  useEffect(() => { getSetting('display-name').then(v => { if (v) setDisplayName(v) }).catch(() => {}) }, [])

  const handleDisplayNameChange = useCallback((value: string) => {
    setDisplayName(value)
    setSetting('display-name', value).catch(() => {})
  }, [])

  const sidebarActions = useMemo<SidebarActions>(() => ({
    createStandaloneChat: handleCreateStandaloneChat,
    createChatInProject: handleCreateChatInProject,
    selectStandaloneChat: openStandaloneChat,
    openChat,
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
  }), [handleCreateStandaloneChat, handleCreateChatInProject, setActiveChatId, openStandaloneChat, openChat, handleMoveChat, handleRequestRename, handleArchiveChat, handleRestoreChat, handleRequestDelete, theme, activeView, dialogs.settings, titlePendingIds])

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
        {/* Error banner — page level, so an error raised on Home, a project landing
            or a tab view is shown too (F6). Stays until dismissed or replaced. */}
        {error && (
          <div role="alert" className="shrink-0 flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive max-md:pl-14">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 hover:opacity-80">
              Dismiss
            </button>
          </div>
        )}
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
            onOpenProjectSettings={handleOpenProjectSettings}
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
              projectId={currentChatProjectId}
              projectName={currentChatProjectName}
              onProjectClick={currentChat?.projectId ? () => { setActiveView('home'); handleSelectProject(currentChat.projectId!); setActiveChatId(null); } : undefined}
              onOpenProjectSettings={handleOpenProjectSettings}
            />

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
                onDeleteMessage={handleDeleteMessage}
                onRegenerate={handleRegenerate}
                artifacts={artifacts}
                onOpenArtifact={setActiveArtifactId}
                messagesLoading={messagesLoading}
                status={status}
                documentsById={documentsById}
                onOpenCitation={handleOpenCitation}
                isGroundedTurn={isGroundedTurn}
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
            onMemoryChanged={handleMemoryChanged}
            onDeleteProject={handleRequestDeleteProject}
            onBack={() => { setActiveView('projects'); setActiveChatId(null); setActiveProjectId(null) }}
            onRename={() => handleRequestRenameProject(activeProjectId)}
            onOpenProjectSettings={handleOpenProjectSettings}
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
        onSelectProject={openProject}
        onSelectChat={openProjectChat}
        onSelectStandaloneChat={openStandaloneChat}
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
        onSettingsChanged={handleSettingsChanged}
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
