# Persona System v2 — Unified Personas + Effort — Design

**Status:** Approved design (2026-06-19). Branch: `feat/persona-system-v2` (off `master`). Restyle/feature work on the live app (post v4.7.0).

---

## Goal

Collapse the confusing two-tier persona model (behavior-only "Personas" + "Model + Persona" combos) into **one unified persona list** where every persona carries a **prompt + model + reasoning effort**. Deduplicate the roster, add two construction-domain personas, make **General Assistant (Sonnet 4.6 · Medium effort) the default**, and wire **adaptive thinking + effort** into the Claude chat path (with a manual effort override in the composer — the "thinking/effort toggle" the user asked for).

This also corrects a stale codebase assumption: `@ai-sdk/anthropic` (AI SDK v6) **does** support `providerOptions.anthropic.thinking: { type: 'adaptive' }` and `effort: 'low'|'medium'|'high'|'max'`. The old "no thinking config" note in `providers.ts`/CLAUDE.md is obsolete.

## Non-goals (YAGNI)

- **No DB migration.** Personas live in code (custom in localStorage); chats match personas by prompt text. Removing personas is safe — unmatched old prompts render as "Custom".
- **No per-chat effort persistence in the DB.** Effort is UI state (like the selected model), defaulting to the active persona's effort.
- **Image (Nano Banana) path unchanged.** Effort/thinking don't apply to image generation; the Gemini branch is untouched.
- **No `xhigh` effort.** The AI SDK's typed enum exposes `low|medium|high|max`; we use those four.

## Current state (what this builds on)

- **`src/hooks/usePersonas.ts`** — `Persona` interface with `isCombo?`/`preferredModel?`; two arrays `DEFAULT_PERSONAS` (Default, Coding Assistant, Creative Mode, Debug Mode, Brief Mode, Teacher Mode) and `COMBO_PRESETS` (Code Review, Creative Writing, Quick Code Help, Deep Analysis, General Assistant). `modelShortLabel()` helper. Custom personas in `useLocalStorage('custom-personas')`.
- **`src/components/ui/PersonaSelector.tsx`** — splits `regularPersonas` vs `comboPresets` into two sections; combo selection auto-switches the model.
- **`src/components/ui/ProjectDefaultsDialog.tsx`** — per-project default persona; shows model label for combos.
- **`src/lib/providers.ts`** — `createProvider(modelName)` → `{ model, tools?, providerOptions? }`. Claude branch sets web_search, **no** thinking/effort.
- **`src/app/api/chat/route.ts`** — calls `createProvider(modelName)`; `streamText({ … , ...(providerOptions && { providerOptions }) })` already spreads provider options.
- **`src/lib/validation.ts`** — `chatRequestSchema = { messages, model?, chatId? }`.
- **`src/app/page.tsx`** — `transport` body `() => ({ model: selectedModelRef.current, chatId: … })`; `selectedModel` state + ref; persona selection handled via `usePersonas` + `handleSaveSystemPrompt`.

## Locked decisions

- **One flat `PERSONAS` array.** Drop `isCombo`; `model` becomes a required field on every persona; add `effort?: 'low'|'medium'|'high'|'max'` (omitted for Haiku-backed personas).
- **Default = `general-assistant`** (Sonnet 4.6, Medium). Replaces the old empty `default` persona. The `'default'` id and any unknown id resolve to General Assistant.
- **Default model for fresh chats follows the default persona's model** → Sonnet 4.6 (was Opus 4.8). `/api/chat` hard fallback stays `claude-opus-4-8`.
- **Effort wiring:** Claude requests send `providerOptions.anthropic = { thinking: { type: 'adaptive' }, effort }`. **Effort is omitted for `claude-haiku-*`** (the API 400s on Haiku). Gemini untouched.
- **Manual effort override** in the composer: a small selector (Low/Med/High/Max) that defaults to the active persona's effort and can be overridden; held as UI state (`selectedEffort` + ref), sent in the chat request body.
- **Effort `'max'` from a persona on Haiku** is impossible (Brief has no effort); guard belongs in `createProvider` regardless.

## The unified roster

