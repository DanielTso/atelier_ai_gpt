# Quick Actions + File-Flow Clarity — Design

**Status:** Approved design (2026-06-19). Branch: `feat/persona-system-v2` (ships with the persona work). A small UX correction informed by how Claude/ChatGPT/Gemini structure attachments vs. persistent project knowledge.

## Goal

Resolve the file/action confusion on the Home screen: (1) the **Upload** quick-action silently no-ops on Home (no active project to upload into), (2) the **Write/Code** chips are placeholders, and (3) "Upload" (project knowledge / RAG) reads the same as "Attach" (per-message input) despite being different things. Fix all three by reusing existing surfaces — no new concepts.

## Non-goals

- No document **re-versioning** (Gemini-style live update) — deferred.
- No **auto-memory** — deferred.
- No global "current project" indicator — YAGNI for now.
- No backend/DB changes.

## Current state

- **`src/components/chat/QuickActions.tsx`** — 4 chips (New project, Upload, Write, Code) via named handlers.
- **`src/app/page.tsx`** — `<QuickActions onNewProject={handleCreateProject} onUpload={() => activeProjectId && handleOpenProjectDocuments(activeProjectId)} onWrite={() => setInput('Help me write ')} onCode={() => setInput('Help me write code for ')} />`. `onUpload` short-circuits to nothing when `activeProjectId` is null (Home).
- **`handleOpenProjectDocuments(projectId)`** opens a project's documents dialog. `setActiveView('projects')` shows the Projects grid.
- **`src/components/chat/ChatInputArea.tsx`** — the **Attach** affordance (paperclip) attaches a file/image to the current message.

## Design

### 1. `QuickActions` — construction starters (config-driven)
Replace the chip set with four named handlers; the chip list is defined inside the component (swapping later is one line):

```ts
interface QuickActionsProps {
  onNewProject: () => void
  onAddDocuments: () => void
  onDraftRfi: () => void
  onLookahead: () => void
}
// chips: New project · Add documents · Draft RFI · 3-week look-ahead
```

Icons: `FolderPlus`, `Upload`, `FileText`, `CalendarRange` (lucide).

### 2. `page.tsx` — project-aware Add documents + starters
```tsx
<QuickActions
  onNewProject={handleCreateProject}
  onAddDocuments={() => activeProjectId ? handleOpenProjectDocuments(activeProjectId) : setActiveView('projects')}
  onDraftRfi={() => setInput('Draft an RFI for: ')}
  onLookahead={() => setInput('Build a 3-week look-ahead schedule for: ')}
/>
```
**Add documents** now always does something: with an active project → its documents dialog; on Home → the Projects view to pick/create one (mirrors how every major product gates "knowledge" behind a container). Drops the no-op.

### 3. Label clarity — "Add documents" ≠ "Attach"
- Chip renamed **Upload → "Add documents"** (persistent project knowledge / RAG).
- Composer **Attach** button gets `title="Attach to this message"` (one-off, this turn).
- No other copy changes; the project rail's "Files" already reads as project knowledge.

## Testing
- **`tests/hooks/QuickActions.test.tsx`** (update): renders the 4 new chips (New project, Add documents, Draft RFI, 3-week look-ahead); clicking each fires the matching handler.
- Manual smoke: on Home, **Add documents** opens the Projects view (no more dead click); inside a project it opens the documents dialog; **Draft RFI** / **look-ahead** prefill the composer; Attach tooltip reads "Attach to this message".
- Existing tests stay green; lint 0 errors, build clean.

## File layout (touched)
```
src/components/chat/QuickActions.tsx     # new chip set + named handlers
src/app/page.tsx                         # project-aware onAddDocuments; starter prefills
src/components/chat/ChatInputArea.tsx    # Attach tooltip "Attach to this message"
tests/hooks/QuickActions.test.tsx        # updated chips
```

## Definition of done
No dead Add-documents click anywhere; construction starter chips prefill the composer; Attach vs Add-documents read as distinct; gate green.
