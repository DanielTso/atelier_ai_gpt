# Chat log — 2026-11-12 → 2026-11-18: audit remediation, phases A–C

Current state and next steps are in `docs/SESSION_HANDOFF_2026-11-18.md`. This log records how the session ran.

## How the work was run

- **Phases A and B:** one Workflow script per phase (implement → review → fix loop per task, then a cold phase gate).
- **Phase C:** visible Agent-tool dispatches instead, because the VS Code extension does not show workflow agents.
- **Every task:** an implementer subagent, then an independent reviewer, a fix round for any findings, and a scoped re-review. Follow-ups that didn't block were filed under later tasks in the plan rather than dropped.
- **Model routing** followed `docs/MODEL_ROUTING.md`. Three deviations are ledgered in the plan:
  - C3 review moved up to Opus (a ~300-line diff that touches usage).
  - C8 re-review on Opus (a persistence redesign).
  - Tiny fix rounds (C5, C8 round 2) checked inline by the controller.

## Where independent review changed the outcome

- **C1:** the OR-joined keyword search crowded identifier hits (SW-101) out of the result. The fix gives identifier hits up to half the slots.
- **C3:** the new shape check rejected null spreadsheet cells, so edits returned 500 and regenerates returned 422 after spending tokens. The fix makes the check lenient and returns 422 instead of 500.
- **C4:** a stale snapshot claim could overwrite or delete a live revision's Storage objects. The fix is a compare-and-set claim on status plus revision.
- **C6:** the implementer found Sonnet 5 billed at $3/$15 after Anthropic cancelled that increase. The reviewer verified every price row against the live pricing page.
- **C8:** Regenerate deleted the old reply before the model ran, so a provider hiccup lost it. Now the reply is replaced in place at persist time.

## Other session items

- Vercel CLI updated to 65.16.0 and re-authenticated. `AUTH_SECRET`/`APP_ACCESS_PASSWORD` confirmed in Production and Preview. Stale Turso/DashScope env vars removed.
- Learning material for the owner on harness engineering (claude.ai artifact "Harness Field Guide", private).
- 2026-11-18: the branch was pushed to `origin/remediation/2026-11-12-audit` as a backup before a laptop reset. `master` was not pushed, because it auto-deploys and the release needs migrations first.
