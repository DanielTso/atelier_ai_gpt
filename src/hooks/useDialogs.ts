import { useState, useCallback, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Target shapes per dialog
// ---------------------------------------------------------------------------
type DeleteChatTarget = number
type DeleteProjectTarget = number
type RenameChatTarget = { id: number; title: string }
type RenameProjectTarget = { id: number; name: string }
type ProjectDefaultsTarget = { id: number; name: string }
type ProjectDocumentsTarget = { id: number; name: string }

// ---------------------------------------------------------------------------
// Controller shapes
// ---------------------------------------------------------------------------

/** Target-less dialog controller */
export interface SimpleDialogController {
  isOpen: boolean
  setOpen: (open: boolean) => void
}

/** Target-less dialog with a toggle (for the command palette Ctrl+K site) */
export interface ToggleDialogController extends SimpleDialogController {
  toggle: () => void
}

/** Target-bearing dialog controller: open(target) sets target + opens; close() clears */
export interface TargetDialogController<T> {
  isOpen: boolean
  target: T | null
  open: (target: T) => void
  close: () => void
  /** Mirrors `onOpenChange` — passing false clears the target (Dialog close path) */
  setOpen: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------
export interface Dialogs {
  commandPalette: ToggleDialogController
  settings: SimpleDialogController
  createProject: SimpleDialogController
  systemPrompt: SimpleDialogController
  deleteChat: TargetDialogController<DeleteChatTarget>
  deleteProject: TargetDialogController<DeleteProjectTarget>
  renameChat: TargetDialogController<RenameChatTarget>
  renameProject: TargetDialogController<RenameProjectTarget>
  projectDefaults: TargetDialogController<ProjectDefaultsTarget>
  projectDocuments: TargetDialogController<ProjectDocumentsTarget>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Centralises all dialog open/close state that was previously scattered across
 * 13 `useState` declarations in `page.tsx`.  Returns a single `dialogs` object
 * with stable controllers (setters are wrapped in useCallback/useMemo).
 *
 * Target dialogs clear their target whenever they close, matching the original
 * `setXTarget(null)` cleanup calls in each confirm handler.
 *
 * `currentSystemPrompt` is NOT managed here — it is composer state and must
 * remain in `page.tsx`.
 */
export function useDialogs(): Dialogs {
  // -------------------------------------------------------------------------
  // Target-less dialogs
  // -------------------------------------------------------------------------
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)

  // -------------------------------------------------------------------------
  // Target-bearing dialogs
  // -------------------------------------------------------------------------
  const [deleteChatOpen, setDeleteChatOpen] = useState(false)
  const [deleteChatTarget, setDeleteChatTarget] = useState<DeleteChatTarget | null>(null)

  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<DeleteProjectTarget | null>(null)

  const [renameChatOpen, setRenameChatOpen] = useState(false)
  const [renameChatTarget, setRenameChatTarget] = useState<RenameChatTarget | null>(null)

  const [renameProjectOpen, setRenameProjectOpen] = useState(false)
  const [renameProjectTarget, setRenameProjectTarget] = useState<RenameProjectTarget | null>(null)

  const [projectDefaultsOpen, setProjectDefaultsOpen] = useState(false)
  const [projectDefaultsTarget, setProjectDefaultsTarget] = useState<ProjectDefaultsTarget | null>(null)

  const [projectDocumentsOpen, setProjectDocumentsOpen] = useState(false)
  const [projectDocumentsTarget, setProjectDocumentsTarget] = useState<ProjectDocumentsTarget | null>(null)

  // -------------------------------------------------------------------------
  // Stable controllers (useCallback / useMemo to keep references stable)
  // -------------------------------------------------------------------------

  const toggleCommandPalette = useCallback(() => setCommandPaletteOpen(o => !o), [])

  // deleteChat
  const openDeleteChat = useCallback((target: DeleteChatTarget) => {
    setDeleteChatTarget(target)
    setDeleteChatOpen(true)
  }, [])
  const closeDeleteChat = useCallback(() => {
    setDeleteChatOpen(false)
    setDeleteChatTarget(null)
  }, [])
  const setDeleteChatOpenWithClear = useCallback((open: boolean) => {
    setDeleteChatOpen(open)
    if (!open) setDeleteChatTarget(null)
  }, [])

  // deleteProject
  const openDeleteProject = useCallback((target: DeleteProjectTarget) => {
    setDeleteProjectTarget(target)
    setDeleteProjectOpen(true)
  }, [])
  const closeDeleteProject = useCallback(() => {
    setDeleteProjectOpen(false)
    setDeleteProjectTarget(null)
  }, [])
  const setDeleteProjectOpenWithClear = useCallback((open: boolean) => {
    setDeleteProjectOpen(open)
    if (!open) setDeleteProjectTarget(null)
  }, [])

  // renameChat
  const openRenameChat = useCallback((target: RenameChatTarget) => {
    setRenameChatTarget(target)
    setRenameChatOpen(true)
  }, [])
  const closeRenameChat = useCallback(() => {
    setRenameChatOpen(false)
    setRenameChatTarget(null)
  }, [])
  const setRenameChatOpenWithClear = useCallback((open: boolean) => {
    setRenameChatOpen(open)
    if (!open) setRenameChatTarget(null)
  }, [])

  // renameProject
  const openRenameProject = useCallback((target: RenameProjectTarget) => {
    setRenameProjectTarget(target)
    setRenameProjectOpen(true)
  }, [])
  const closeRenameProject = useCallback(() => {
    setRenameProjectOpen(false)
    setRenameProjectTarget(null)
  }, [])
  const setRenameProjectOpenWithClear = useCallback((open: boolean) => {
    setRenameProjectOpen(open)
    if (!open) setRenameProjectTarget(null)
  }, [])

  // projectDefaults
  const openProjectDefaults = useCallback((target: ProjectDefaultsTarget) => {
    setProjectDefaultsTarget(target)
    setProjectDefaultsOpen(true)
  }, [])
  const closeProjectDefaults = useCallback(() => {
    setProjectDefaultsOpen(false)
    setProjectDefaultsTarget(null)
  }, [])
  const setProjectDefaultsOpenWithClear = useCallback((open: boolean) => {
    setProjectDefaultsOpen(open)
    if (!open) setProjectDefaultsTarget(null)
  }, [])

  // projectDocuments
  const openProjectDocuments = useCallback((target: ProjectDocumentsTarget) => {
    setProjectDocumentsTarget(target)
    setProjectDocumentsOpen(true)
  }, [])
  const closeProjectDocuments = useCallback(() => {
    setProjectDocumentsOpen(false)
    setProjectDocumentsTarget(null)
  }, [])
  const setProjectDocumentsOpenWithClear = useCallback((open: boolean) => {
    setProjectDocumentsOpen(open)
    if (!open) setProjectDocumentsTarget(null)
  }, [])

  // -------------------------------------------------------------------------
  // Assemble and return the dialogs object (stable via useMemo)
  // -------------------------------------------------------------------------
  return useMemo<Dialogs>(() => ({
    commandPalette: {
      isOpen: commandPaletteOpen,
      setOpen: setCommandPaletteOpen,
      toggle: toggleCommandPalette,
    },
    settings: {
      isOpen: settingsOpen,
      setOpen: setSettingsOpen,
    },
    createProject: {
      isOpen: createProjectOpen,
      setOpen: setCreateProjectOpen,
    },
    systemPrompt: {
      isOpen: systemPromptOpen,
      setOpen: setSystemPromptOpen,
    },
    deleteChat: {
      isOpen: deleteChatOpen,
      target: deleteChatTarget,
      open: openDeleteChat,
      close: closeDeleteChat,
      setOpen: setDeleteChatOpenWithClear,
    },
    deleteProject: {
      isOpen: deleteProjectOpen,
      target: deleteProjectTarget,
      open: openDeleteProject,
      close: closeDeleteProject,
      setOpen: setDeleteProjectOpenWithClear,
    },
    renameChat: {
      isOpen: renameChatOpen,
      target: renameChatTarget,
      open: openRenameChat,
      close: closeRenameChat,
      setOpen: setRenameChatOpenWithClear,
    },
    renameProject: {
      isOpen: renameProjectOpen,
      target: renameProjectTarget,
      open: openRenameProject,
      close: closeRenameProject,
      setOpen: setRenameProjectOpenWithClear,
    },
    projectDefaults: {
      isOpen: projectDefaultsOpen,
      target: projectDefaultsTarget,
      open: openProjectDefaults,
      close: closeProjectDefaults,
      setOpen: setProjectDefaultsOpenWithClear,
    },
    projectDocuments: {
      isOpen: projectDocumentsOpen,
      target: projectDocumentsTarget,
      open: openProjectDocuments,
      close: closeProjectDocuments,
      setOpen: setProjectDocumentsOpenWithClear,
    },
  }), [
    commandPaletteOpen, toggleCommandPalette,
    settingsOpen,
    createProjectOpen,
    systemPromptOpen,
    deleteChatOpen, deleteChatTarget, openDeleteChat, closeDeleteChat, setDeleteChatOpenWithClear,
    deleteProjectOpen, deleteProjectTarget, openDeleteProject, closeDeleteProject, setDeleteProjectOpenWithClear,
    renameChatOpen, renameChatTarget, openRenameChat, closeRenameChat, setRenameChatOpenWithClear,
    renameProjectOpen, renameProjectTarget, openRenameProject, closeRenameProject, setRenameProjectOpenWithClear,
    projectDefaultsOpen, projectDefaultsTarget, openProjectDefaults, closeProjectDefaults, setProjectDefaultsOpenWithClear,
    projectDocumentsOpen, projectDocumentsTarget, openProjectDocuments, closeProjectDocuments, setProjectDocumentsOpenWithClear,
  ])
}
