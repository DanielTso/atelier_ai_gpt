# Warm Palette + Serif Typography Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme Atelier Studio to the warm-minimal look (paper canvas, terracotta accent, warm dark mode) with a Fraunces serif on display headings — color palette + typography only.

**Architecture:** Pure token + font change. Rewrite the palette in `src/app/globals.css` (semantic token *values* for light + dark; token *names* unchanged so it propagates app-wide). Add Fraunces via `next/font/google` in `layout.tsx`, expose `--font-serif`, and apply `font-serif` to four display headings. No logic, no layout, no radius/shadow-geometry changes.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS v4 (`@theme` in CSS, no JS config), `next/font/google`, React 19.

## Global Constraints

- **Scope is color palette + typography ONLY.** Do not change radius (`--radius` stays `0.625rem`), shadow geometry, spacing, layout, or component structure.
- Do **not** migrate the ~250 hardcoded `bg-white/X` / `border-white/X` / `bg-black/X` overlay utilities — out of scope (documented follow-up). Exception: if one specific surface looks broken during the manual pass, fix that one inline.
- Do **not** remap `--font-sans` / `--font-mono` (the body sans is intentionally left exactly as it renders today). Only **add** `--font-serif`.
- Token names are preserved. Cool swatch names (`--brand-navy`, `--brand-steel-blue`) are repurposed to warm values (grep confirms no `bg-navy`/`bg-steel-blue` component usage).
- This is a **visual** change: there are no unit tests for it. Verification per task = `npm run typecheck` (0 errors) + `npm run lint` (0 errors, ≤27 baseline warnings) + `npm run build` (succeeds), plus a manual `npm run dev` visual pass in **both light and dark** at the end.
- Conventional Commits; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Exact palette values are the contract — see `docs/specs/2026-06-25-warm-palette-typography-design.md`.

---

## File Structure

```
src/app/globals.css   # MODIFY — :root swatches+semantic (light), .dark (dark), @theme (+--font-serif), glass-panel shadow rgba
src/app/layout.tsx    # MODIFY — add Fraunces next/font + its variable on <body>
src/components/chat/HomeGreeting.tsx        # MODIFY — font-serif on the hero h1
src/components/chat/ArtifactsView.tsx       # MODIFY — font-serif on the "Artifacts" h2
src/components/chat/ProjectsView.tsx        # MODIFY — font-serif on the "Projects" h2
src/components/chat/ProjectLandingPage.tsx  # MODIFY — font-serif on the project-name h1
CLAUDE.md             # MODIFY — Styling section to the new warm palette
CHANGELOG.md, package.json  # MODIFY — version + entry
```

---

### Task 1: Warm palette (globals.css tokens)

**Files:**
- Modify: `src/app/globals.css` (the `:root` block lines ~13-60, the `.dark` block lines ~62-87, the `.glass-panel` shadow lines ~142-145)

**Interfaces:**
- Produces: the semantic tokens (`--background`, `--foreground`, `--card`, `--primary`, `--border`, `--ring`, etc.) now resolve to the warm palette in both modes. Token names unchanged — all consumers (semantic Tailwind utilities) re-theme automatically.

- [ ] **Step 1: Replace the `:root` block** (raw swatches + light semantic tokens). Replace the existing `:root { … }` (from `/* Brand palette — raw swatches */` through the closing `}` that contains `--surface-divider`) with:

```css
:root {
  /* Brand palette — warm swatches. Names preserved; the two cool names are
     repurposed to warm values (no component uses *-navy / *-steel-blue directly). */
  --brand-navy: #6B4A38;            /* deep warm clay (accent-foreground) */
  --brand-steel-blue: #C96442;      /* terracotta — accent / primary (light) */
  --brand-ink: #20201E;             /* warm near-black text */
  --brand-canvas-light: #FAF9F6;    /* warm paper canvas */
  --brand-pure-surface: #FFFFFF;
  --brand-warm-sand: #E0D6C5;       /* warm sand (prose blockquote rule) */
  --brand-stone-sage: #94977F;      /* warm sage */
  --brand-soft-mist: #F2EFE9;       /* warm soft surface */
  --brand-muted-line: #E8E6DF;      /* warm low-contrast border */
  --brand-slate-text: #78776E;      /* warm gray (muted text) */
  --brand-success: #4F7A4A;
  --brand-warning: #A06D2E;
  --brand-terracotta-light: #D98A6A; /* lifted terracotta for dark-mode accent */

  /* Semantic tokens — Light mode (primary experience) */
  --background: var(--brand-canvas-light);
  --foreground: var(--brand-ink);
  --card: var(--brand-pure-surface);
  --card-foreground: var(--brand-ink);
  --popover: var(--brand-pure-surface);
  --popover-foreground: var(--brand-ink);
  --primary: var(--brand-steel-blue);
  --primary-foreground: var(--brand-pure-surface);
  --secondary: var(--brand-soft-mist);
  --secondary-foreground: var(--brand-ink);
  --muted: var(--brand-soft-mist);
  --muted-foreground: var(--brand-slate-text);
  --accent: var(--brand-soft-mist);
  --accent-foreground: var(--brand-navy);
  --destructive: #B04D48;
  --destructive-foreground: var(--brand-pure-surface);
  --border: var(--brand-muted-line);
  --input: var(--brand-muted-line);
  --ring: var(--brand-steel-blue);
  --radius: 0.625rem;

  /* Layout structure dimensions — UNCHANGED. */
  --sidebar-width: 18rem;
  --rail-width: 20rem;
  --thread-max-width: 48rem;
  --artifact-panel-width: 28rem;

  /* Layered surfaces */
  --surface-raised: var(--brand-pure-surface);
  --surface-sunken: var(--brand-soft-mist);
  --surface-divider: var(--brand-muted-line);
}
```

