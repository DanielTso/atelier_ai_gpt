# Atelier Studio iteration loop — design seed from the Manus 1.6 recording (2026-07-11)

> Naming decision (user, 2026-07-11): no separate feature brand — this stays part of
> **Atelier Studio**. Internal shorthand in docs/commits: "the iteration loop."

Source: `C:\tmp\VID_20260711_203400308.mp4` (43s, 1080p phone recording of the desktop).
Frames extracted at 1fps and reviewed 2026-07-11. This doc captures what the video
actually shows, mapped to what Atelier already has, so the future brainstorm starts from
evidence instead of memory. Status: **design seed only — no decisions made.**

## What the video shows

Manus 1.6, same America page from the benchmark chase. User prompt: *"Enhance the
current scroll animations by adding parallax effects to the images for a more immersive
experience."* Split layout: chat left, live site preview right.

### 1. The chat side is a narrated build log, not a wall of tool calls

- Opening **narration paragraph** states intent in plain language ("Adding parallax
  scroll effects to all the images now — this will make the hero, section backgrounds,
  and reason images feel deeply immersive as you scroll.").
- Under it, **collapsible tool-step chips** grouped beneath the narration, each a
  one-line imperative summary: "Read the current Home.tsx to understand the structure
  before adding…", "Rewrite Home.tsx with comprehensive parallax effects on all
  images…", "Add parallax CSS classes to index.css — clip containers, inner layers…".
- **Narration between tool batches**: "I've integrated comprehensive parallax effects
  across all images… Next, I'll test the scroll behavior and finalize the deployment."
  The rhythm is narrate → act → narrate → act.

### 2. The agent self-verifies before claiming done

Explicit verification chips as first-class steps: "Verify the parallax page looks
correct at the hero and first section", "Check the reason sections to verify parallax
image wrappers render c…", "Check browser console for any JS errors related to
parallax" — followed by narration: "I confirmed the parallax images render correctly
and no JavaScript errors appear in the console, indicating stable scroll behavior."
Manus drives a real browser against its own build before handing over.

### 3. Checkpoints are the versioning model

- An explicit plan step: "Save checkpoint after adding parallax scroll effects to all
  images".
- The completion message is framed as a **diff against the previous checkpoint**:
  "Parallax is live across the entire site. Here's what changed from the previous
  checkpoint:" followed by a technical-but-readable summary (custom `useParallax` React
  hook, GPU-accelerated `translateY`, overflow-clipped wrappers, passive scroll
  listeners, `prefers-reduced-motion` freeze).

### 4. Plan progress is pinned above the composer

A persistent one-line strip sits directly above the input the whole session:
"✓ Deliver the permanent live URL to the user — 3/3 ▾" (collapsible). The **last plan
step is delivering the live URL** — publish/handover is part of the plan itself, not an
afterthought.

### 5. Completion UX

- Green "✓ Task completed" banner + "How was this result?" 5-star rating inline.
- "Suggested next steps" as a numbered list **inside the completion message** (animate
  stat counters, sticky progress bar, floating share panel) — each with a one-sentence
  sell of why it's worth doing.
- The same suggestions repeat as **clickable follow-up chips** below the banner, plus a
  meta-chip ("Make the process we used here into a re-usable skill with /skill-creator").
- **Artifact card** in-chat: title "America: The World's Most Wanted Address",
  state line "Not published · Just now", live hero thumbnail.

### 6. The preview panel is a mini-browser, not an iframe dump

Toolbar observed: Preview label · desktop/mobile device toggles · home button + path
("/") URL bar · open-in-new-tab · refresh · **Publish** button (with attention dot,
"Not published" state on the card) · Edit · fullscreen · close. A "Made with Manus"
badge floats on the page itself. The user then scrolls the built page full-screen —
the parallax layers, "SCROLL" hint, stat counters, and section reveals are the payoff
shot.

### Notably absent

The video does **not** show HTML streaming into the canvas token-by-token during
generation. The build happens behind tool-step chips; the preview shows up built. The
"live streaming canvas" (stream tool-call input deltas into the preview, Claude.ai
style) remains a separate idea this video neither confirms nor demonstrates. What the
video actually sells is the **iteration loop**: narrate → build → verify → checkpoint →
"what changed" → suggested next steps → one-click follow-up.

## Map to what Atelier already has (v4.47.0)

