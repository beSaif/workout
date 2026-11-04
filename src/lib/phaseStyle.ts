import { BlockPhase } from "./types"

/**
 * One look per phase, shared by the timeline, the phase header and the previews, so a
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

export const PHASE_THEME: Record<BlockPhase, PhaseTheme> = {
  accumulation: { color: "#2d6a2d", tint: "#f0f7f0", muted: "#4a8a4a" },
  transmutation: { color: "#5a2d8a", tint: "#f5f0ff", muted: "#7a4daa" },
  realization: { color: "#1e3a5f", tint: "#eff6ff", muted: "#3b5f8a" },
  deload: { color: "#6b6b6b", tint: "#f5f5f5", muted: "#888888" },
  reacclimation: { color: "#8a4d14", tint: "#fdf3e7", muted: "#b06a1e" },
}

/** What each phase is for, in a line. */
export const PHASE_PURPOSE: Record<BlockPhase, string> = {
  accumulation: "Build the base: more reps, lighter loads.",
  transmutation: "Heavier fives to triples.",
  realization: "Taper into your peak single.",
  deload: "Back off and let it sink in.",
  reacclimation: "Climb back after time off.",
}
