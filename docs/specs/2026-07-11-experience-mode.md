# Spec — Experience Mode (2026-07-11)

## Context

Benchmark: the same prompt ("why is the US the top destination — use images, articles,
videos, make it creative and edgy") given to Manus AI produced a designed scroll-page
web experience (AI-generated hero art, stat callouts, video embeds, cited sources) with
a plan checklist and follow-up suggestions — while Atelier produced a markdown essay.
Manus runs the same Claude models: the gap was orchestration behavior plus three small
platform gaps, not missing machinery. Atelier already had multi-step tools (shipped
earlier today, `627c973`), image generation, web search, and HTML artifacts with live
preview.

## Scope (shipped in this pass)

1. **Experience-mode guidance** (`/api/chat` `TOOL_GUIDANCE`): on a full multimedia ask,
   the model researches (web search) → generates key illustrations (`generate_image`) →
   builds a designed self-contained HTML artifact embedding those images and video
   embeds and cited links → closes with a chat summary. Never a promised-but-missing
   visual. The earlier chat-first rules for prose remain unchanged.
2. **Stable image URLs for artifacts** — `GET /api/files/raw?path=…`: same-origin proxy
   streaming generated images from private Storage (pattern of `/api/artifacts/:id/raw`).
   The `generate_image` tool result now carries `embedUrl` (this proxy form) alongside
   the 24h signed `url`; guidance directs artifacts to use `embedUrl` so pages keep
   their imagery permanently.
   - **Security**: auth-gated by middleware; strict path allow-list
     (`attachments/<chatId>/generated/*` and `images/<projectId|standalone>/*`,
     image extensions only, regex — no traversal, not a general storage proxy);
     `nosniff`; `Cache-Control: private, max-age=31536000, immutable` (uuid names).
   - Single-user app: any authenticated session may read any generated image (accepted).
3. **Video embeds** — CSP `frame-src` additionally allows `https://www.youtube-nocookie.com`
   only (privacy-enhanced player; artifact srcDoc iframes inherit the app CSP). Guidance
   instructs `<iframe src="https://www.youtube-nocookie.com/embed/ID">`.
4. **Follow-up chips** — `POST /api/suggest-followups` (Gemini Flash housekeeping, like
   title/classify: key-guarded, every failure → `{ suggestions: [] }`, never a user
   error) + `useFollowUps` hook (fires on streaming→ready, clears on chat switch/new
   turn) + `FollowUpChips` (brand pill chips above the composer; click fills the input).

## Non-goals / deferred

- **Visible plan checklist** for multi-tool turns (Manus-style step list). The staged
  status labels + inline tool progress cards (motion pass) cover the near-term need;
  a real task-plan UI is its own design.
- Re-signing image URLs inside already-generated artifact HTML (old artifacts created
  before this pass keep whatever URLs they embedded).
- Hosting artifacts at public URLs (the in-app live preview + download covers it).

## Verification

- Unit: `files-raw` allow-list/caching/error tests; `suggest-followups` parse/degrade/400
  tests; image tool `embedUrl` shape; chat-route tests green with `stepCountIs` mock.
- Live smoke: re-run the benchmark prompt — expect research → inline images → an HTML
  artifact opening in the workspace with images visible, video embeds playing
  (youtube-nocookie), sources linked; follow-up chips appear after the reply;
  artifact re-opened the next day still shows its images (proxy URLs).
