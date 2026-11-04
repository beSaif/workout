import { BlockPhase, Session, TrainingBlock } from "./types"
import { calcE1RM } from "./e1rm"
import {
  blockSlotNumbers,
  cycleLoadOffset,
  getBlockLength,
  measureSessionsPerWeek,
  prescribeForBlock,
} from "./prescription"

/**
 * The recap of a finished cycle, read entirely from what was logged: nothing here is
 * stored, so editing a session corrects the report too.
 */
export interface CycleReport {
  /** 1-based: how many cycles have closed with a deload, this one included. */
  number: number
  previousPeak: number
  nextPeak: number
  outcome: "raised" | "stalled" | "untested"
  change: NonNullable<TrainingBlock["review"]>["change"]
  /** The peak single as logged, or null when it was jumped over. */
  test: { kg: number; reps: number; rpe: number | null } | null
  /** Best e1RM before this cycle and within it (deload excluded). */
  e1rm: { before: number | null; during: number | null }
  phases: PhaseLine[]
  effort: { onTarget: number; harder: number; easier: number; unrated: number }
  /** Kilos the plan moved its loads by over the cycle, learned from the logged RPEs. */
  loadShift: number
  missedSets: number
  /** Bench days a week the next cycle is sized from today. */
  sessionsPerWeek: number
}

export interface PhaseLine {
  phase: BlockPhase
  sessions: number
  skipped: number
  sets: number
}

const CYCLE_PHASES: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload"]

function chrono(a: Session, b: Session): number {
  const t = (s: Session) => (s.date ? new Date(s.date).getTime() : 0)
  return t(a) - t(b) || a.id - b.id
}

function bestE1RM(sessions: Session[]): number | null {
  const values = sessions.flatMap((s) =>
    s.sets.filter((x) => !x.isWarmup && x.reps > 0).map((x) => calcE1RM(x.kg, x.reps))
  )
  const valid = values.filter((v): v is number => v != null)
  return valid.length > 0 ? Math.max(...valid) : null
}

/**
 * The report for the cycle a deload closed, or null when that deload carries no review
 * (one saved before reviews existed).
 */
export function buildCycleReport(blocks: TrainingBlock[], sessions: Session[], deloadId: number): CycleReport | null {
  const sorted = [...blocks].sort((a, b) => a.id - b.id)
  const deload = sorted.find((b) => b.id === deloadId)
  if (!deload || deload.phase !== "deload" || !deload.review) return null

  const previousDeload = sorted.filter((b) => b.phase === "deload" && b.id < deloadId).pop()
  const cycleBlocks = sorted.filter((b) => b.id > (previousDeload?.id ?? 0) && b.id <= deloadId)
  const confirmed = sessions.filter((s) => s.confirmed)
  const byId = new Map(confirmed.map((s) => [s.id, s]))
  const cycleSessionsOf = (b: TrainingBlock) =>
    b.sessionIds.map((id) => byId.get(id)).filter((s): s is Session => !!s).sort(chrono)

  const phases: PhaseLine[] = CYCLE_PHASES.flatMap((phase) => {
    const own = cycleBlocks.filter((b) => b.phase === phase)
    if (own.length === 0) return []
    const logged = own.flatMap(cycleSessionsOf)
    const working = logged.flatMap((s) => s.sets.filter((x) => !x.isWarmup && x.kg > 0))
    return [{
      phase,
      sessions: logged.length,
      skipped: own.reduce((n, b) => n + (b.skippedSlots?.length ?? 0), 0),
      sets: working.length,
    }]
  })

  // Effort against target, session by session, in the phases that set one.
  const effort = { onTarget: 0, harder: 0, easier: 0, unrated: 0 }
  for (const block of cycleBlocks) {
    if (block.phase === "deload" || block.phase === "reacclimation") continue
    const logged = cycleSessionsOf(block)
    const slots = blockSlotNumbers(block, logged.map((s) => s.id))
    for (const session of logged) {
      const rx = prescribeForBlock(block, (slots.get(session.id) ?? 1) - 1)
      const rpes = session.sets.filter((x) => !x.isWarmup && x.rpe != null).map((x) => x.rpe!)
      if (rx.rpe == null || rpes.length === 0) {
        effort.unrated++
        continue
      }
      const diff = Math.max(...rpes) - rx.rpe
      if (diff >= 1) effort.harder++
      else if (diff <= -1) effort.easier++
      else effort.onTarget++
    }
  }

  const realization = cycleBlocks.filter((b) => b.phase === "realization").pop()
  let test: CycleReport["test"] = null
  if (realization) {
    const logged = cycleSessionsOf(realization)
    const slots = blockSlotNumbers(realization, logged.map((s) => s.id))
    const final = logged.find((s) => slots.get(s.id) === getBlockLength(realization))
    const attempts = final?.sets.filter((x) => !x.isWarmup && x.kg > 0) ?? []
    if (attempts.length > 0) {
      // The heaviest made single, or the heaviest attempt when nothing was made.
      const made = attempts.filter((x) => x.reps > 0)
      const pool = made.length > 0 ? made : attempts
      const top = pool.reduce((a, b) => (b.kg > a.kg ? b : a))
      test = { kg: top.kg, reps: top.reps, rpe: top.rpe }
    }
  }

  const cycleSessions = cycleBlocks.filter((b) => b.phase !== "deload").flatMap(cycleSessionsOf)
  const cycleStart = cycleSessions[0]
  const before = cycleStart
    ? confirmed.filter((s) => s.type !== "Deload" && chrono(s, cycleStart) < 0 && !cycleSessions.includes(s))
    : []

  return {
    number: sorted.filter((b) => b.phase === "deload" && b.id <= deloadId).length,
    previousPeak: deload.review.previousAnchor,
    nextPeak: deload.anchorWeight,
    outcome: deload.review.outcome,
    change: deload.review.change,
    test,
    e1rm: { before: bestE1RM(before), during: bestE1RM(cycleSessions) },
    phases,
    effort,
    loadShift: realization ? cycleLoadOffset(blocks, confirmed, realization) : 0,
    missedSets: cycleSessions.flatMap((s) => s.sets).filter((x) => !x.isWarmup && x.kg > 0 && x.reps === 0).length,
    sessionsPerWeek: deload.sessionsPerWeek ?? measureSessionsPerWeek(confirmed, deload.endDate),
  }
}