| Manus behavior | Atelier today | Gap |
|---|---|---|
| Narration between tool batches | Multi-step agentic chat (stopWhen 12) already interleaves text + tools | Prompting/TOOL_GUIDANCE nudge, mostly free |
| Tool-step chips | `ToolProgressCard` + staged `chatStage.ts` | Chips are per-tool; no grouping under narration; wording is generic |
| Self-verification in browser | None — artifacts are never checked after render | Real gap. Needs a sandboxed check (or Vercel Sandbox later, Code Phase C) |
| Checkpoints + "what changed" | `artifact_versions` table + Versions tab exist | No checkpoint framing in the completion message; no diff summary between versions |
| Pinned plan progress (3/3) | Nothing persistent above composer | New UI concept; small but high-signal |
| Suggested next steps in completion + chips | Follow-up chips shipped (`/api/suggest-followups`) | Numbered in-message next steps with rationale is a prompt change |
| Publish / "Not published" state | Artifacts are private, signed URLs only | Publishing (permanent public URL) is a whole feature decision — parked |
| Preview toolbar (device toggle, refresh, path) | `ArtifactWorkspace` has Preview/Edit/Versions + Download + resize | No device-width toggle, no refresh, no publish |
| Task completed banner + rating | None | Low priority cosmetic |

## Candidate slices for the eventual brainstorm (not commitments)

1. **Cheap prompt-level wins**: narration cadence + "here's what changed" completion
   framing + numbered next steps — TOOL_GUIDANCE edits, no schema changes.
2. **Pinned plan strip**: a small persistent progress line above the composer during
   agentic turns (data already exists in the step stream).
3. **Version diff summary**: when regenerating an artifact, have the model state what
   changed vs. the prior version (versions already stored).
4. **Device-width toggle + refresh** in `ArtifactWorkspace` preview toolbar.
5. **Self-verification**: the big one — depends on Code Phase C (Vercel Sandbox) or a
   lighter headless check; don't attempt before that lands.
6. **Publish**: deliberate product decision (public URLs from a gated app); needs its
   own brainstorm.

## IP guardrails (decided 2026-07-11)

User concern: no cease-and-desist / copyright exposure from Manus. Assessment: risk is
effectively zero if we follow the rule **take the function, never the form**. Rationale
and boundaries:

- Copyright protects *expression* (code, graphics, text), not ideas, workflows, or
  functional interaction patterns (Lotus v. Borland, Apple v. Microsoft — look-and-feel
  claims on functional patterns fail). Agent-canvas patterns also have massive prior
  art: checkpoints = git/Replit/Devin; narrated tool logs = Claude Code/Cursor; plan
  strips = Devin; self-verification = every coding agent; follow-up chips shipped in
  Atelier (v4.47.0) before this video was seen. Nobody owns these.
- Atelier is a gated, single-user, non-commercial personal app — no market confusion
  basis even in the worst case.
- **Hard rules regardless:** never copy Manus code (never seen it — everything written
  from scratch), never copy their assets/icons/visual design pixel-for-pixel, never use
  the Manus name or badge styling. All appearance and language designed from scratch in
  Atelier's own system (warm palette, Fraunces, terracotta).

## The original variation — atelier/craft metaphor (direction, locked enough to brainstorm from)

Legal hygiene and the aesthetic bar (distinctive, non-generic UI) point the same
direction: replace Manus's engineering vocabulary with Atelier's workshop/studio
vocabulary. The feature becomes the product's own idea, not a clone:

| Function (from the video) | Manus's form | Atelier's form |
|---|---|---|
| Versioned iteration + "what changed" | Checkpoints | **Drafts / Editions** (printmaking) — `artifact_versions` already stores the data; this is naming + a "what changed since the last draft" summary |
| Narrated build log | Status chips + narration | **Worklog** — studio-notes styling over the narration cadence multi-step Claude already produces |
| Pre-completion verification | "Verify/check" steps | **Proofing** (checking the proof before the edition) — honest framing since real verification waits for Code Phase C |
| Pinned plan progress | "3/3" strip | **Bench progress** line above the composer — same data, own presentation |
| Preview toolbar (device toggle, refresh) | Generic browser chrome | No originality concern — build directly into `ArtifactWorkspace` |

Feasibility unchanged from the slice list above: slices 1–4 are cheap (TOOL_GUIDANCE
prompt work + small UI, no schema changes); self-verification gated behind Code Phase C;
Publish parked (collides with the access gate).

**Roadmap placement:** real roadmap item, slotted after RAG Phase 3. Start with
`superpowers:brainstorming` to lock the metaphor vocabulary and slice order before any
code. Feature ships unbranded, as part of Atelier Studio.

## Open questions for the brainstorm

- Is the goal the *streaming* canvas (visual spectacle) or the *iteration loop*
  (draft/proof/next-steps)? The video argues the loop is the substance — Manus doesn't
  actually stream into the canvas.
- Where does publish fit with the access gate + single-user model?
- Does the pinned plan strip come from real plan tool-calls (new tool) or is it derived
  from the existing step stream?
- Vocabulary pass within Atelier Studio (no separate feature brand): Drafts vs.
  Editions; Worklog vs. plainer wording; whether "Proofing" reads clearly or too cute.