- [ ] **Step 2: Replace the `.dark` block** (warm near-black). Replace the existing `.dark { … }` with:

```css
.dark {
  /* Dark mode — re-themed warm. Light is still primary. */
  --background: #1A1815;
  --foreground: #ECEAE3;
  --card: #26231D;
  --card-foreground: #ECEAE3;
  --popover: #26231D;
  --popover-foreground: #ECEAE3;
  --primary: var(--brand-terracotta-light);
  --primary-foreground: #211712;
  --secondary: #2E2A22;
  --secondary-foreground: #ECEAE3;
  --muted: #2E2A22;
  --muted-foreground: #9A968B;
  --accent: #322E26;
  --accent-foreground: #ECEAE3;
  --destructive: #C56A5C;
  --destructive-foreground: #211712;
  --border: #322E26;
  --input: #322E26;
  --ring: var(--brand-terracotta-light);

  --surface-raised: #26231D;
  --surface-sunken: #1A1815;
  --surface-divider: #322E26;
}
```

- [ ] **Step 3: Warm the `.glass-panel` shadow rgba** (palette consistency — same opacities, warm ink instead of cool). Replace:

```css
.glass-panel {
  background-color: var(--surface-raised);
  border: 1px solid var(--surface-divider);
  box-shadow:
    0 1px 2px rgba(22, 32, 42, 0.04),
    0 8px 24px rgba(22, 32, 42, 0.06);
}
```
with:
```css
.glass-panel {
  background-color: var(--surface-raised);
  border: 1px solid var(--surface-divider);
  box-shadow:
    0 1px 2px rgba(32, 32, 30, 0.04),
    0 8px 24px rgba(32, 32, 30, 0.06);
}
```

