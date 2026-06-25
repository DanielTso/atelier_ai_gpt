# Warm Palette + Serif Typography Re-theme — Design Spec

_Date: 2026-06-25. Status: approved (direction + picks confirmed by user; reference = Manus/Claude "warm minimal" look)._

## Goal

Re-theme Atelier Studio from the cool "executive" steel-blue/navy/sand brand to a **warm, minimal palette with a serif display face** — the look the user referenced (Manus / Claude.ai): paper-white canvas, near-monochrome warm charcoal text, a single **terracotta** accent, soft low-contrast warm borders, and an elegant **serif headline** over the existing clean sans body.

**Explicitly limited to two things from the reference: color palette and typography.** No layout, spacing, radius, shadow geometry, or component-structure changes.

## Scope

In:
1. **Color palette** — replace the raw brand swatches + semantic token values for **both light and dark** modes in `src/app/globals.css`. Semantic token *names* are unchanged, so the new palette propagates app-wide automatically.
2. **Typography** — add **Fraunces** (variable serif) via `next/font/google` in `src/app/layout.tsx`, expose it as `--font-serif`, and apply `font-serif` to the **display surfaces only**: the home hero greeting and the top-level view titles. Body/UI stays **Geist Sans**; code stays **Geist Mono**.
3. Harmonize the few palette-coupled values: `glass-panel` shadow rgba (uses the old cool ink), `destructive`/`success`/`warning` to sit in the warm family, and the ≤6 direct brand-utility usages.
4. Update the brand documentation (`CLAUDE.md` "Styling" section) to the new palette so the locked-brand description stays truthful.

Out (non-goals):
- **The ~250 hardcoded `bg-white/X` / `border-white/X` / `bg-black/X` opacity overlays.** These are a pre-existing brand-cleanup item (CLAUDE.md already lists them as forbidden), theme-neutral, and outside palette+typography. Left as a documented follow-up; not made worse by this change.
- Radius (`--radius` stays `0.625rem`), shadow geometry, spacing, density, layout, component structure.
- Changing the **body** font (Geist Sans stays). Only the display/headline gets the serif.
- New components, new tokens beyond `--font-serif`, dark-mode behavior changes.

## Locked decisions

- **Accent:** terracotta `#C96442` (light) / lifted `#D98A6A` (dark).
- **Serif:** **Fraunces** (variable, `next/font/google`), applied to headlines only.
- **Light-first** stays; dark mode is re-themed warm (not cool).
- Token **names** are preserved (no component churn for semantic users). Unused cool swatch names (`navy`, `steel-blue`) are repurposed/renamed to warm names; the 6 used direct utilities (`text-success`×3, `text-stone-sage`, `text-ink`, `bg-warm-sand`) keep their names with warm values.

## Palette (the contract)

### Raw warm swatches — KEEP existing `--brand-*` variable names, change values only
(Preserving names avoids churn: the `.prose` blockquote references `--brand-warm-sand`, and the `@theme` direct utilities map these names. Cool names are simply repurposed to warm values.)
```
--brand-canvas-light: #FAF9F6   /* warm paper canvas (light bg) */
--brand-pure-surface: #FFFFFF   /* pure card */
--brand-ink:          #20201E   /* warm near-black text */
--brand-steel-blue:   #C96442   /* REPURPOSED -> terracotta accent/primary (light). It is
                                   the source of --primary/--ring; no component uses
                                   `*-steel-blue` directly (grep = 0), so the value swap is safe. */
--brand-navy:         #6B4A38   /* REPURPOSED -> deep warm clay (accent-foreground). No direct use. */
--brand-warm-sand:    #E0D6C5   /* warm sand (prose blockquote rule, decorative) */
--brand-stone-sage:   #94977F   /* warm sage (1 direct use) */
--brand-soft-mist:    #F2EFE9   /* warm soft surface (muted/secondary/accent) */
--brand-muted-line:   #E8E6DF   /* warm low-contrast border (light) */
--brand-slate-text:   #78776E   /* warm gray (muted text) */
--brand-success:      #4F7A4A   /* warm-leaning green */
--brand-warning:      #A06D2E   /* amber (already warm) */
--brand-terracotta-light: #D98A6A  /* NEW: lifted terracotta for dark-mode accent */
```
The light semantic tokens may reference these swatches (e.g. `--primary: var(--brand-steel-blue)`) or use the hex directly — plan's choice — as long as the resulting values match the contract below.

