// House motion vocabulary — single source of truth for durations, easing, and
// shared variants. Components import from here instead of hard-coding values so
// the app animates as one system (fade+rise, warm ease-out, 0.15-0.35s).
import type { Variants, Transition } from 'framer-motion'

export const DUR = { fast: 0.15, base: 0.22, view: 0.2, slow: 0.35 } as const

// Ease-out-quint feel — fast start, soft settle. Matches the premium read of the
// existing easeOut usage while giving new work a slightly crisper landing.
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

export const STAGGER = 0.04
// Long lists must not crawl: total accumulated stagger delay is capped.
export const STAGGER_CAP = 0.3
export const staggerDelay = (i: number) => Math.min(i * STAGGER, STAGGER_CAP)

export const baseTransition: Transition = { duration: DUR.base, ease: EASE_OUT }

export const fadeRise: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
}

// Top-level view crossfade: enter rises, exit is a faster pure fade so the swap
// reads as one motion instead of two.
export const viewVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.view, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
}

export { useReducedMotion } from 'framer-motion'
