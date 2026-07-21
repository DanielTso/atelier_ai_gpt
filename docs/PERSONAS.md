# Personas — what they are and how to use them

A **persona** is a saved combination of three things: a **system prompt** (how the assistant behaves), a **model** (which Claude variant answers), and an **effort level** (how much thinking the model spends). Picking a persona is the fastest way to get the right kind of answer at the right cost — a claims analysis and a quick lookup should not run on the same settings.

Personas live in the composer's persona picker (the chip next to the model selector). The roster below ships built-in; you can add your own (see [Custom personas](#custom-personas)).

## The roster

### Everyday

| Persona | Model / effort | Use it for |
|---|---|---|
| 💬 **General Assistant** *(default)* | Sonnet 5 / medium | Everyday questions, drafting, quick research. The sensible default when nothing below fits. |
| ⚡ **Brief** | Haiku 4.5 | One-liner answers, quick lookups, "just tell me X". Cheapest and fastest — no reasoning overhead. |
| 📚 **Teacher** | Sonnet 5 / medium | Patient explanations when you're learning something — walks through concepts step by step. |
| 🎭 **Creative Writing** | Sonnet 5 / medium | Stories, copy, tone-sensitive writing. |

### Engineering

| Persona | Model / effort | Use it for |
|---|---|---|
| 👨‍💻 **Coding** | Opus 4.8 / high | Writing production-quality code. |
| 🔎 **Code Review** | Opus 4.8 / high | Reviewing a diff or file for bugs, security, and style. |
| 🧠 **Deep Analysis** | Opus 4.8 / max | Hard multi-step problems where you want maximum reasoning on Opus. |

### Construction suite

| Persona | Model / effort | Use it for |
|---|---|---|
| 🏗️ **Construction Pro** | Opus 4.8 / high | Day-to-day superintendent/PM work: RFIs, submittals, schedule questions, meeting-minute drafts. |
| 📐 **Plan & Spec Reader** | Sonnet 5 / medium | Structured extraction from drawings and specs — "what does note 7 on SW-101 say", sheet lookups, spec-section pulls. Cheap enough for follow-up volleys. |
| ⚖️ **Claims & Delay Analyst** | **Fable 5 / max** | Delay and time-impact analysis, causation chains, entitlement arguments. The heavyweight — use when the answer may end up in a claim. |
| 📜 **Contract & Spec Analyst** | **Fable 5 / max** | Interpreting contract obligations, finding conflicts between documents, deadline/notice provisions. |
| 🗂️ **Contract Abstract** | **Fable 5 / max** | One job only: produce a locked 22-field contract abstract as an XLSX (`Field \| Value \| Source Ref`). Extraction-only — every field is cited from your documents or marked `Not found in provided documents`. See [the Contract Abstract workflow](#the-contract-abstract-workflow). |
| 🧩 **Constructability Reviewer** | Fable 5 / high | Pre-construction review: clashes, sequencing problems, VE opportunities before the field finds them. |
| 🧠 **Deep Reasoner** | Fable 5 / high | The flagship generalist for hard, high-stakes problems that aren't construction-specific. |

## How selection works

**Per message/chat:** open the persona picker in the composer and choose. The persona sets the system prompt for the chat, pre-selects its model, and sets the effort pill. **Your explicit picks always win** — if you choose a persona and then change the model or effort manually, your choice sticks (a project default loading late will never silently revert it).

**Per project:** every project can set a **default persona and model** (project header ⋮ → Project settings, or the Projects view). New chats in that project start with those defaults — e.g. a claims project that always opens on Claims & Delay Analyst. The composer picker still overrides per chat.

**Effort pill:** effort (`low → max`) controls Claude's adaptive-thinking budget. It follows the persona but is independently adjustable in the composer. Note: Haiku doesn't accept an effort setting (the Brief persona simply runs fast).

## The cost model — "expensive analyst, cheap secretary"

Model tiers differ roughly 10× in cost per step: **Fable 5** (~2× Opus, deepest reasoning) → **Opus 4.8** → **Sonnet 5** → **Haiku 4.5**. The pattern that works:

1. Run the *hard pass* on the heavyweight persona (Claims & Delay Analyst on Fable/max).
2. Switch to a cheap persona (Plan & Spec Reader on Sonnet, or Brief) for follow-ups, re-phrasings, and "pull that into a table" requests — derivative work doesn't need the analyst.
3. Save the heavyweight for a final review pass if needed.

## The Contract Abstract workflow

1. Create/open a project and upload the contract (Files rail or the Documents dialog). Wait for the **ready** badge. *Tip: for a single contract, attaching the file directly to your message also works — inline attachment puts the full text in context, which can beat retrieval for one-document jobs.*
2. Pick **🗂️ Contract Abstract** in the composer.
3. Ask for the abstract. The persona extracts the locked 22-field schema — parties, dates, sums, retainage, notice periods, LDs, and so on — each with a source reference, and produces a downloadable XLSX plus a chat risk summary.
4. Fields the documents genuinely don't contain come back as `Not found in provided documents` — that's by design; it never guesses.

The field list is fixed in code (`CONTRACT_ABSTRACT_FIELDS` in `src/hooks/usePersonas.ts`) so every abstract is comparable. To change the schema, edit it there — only there.

## Custom personas

Settings → **Model Defaults** tab → add a persona: name, icon, prompt, model, effort. Custom personas appear in the picker alongside built-ins and can be set as project defaults. They're stored locally in your browser (`localStorage`), not in the database — so they're per-device for now.

## How personas interact with project documents

Any persona can use project documents: retrieval feeds relevant chunks automatically, and Claude can read whole documents with the `read_document` tool when a question is exhaustive ("list every storm sheet"). The construction-suite personas are prompted to lean on documents harder and cite what they use.

**Grounded mode (built 2026-07-21, ships with v4.53.0):** the **Grounded** pill in the composer (project chats) restricts answers to your project documents — gaps come back as `Not found in project documents` instead of general-knowledge guesses, and document-derived claims carry **clickable citation chips** that open the source at the cited PDF page (or the cited passage for text-extracted docs). Contract Abstract, Contract & Spec Analyst, and Plan & Spec Reader default to grounded-on; your toggle always wins, and opening an existing chat starts ungrounded. Custom personas get a "Grounded answers" toggle in the editor. You can also scope which documents may answer via the checkboxes in the project Files rail ("N of M sources active" — per project). Design: `docs/specs/2026-07-17-grounded-cited-answers-design.md`.

## Under the hood (for maintainers)

Roster + prompts: `src/hooks/usePersonas.ts`. Effort flows persona → composer pill → chat request → `createProvider(model, effort)` (`src/lib/providers.ts`, adaptive thinking; effort omitted for Haiku). Per-project defaults: `ProjectDefaultsDialog` → `getProjectDefaults`. Usage stats per persona/project: `personaUsage` table. Precedence guard (user pick wins over late-loading defaults): `composePersonaPickedRef` in `page.tsx`.