| id | name | icon | model | effort | prompt source |
|---|---|---|---|---|---|
| `general-assistant` ⭐default | General Assistant | 💬 | `claude-sonnet-4-6` | medium | existing combo-general-assistant |
| `coding` | Coding | 👨‍💻 | `claude-opus-4-8` | high | existing Coding Assistant (merged) |
| `code-review` | Code Review | 🔎 | `claude-opus-4-8` | high | existing combo-code-review |
| `deep-analysis` | Deep Analysis | 🧠 | `claude-opus-4-8` | max | existing combo-deep-analysis |
| `creative-writing` | Creative Writing | 🎭 | `claude-sonnet-4-6` | medium | existing combo-creative |
| `brief` | Brief | ⚡ | `claude-haiku-4-5` | — | existing brief-mode |
| `teacher` | Teacher | 📚 | `claude-sonnet-4-6` | medium | existing teacher |
| `construction-pro` 🆕 | Construction Pro | 🏗️ | `claude-opus-4-8` | high | new (below) |
| `plan-spec-reader` 🆕 | Plan & Spec Reader | 📐 | `claude-sonnet-4-6` | medium | new (below) |

**Dropped:** `default` (→ general-assistant), `debug-mode` (folds into Coding/Deep Analysis), `quick-code-help` (folds into Coding), and the duplicate `creative-writer`/`coding-assistant` regulars.

### New persona prompts

**Construction Pro** (`construction-pro`):
```
<identity>
You are a senior construction project assistant supporting a Project Superintendent in the field. You know construction sequencing, submittals, RFIs, schedules, OAC meetings, daily reports, and reading plans and specifications.
</identity>

<constraints>
- Be concise and jobsite-practical; lead with the answer or the action.
- When documents are available, cite the sheet number or spec section (e.g. "A-101", "Section 03 30 00").
- For RFIs, submittals, and schedules, use the standard fields and structure of those documents.
- Flag missing information rather than guessing; never invent dimensions, dates, or spec values.
- Use clear tables for schedules, look-aheads, and submittal logs.
</constraints>

<formatting>
- Short paragraphs and bullet lists.
- Tables for schedules / logs / comparisons.
- Bold the key number, date, or decision.
</formatting>
```

**Plan & Spec Reader** (`plan-spec-reader`):
```
<identity>
You extract and structure information from construction drawings and specifications. You turn dense sheets into clean, usable tables and summaries.
</identity>

<constraints>
- Transcribe verbatim — sheet numbers, titles, room names/numbers, dimensions, callouts, schedule rows. Do not invent content.
- Preserve table and schedule structure as Markdown tables.
- When a value is illegible or absent, say so explicitly rather than guessing.
- Cite the sheet/section the information came from.
</constraints>

<formatting>
- Markdown tables for schedules and indexes.
- A short plain-language summary of what the sheet depicts after the structured data.
</formatting>
```
(General Assistant, Coding, Code Review, Deep Analysis, Creative Writing, Brief, Teacher reuse the existing prompt strings verbatim from `usePersonas.ts`.)

## Architecture

### `src/hooks/usePersonas.ts`
- `Persona`: `{ id, name, icon, prompt, model: string, effort?: Effort, isDefault?, description? }`; `type Effort = 'low'|'medium'|'high'|'max'`.
- Single `PERSONAS: Persona[]` (the roster above). `general-assistant` has `isDefault: true`.
- `usePersonas()` returns `{ personas, defaultPersona, customPersonas, addPersona, updatePersona, deletePersona, getPersonaById, getPersonaByPrompt }`. Drop `defaultPersonas`/`comboPresets`.
- `getPersonaById(id)` → persona, falling back to `general-assistant` for `'default'`/unknown.
- `getPersonaByPrompt(prompt)` → matching persona, else `general-assistant` for empty prompt, else a synthetic "Custom".
- Keep `modelShortLabel`.

### `src/components/ui/PersonaSelector.tsx`
- Render **one flat list** of `personas` (no section split). Each row: icon + name + a `model · effort` chip (e.g. "Sonnet 4.6 · Medium"; Brief shows just "Haiku 4.5"). On select: apply prompt **and** set model **and** set effort (extend the existing model auto-switch callback to also pass effort).