### Light semantic tokens
```
--background #FAF9F6 · --foreground #20201E
--card #FFFFFF · --card-foreground #20201E · --popover #FFFFFF · --popover-foreground #20201E
--primary #C96442 · --primary-foreground #FFFFFF
--secondary #F2EFE9 · --secondary-foreground #20201E
--muted #F2EFE9 · --muted-foreground #78776E
--accent #F2EFE9 · --accent-foreground #6B4A38
--destructive #B04D48 · --destructive-foreground #FFFFFF
--border #E8E6DF · --input #E8E6DF · --ring #C96442
--surface-raised #FFFFFF · --surface-sunken #F2EFE9 · --surface-divider #E8E6DF
--radius 0.625rem  (UNCHANGED)
```

### Dark semantic tokens (warm near-black)
```
--background #1A1815 · --foreground #ECEAE3
--card #26231D · --card-foreground #ECEAE3 · --popover #26231D · --popover-foreground #ECEAE3
--primary #D98A6A · --primary-foreground #211712
--secondary #2E2A22 · --secondary-foreground #ECEAE3
--muted #2E2A22 · --muted-foreground #9A968B
--accent #322E26 · --accent-foreground #ECEAE3
--destructive #C56A5C · --destructive-foreground #211712
--border #322E26 · --input #322E26 · --ring #D98A6A
--surface-raised #26231D · --surface-sunken #1A1815 · --surface-divider #322E26
```

### `@theme inline` exports
Semantic `--color-*` mappings unchanged (they point at the semantic tokens above). Keep all existing direct-utility `--color-*` exports as-is (they now resolve to warm values via the remapped swatches); the 6 used ones (`text-ink`, `bg-warm-sand`, `text-stone-sage`, `text-success`×3) stay valid. Add `--font-serif`. (No need to drop the unused exports — leaving them remapped is lower-risk than removing.)

### `glass-panel` shadow
Update the rgba from the old cool ink `rgba(22, 32, 42, …)` to warm ink `rgba(32, 32, 30, …)` (same opacities). Dark variant unchanged (black rgba).

## Typography (the contract)

- `src/app/layout.tsx`: import `Fraunces` from `next/font/google` → `Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' })`; add `fraunces.variable` to the `<html>`/`<body>` className alongside Geist.
- `globals.css` `@theme`: `--font-serif: var(--font-fraunces), ui-serif, Georgia, 'Times New Roman', serif;` (so the Tailwind `font-serif` utility resolves to Fraunces). Geist remains `--font-sans` / `--font-mono` as today.
- Apply `font-serif` (display weight ~500) to the **display surfaces only**, enumerated for the plan to pin exact lines:
  - Home hero greeting (`HomeGreeting`)
  - Top-level view titles: **Artifacts** (`ArtifactsView` `<h2>`), **Projects** (`ProjectsView` title), and the empty-state brand wordmark on the home/empty view.
  - (Project landing page heading if it reads as a page title.)
- Body text, message content, buttons, inputs, labels, sidebar, and code stay **sans/mono** (unchanged).

## Verification

This is a visual change with no unit-testable logic.
- Gate: `npm run typecheck` (0 errors) · `npm run lint` (0 errors, ≤27 baseline warnings) · `npm run build` · `npm test` (still 366 pass — no logic touched).
- **Manual visual pass (the real check):** run `npm run dev` (or a preview deploy) and review in **both light and dark**: canvas/card/text/border read warm and cohesive; terracotta accent on primary actions/active states/rings; serif renders on the hero + page titles only; no element became illegible (contrast) in either mode; the artifacts gallery, chat, sidebar, dialogs, and project rail all re-theme cleanly.

## Risks / mitigations
- **Contrast regressions** (warm grays, coral buttons): verify `foreground`/`muted-foreground` on `background`/`card` and `primary-foreground` on `primary` in both modes during the manual pass; nudge a value if a surface fails legibility.
- **Hardcoded white/black overlays remain** (out of scope): on the warm canvas a few `border-white/10` borders may read fainter than before. Pre-existing; documented as the follow-up cleanup. If any specific surface looks broken during the manual pass, fix that one inline (don't sweep all 250).
- **Fraunces weight/optical size** looking too heavy/light at hero size: tune the applied weight (400–600) during the manual pass.

## Definition of done
Light and dark modes render the warm paper/terracotta palette cohesively across the app; the serif headline appears on the hero + top-level titles with sans everywhere else; gate green; `CLAUDE.md` styling section updated to the new palette; shipped per cadence. The user signs off on the live look (light + dark).
