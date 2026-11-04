import { Session, TrainingBlock } from "./types"
import { calcE1RM } from "./e1rm"
import { loadStep } from "./prescription"
import { cycleReviewFor } from "./cycleReport"

/** Cycles averaged for the pace towards the goal. */
const PACE_CYCLES = 4

/**
 * What the progress card on Home shows: where the main lift stands against the goal,
 * read from the logs and the program. Every number here is derived, none stored.
 */
export interface LiftProgress {
  /** Best e1RM from any working set outside deloads. */
  e1rm: number | null
  /** How far the best e1RM has moved since the current cycle began; 0 when it hasn't. */
  cycleGain: number
  /** The peak the program is building to: this cycle's, or the next one's during a deload. */
  peak: number | null
  peakIsNext: boolean
  /** Heaviest working set lifted, with the most reps done at that weight. */
  bestLift: { kg: number; reps: number } | null
  /** Cycles to the goal at the recent rate of peak gains; null when there's no rate to go on. */
  cyclesToGoal: number | null
  sessions: number
}

function chrono(a: Session, b: Session): number {
  const t = (s: Session) => (s.date ? new Date(s.date).getTime() : 0)
  return t(a) - t(b) || a.id - b.id
}

function bestE1RM(sessions: Session[]): number | null {
  const values = sessions
    .filter((s) => s.type !== "Deload")
    .flatMap((s) => s.sets.filter((x) => !x.isWarmup && x.reps > 0).map((x) => calcE1RM(x.kg, x.reps)))
    .filter((v): v is number => v != null)
  return values.length > 0 ? Math.max(...values) : null
}

/** The blocks of the cycle the active block belongs to: everything after the deload before it. */
function currentCycle(blocks: TrainingBlock[], active: TrainingBlock): TrainingBlock[] {
  const sorted = [...blocks].sort((a, b) => a.id - b.id)
  const lastDeload = sorted.filter((b) => b.phase === "deload" && b.id < active.id).pop()
  return sorted.filter((b) => b.id > (lastDeload?.id ?? 0) && b.id <= active.id)
}

/**
 * Average peak gain over the most recent cycles, or the usual step when there's too
 * little history. A rate at or under zero gives no estimate: no pace reaches the goal.
 */
function pacePerCycle(blocks: TrainingBlock[], peak: number): number | null {
  const gains = [...blocks]
    .filter((b) => b.phase === "deload")
    .sort((a, b) => a.id - b.id)
    .map((d) => {
      const review = cycleReviewFor(blocks, d)
      return review && review.outcome !== "untested" ? d.anchorWeight - review.previousAnchor : null
    })
    .filter((g): g is number => g != null)
    .slice(-PACE_CYCLES)
  if (gains.length < 2) return loadStep(peak)
  const avg = gains.reduce((a, b) => a + b, 0) / gains.length
  return avg > 0 ? avg : null
}

export function liftProgress(blocks: TrainingBlock[], sessions: Session[], target: number | null): LiftProgress {
  const confirmed = sessions.filter((s) => s.confirmed).sort(chrono)
  const e1rm = bestE1RM(confirmed)

  const active = blocks.find((b) => b.status === "active")
  let cycleGain = 0
  if (active && e1rm != null) {
    const ids = new Set(currentCycle(blocks, active).flatMap((b) => b.sessionIds))
    const first = confirmed.find((s) => ids.has(s.id))
    const before = first ? bestE1RM(confirmed.filter((s) => chrono(s, first) < 0)) : null
    if (before != null && e1rm > before) cycleGain = Math.round((e1rm - before) * 10) / 10
  }

  const working = confirmed.flatMap((s) => s.sets.filter((x) => !x.isWarmup && x.reps > 0 && x.kg > 0))
  const topKg = working.length > 0 ? Math.max(...working.map((x) => x.kg)) : null
  const bestLift =
    topKg != null ? { kg: topKg, reps: Math.max(...working.filter((x) => x.kg === topKg).map((x) => x.reps)) } : null

  const peak = active?.phase === "reacclimation" ? null : active?.anchorWeight ?? null
  let cyclesToGoal: number | null = null
  if (target && e1rm != null && e1rm < target && peak != null) {
    const pace = pacePerCycle(blocks, peak)
    if (pace) cyclesToGoal = Math.max(1, Math.ceil((target - e1rm) / pace))
  }

  return {
    e1rm,
    cycleGain,
    peak,
    peakIsNext: active?.phase === "deload",
    bestLift,
    cyclesToGoal,
    sessions: confirmed.length,
  }
}