- [ ] **Step 4: Verify the gate**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: typecheck 0 errors; lint 0 errors (≤27 warnings); build succeeds. (CSS changes won't break these; this confirms no syntax error in `globals.css`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "style(theme): warm paper/terracotta palette for light + dark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Serif display typography (Fraunces)

**Files:**
- Modify: `src/app/layout.tsx` (add Fraunces import + variable, lines ~2 and ~7-15 and the `<body>` className ~29-31)
- Modify: `src/app/globals.css` (`@theme inline` block — add `--font-serif`, near line 123)
- Modify: `src/components/chat/HomeGreeting.tsx:12`, `src/components/chat/ArtifactsView.tsx:73`, `src/components/chat/ProjectsView.tsx:73`, `src/components/chat/ProjectLandingPage.tsx:49`

**Interfaces:**
- Consumes: nothing from Task 1 (independent; palette + type don't depend on each other).
- Produces: the Tailwind `font-serif` utility resolves to Fraunces; applied to the four display headings.

- [ ] **Step 1: Add Fraunces in `layout.tsx`**. Change the import line:

```tsx
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
```
Add the font instance after `geistMono`:
```tsx
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});
```
Add `fraunces.variable` to the `<body>` className (keep the others):
```tsx
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased min-h-screen`}
      >
```

- [ ] **Step 2: Expose `--font-serif` in `globals.css`**. In the `@theme inline { … }` block, just before the `--radius-lg` line, add:

```css
  --font-serif: var(--font-fraunces), ui-serif, Georgia, "Times New Roman", serif;
```

- [ ] **Step 3: Apply `font-serif` to the four display headings.**

`src/components/chat/HomeGreeting.tsx:12` — change:
```tsx
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">{text}</h1>
```
to:
```tsx
        <h1 className="text-3xl font-serif font-medium text-foreground tracking-tight">{text}</h1>
```

`src/components/chat/ArtifactsView.tsx:73` — change `<h2 className="text-2xl font-semibold text-foreground">Artifacts</h2>` to:
```tsx
          <h2 className="text-2xl font-serif font-medium text-foreground">Artifacts</h2>
```

`src/components/chat/ProjectsView.tsx:73` — change `<h2 className="text-2xl font-semibold text-foreground">Projects</h2>` to:
```tsx
        <h2 className="text-2xl font-serif font-medium text-foreground">Projects</h2>
```

`src/components/chat/ProjectLandingPage.tsx:49` — change `<h1 className="text-xl font-semibold text-foreground">{project.name}</h1>` to:
```tsx
        <h1 className="text-xl font-serif font-medium text-foreground">{project.name}</h1>
```

(Rationale: serif reads more elegant at `font-medium` than `font-semibold`; weight can be tuned in the manual pass.)

- [ ] **Step 4: Verify the gate**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: typecheck 0 errors; lint 0 errors (≤27 warnings); build succeeds (Fraunces is fetched by `next/font` at build — confirms the import is valid).

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css src/components/chat/HomeGreeting.tsx src/components/chat/ArtifactsView.tsx src/components/chat/ProjectsView.tsx src/components/chat/ProjectLandingPage.tsx
git commit -m "style(theme): Fraunces serif on display headings (Geist body unchanged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Manual visual pass, docs, changelog, tag

**Files:**
- Modify: `CLAUDE.md` (the "Styling" section), `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Manual visual review** (the real verification). Run `npm run dev`, open the app, and check in **both light and dark** (toggle theme):
  - Canvas/cards/text/borders read warm and cohesive; terracotta appears on primary buttons, active states, focus rings.
  - Fraunces renders on the home greeting, the **Artifacts** and **Projects** titles, and a project's name — and **nowhere else** (body/messages/buttons stay sans).
  - Nothing became illegible in either mode (check muted text on cards, primary-foreground on terracotta buttons, the artifacts gallery, chat bubbles, sidebar, dialogs, project rail).
  - If a single surface looks broken (e.g. an invisible `border-white/10`), fix that one inline; do not sweep all overlays.
  - Tune the hero serif weight (400–600) if it looks too heavy/light.

  Note any inline fixes made and `git add`/commit them with the docs in Step 4.

- [ ] **Step 2: Update `CLAUDE.md` "Styling" section** to describe the new palette: warm paper canvas, terracotta primary/accent, warm-charcoal dark mode, the warm swatch values, and "Fraunces serif on display headings; Geist Sans body / Geist Mono code." Replace the steel-blue/navy/sand swatch list and the "Light-first … Steel Blue accents" wording with the warm equivalents. Keep the "forbidden patterns" note (still valid).

- [ ] **Step 3: Bump `package.json` version** to `4.30.0` and prepend a `CHANGELOG.md` entry summarizing the re-theme (warm palette light+dark, Fraunces serif headings, token-driven; overlays/radius left as-is) with the gate result.

- [ ] **Step 4: Final gate + commit + tag**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: all green; `npm test` still **366 pass** (no logic touched).
```bash
git add CLAUDE.md CHANGELOG.md package.json src/
git commit -m "docs(theme): document warm palette + serif; changelog (v4.30.0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git tag -a v4.30.0 -m "v4.30.0 — warm palette + serif typography re-theme"
```
(Push/deploy is a separate, user-gated step.)

---

## Self-Review

**Spec coverage:**
- Color palette light+dark (globals.css swatches + semantic + dark) → Task 1. ✓
- `glass-panel` warm shadow + destructive/success/warning warm values → Task 1 (success/warning in swatches, destructive in semantic). ✓
- Fraunces via next/font + `--font-serif` + serif on display surfaces → Task 2. ✓
- Body/code stay sans/mono (only `font-serif` added; `--font-sans` untouched) → Task 2 + Global Constraints. ✓
- Direct brand utilities keep working (names preserved, warm values) → Task 1. ✓
- Overlays/radius/layout out of scope → Global Constraints. ✓
- CLAUDE.md styling doc update → Task 3. ✓
- Verification = gate + manual light/dark pass → each task + Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact before/after. The only non-code step (manual visual review) is inherent to a visual change and is concretely enumerated.

**Type/value consistency:** Hex values match the spec contract exactly (light `#FAF9F6`/`#20201E`/`#C96442`/`#E8E6DF`; dark `#1A1815`/`#ECEAE3`/`#D98A6A`/`#322E26`). `--font-serif` defined in Task 2 Step 2 matches the `font-serif` utility used in Step 3. `--brand-terracotta-light` defined in Task 1 is referenced by `.dark --primary`/`--ring` in the same task.

## Risks
- **Contrast:** warm grays / coral buttons — verified in the Task 3 manual pass; nudge a value if a surface fails legibility.
- **Leftover white/black overlays** read fainter on warm canvas — pre-existing, out of scope, fix-one-if-broken only.
- **Serif weight** at hero size — tunable in the manual pass.
