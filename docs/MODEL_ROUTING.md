# Model Routing

How agent work in this repo is assigned to Claude models. The rule is **stakes × work shape**, not "strongest everywhere": Fable is spent only where a wrong decision is expensive to unwind, Opus carries judgment and planning, Sonnet carries mechanical execution. Every subagent dispatch names its model explicitly — an omitted `model:` silently inherits the session's model, which is usually the most expensive one.

Applies to: Agent-tool dispatches, subagent-driven plan execution (`superpowers:subagent-driven-development`), parallel audits, and any `.claude/agents/*.md` definitions added later. The controller session itself runs whatever `/model` is set to; set it by the session's job, not by habit (see "Controller" below).

## Routing table

| Role / work shape | Model | Why |
|---|---|---|
| **Controller / orchestrator** (dispatches, ledgers, adjudicates) | Opus by default; Fable only when the session *is* the critical-path reviewer (an audit, a release sign-off) | Orchestration is bookkeeping and judgment calls, not heavy reasoning; a Fable controller burns the top tier on turn overhead |
| **Brainstorming, spec and plan authoring** | Opus | Planning quality matters, but plans are reviewed before execution |
| **Implementer — transcription** (the brief carries the complete code; 1–3 files; tests already written in the brief) | Sonnet (Haiku for a single-file constant/string edit) | Typing plus running tests; turn count, not token price, is the cost |
| **Implementer — integration / judgment** (multi-file, streaming or concurrency, auth, error handling, matching existing patterns from prose) | Opus | Needs to read around the change and make small design calls |
| **Implementer — architecture / schema design from prose** (new tables, migrations designed rather than transcribed, provider routing, context-pipeline changes) | Fable | Wrong here mis-prices history, leaks data, or breaks every table's queries |
| **Task reviewer — small mechanical diff** (≤ ~150 lines, tests included, no shared state) | Sonnet | The diff is the whole story |
| **Task reviewer — multi-file / concurrency / auth / schema / cost-ledger diff** | Opus | Has to reason about call sites and failure modes the diff doesn't show |
| **Scoped re-review of a fix round** | Sonnet | Verdicts a short findings list against a small fix diff |
| **Final whole-branch review** | Fable | The one gate before a push; the SDD skill mandates the most capable model |
| **Read-only audit lane** (broad sweep of a subsystem, must verify by running things) | Opus | Breadth plus verification discipline; Sonnet for a narrow, well-specified check |
| **Docs / CHANGELOG / handoff** | Sonnet (Opus when the doc has to argue a decision) | Mostly synthesis of known facts |
| **Fix-loop escalation** (rounds 4–5 of a stuck task) | One tier above the stuck implementer | Fresh eyes plus capability, per the SDD skill |

## Rules

1. **Name the model on every dispatch.** `model: "sonnet" | "opus" | "fable" | "haiku"` — never omit it.
2. **Tag plan tasks with a tier**, and read the tag as *domain stakes*; the dispatch model still follows the *work shape* row above. A schema task whose brief contains the full SQL and tests is transcription (Sonnet); a schema task that says "design the indexes" is architecture (Fable).
3. **Fable is not the default for anything routine.** If a dispatch prompt is about to say `fable` for work that has a complete brief, downgrade it.
4. **Reviews scale with risk, not with the implementer.** A Sonnet implementer's diff on the cost ledger still gets an Opus review.
5. **Record deviations.** When a task is routed differently from its plan tag, ledger it (`Ruling: …`) so the human sees the call.

## Session-start checklist for the human

- Orchestrating a plan or a routine session → `/model claude-opus-5`.
- Running an audit, a security review, or signing off a release → `/model claude-fable-5-1`.
- Either way the subagents route per the table; the controller's model only affects the controller.

## References

- `superpowers:subagent-driven-development` → "Model Selection" (the process this table specializes).
- Memory: `feedback_model_tiering_by_criticality` (the original tiering note, 2026-07-06) and `feedback_role_based_agent_stack`.
- Example of a routed run: `docs/plans/2026-09-11-audit-remediation.md` (tier tags per task) and its ledger.