### Effort plumbing
- **`src/lib/validation.ts`** — `chatRequestSchema` gains `effort: z.enum(['low','medium','high','max']).optional()`.
- **`src/lib/providers.ts`** — `createProvider(modelName, effort?: Effort)`. Claude branch returns `providerOptions: { anthropic: { thinking: { type: 'adaptive' }, ...(effort && !modelName.startsWith('claude-haiku') ? { effort } : {}) } }` alongside `tools`. (Gemini branches unchanged.)
- **`src/app/api/chat/route.ts`** — read `effort` from the parsed body; `createProvider(modelName, effort)`. No other change (providerOptions already spread into `streamText`).
- **`src/app/page.tsx`** — new `selectedEffort` state + `selectedEffortRef`; transport body adds `effort: selectedEffortRef.current`. Selecting a persona sets `selectedModel` + `selectedEffort` from the persona. Default init: `general-assistant` → `selectedModel = claude-sonnet-4-6`, `selectedEffort = 'medium'`.
- **`src/components/chat/ChatInputArea.tsx`** — an **effort pill** next to the model selector (Low/Med/High/Max). Bound to `selectedEffort`/`onEffortChange`; hidden or disabled when the selected model is Haiku or an image model (no effort there). Shows the current value; overriding it sets `selectedEffort` without changing the persona.

### Default-model alignment
- Wherever the initial `selectedModel` is derived (page.tsx init / `useSmartDefaults`), seed it from the **default persona's model** (Sonnet 4.6) rather than "first model in list" (Opus). Verify project defaults and the model picker still function.

## File layout (touched)
```
src/hooks/usePersonas.ts                 # unified roster + effort + interface
src/components/ui/PersonaSelector.tsx    # flat list + model·effort chip; set effort on select
src/components/ui/ProjectDefaultsDialog.tsx  # show model·effort chip (no isCombo)
src/lib/providers.ts                     # createProvider(modelName, effort) → anthropic thinking+effort (Haiku guard)
src/lib/validation.ts                    # chatRequestSchema.effort enum
src/app/api/chat/route.ts                # pass effort to createProvider
src/app/page.tsx                         # selectedEffort state/ref; transport body; persona→model+effort; default seed
src/components/chat/ChatInputArea.tsx    # effort pill (override), hidden for Haiku/image
src/hooks/useSmartDefaults.ts            # default model from default persona (if it sources the default)
```

## Testing
- **Unit (usePersonas):** roster has 9 personas; `general-assistant` is default + `claude-sonnet-4-6`/`medium`; `getPersonaById('default')` and unknown → general-assistant; Brief has no effort.
- **Unit (providers):** `createProvider('claude-opus-4-8','high')` → `providerOptions.anthropic.thinking.type==='adaptive'` and `effort==='high'`; `createProvider('claude-haiku-4-5','high')` → **no `effort`** but thinking present; Gemini unchanged.
- **Unit (chat route):** request with `effort` passes it through; mocked `createAnthropic` asserts providerOptions reach `streamText` (extend existing chat-route test mocks).
- **Component (PersonaSelector):** renders a flat list (no "Model + Persona" header), each row shows a model·effort chip; selecting calls back with prompt+model+effort.
- **Component (ChatInputArea effort pill):** renders for Sonnet/Opus, hidden for Haiku/image; clicking a level fires `onEffortChange`.
- All existing tests stay green; lint 0 errors, build clean.

## Verification gate
`npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`. Manual smoke: default chat opens on General Assistant/Sonnet/Medium; switching persona swaps model+effort+chip; effort pill overrides; a Claude turn streams (adaptive thinking active); Brief on Haiku sends no effort (no 400).

## Risks / mitigations
- **Haiku + effort 400** → guarded in `createProvider`; covered by a unit test.
- **Old chats referencing removed personas** → resolve to General Assistant / "Custom"; no crash, no data loss.
- **Default-model regression** (picker/project defaults assume Opus-first) → verify in the plan; adjust the single derivation point.
- **AI SDK enum** lacks `xhigh` → use `low|medium|high|max` only.

## Definition of done
One flat persona list with model+effort each; General Assistant (Sonnet 4.6 · Medium) is the default; selecting a persona sets behavior+model+effort; a composer effort pill overrides; Claude requests carry adaptive thinking + effort (Haiku exempt); two construction personas added; gate green; CLAUDE.md/providers note corrected.
