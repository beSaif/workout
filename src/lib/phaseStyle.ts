import { BlockPhase } from "./types"

/**
 * One look per phase, shared by the timeline and the cycle review, so a
 * phase reads the same colour everywhere it appears.
 */
export interface PhaseTheme {
  /** Solid phase colour: dots, bars, the active label. */
  color: string
  /** Header and card background tint. */
  tint: string
  /** Secondary text on the tint. */
  muted: string
}

/**
 * CSS variables rather than hex, defined in globals.css with a light and a dark value
 * each: a phase colour is used as text and as a tint, and both have to flip in the dark.
 */
export const PHASE_THEME: Record<BlockPhase, PhaseTheme> = {
  accumulation: { color: "var(--color-phase-volume)", tint: "var(--color-phase-volume-tint)", muted: "var(--color-phase-volume-muted)" },
  transmutation: { color: "var(--color-phase-intensity)", tint: "var(--color-phase-intensity-tint)", muted: "var(--color-phase-intensity-muted)" },
  realization: { color: "var(--color-phase-peak)", tint: "var(--color-phase-peak-tint)", muted: "var(--color-phase-peak-muted)" },
  deload: { color: "var(--color-phase-deload)", tint: "var(--color-phase-deload-tint)", muted: "var(--color-phase-deload-muted)" },
  reacclimation: { color: "var(--color-phase-rebuild)", tint: "var(--color-phase-rebuild-tint)", muted: "var(--color-phase-rebuild-muted)" },
}
