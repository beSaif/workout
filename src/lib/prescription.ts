import { Session, TrainingBlock, BlockPhase, SessionType, RepRange } from "./types"
import { roundToPlate } from "./e1rm"

export interface Prescription {
  weight: number
  reps: number
  sets: number
  sessionType: SessionType
  /** The effort the working sets should feel like. Null where effort doesn't steer the load (deload, rebuild). */
  rpe: number | null
  /** A lighter repeat of the step before it, slotted in when the user benches often enough to need one. */
  light: boolean
}

interface SchemeEntry {
  pct: number
  reps: number
  sets: number
  rpe: number | null
}

/**
 * Session counts for blocks saved before blocks carried their own `length`. New blocks
 * are sized from how often the user benches (see blockLengthFor).
 */
export const BLOCK_LENGTHS: Record<BlockPhase, number> = {
  accumulation: 4,
  transmutation: 4,
  realization: 3,
  deload: 1,
  // Re-acclimation length is dynamic (rebuildLoads.length); use getBlockLength().
  reacclimation: 0,
}

export const PHASE_LABEL: Record<BlockPhase, string> = {
  accumulation: "Accumulation",
  transmutation: "Transmutation",
  realization: "Realization",
  deload: "Deload",
  reacclimation: "Re-acclimation",
}

const BLOCK_PHASE_ORDER: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload"]

// Target RPEs are what each load works out to on the RTS effort chart, so a session
// that lands on its target is going exactly to plan.

// ─── Version 1 ────────────────────────────────────────────────────────────────
// The schemes blocks were planned with before cycles were lengthened. Blocks saved
// without a schemeVersion keep running them, so a block in progress is never re-planned
// under the user, and the RPE replay reads its sessions against what they were given.

/** Volume and intensity both climb: reps per session go 32 → 40 before the loads take over. */
const V1_ACCUMULATION: SchemeEntry[] = [
  { pct: 0.675, reps: 8, sets: 4, rpe: 6 },
  { pct: 0.700, reps: 8, sets: 4, rpe: 6.5 },
  { pct: 0.700, reps: 8, sets: 5, rpe: 7 },
  { pct: 0.725, reps: 7, sets: 5, rpe: 7 },
  { pct: 0.750, reps: 6, sets: 5, rpe: 7 },
  { pct: 0.775, reps: 6, sets: 5, rpe: 7.5 },
]

const V1_TRANSMUTATION: SchemeEntry[] = [
  { pct: 0.800, reps: 5, sets: 4, rpe: 7.5 },
  { pct: 0.825, reps: 4, sets: 4, rpe: 7.5 },
  { pct: 0.850, reps: 3, sets: 4, rpe: 7.5 },
  { pct: 0.875, reps: 3, sets: 4, rpe: 8.5 },
]

/**
 * A taper into the test, not a second intensity block: doubles, then openers, then the
 * single. The single is the cycle's peak plus whatever the cycle showed (see cycleLoadOffset).
 */
const REALIZATION_SCHEME: SchemeEntry[] = [
  { pct: 0.900, reps: 2, sets: 3, rpe: 8.5 },
  { pct: 0.925, reps: 1, sets: 2, rpe: 8 },
  { pct: 1.000, reps: 1, sets: 1, rpe: 9.5 },
]

const DELOAD_SCHEME: SchemeEntry[] = [
  { pct: 0.600, reps: 5, sets: 3, rpe: null },
]

const V1_SCHEMES: Record<BlockPhase, SchemeEntry[]> = {
  accumulation: V1_ACCUMULATION,
  transmutation: V1_TRANSMUTATION,
  realization: REALIZATION_SCHEME,
  deload: DELOAD_SCHEME,
  // Re-acclimation is prescribed from the block's rebuildLoads, not a percentage scheme.
  reacclimation: [],
}


// ─── Version 2 ────────────────────────────────────────────────────────────────
// Three weeks of volume, two of intensity, one of taper at three sessions a week, one
// scheme step per session. Volume climbs a set before each load step, then resets.

/** Eights, sevens and sixes: the default accumulation. */
const V2_ACCUMULATION_MODERATE: SchemeEntry[] = [
  { pct: 0.675, reps: 8, sets: 4, rpe: 6 },
  { pct: 0.675, reps: 8, sets: 5, rpe: 6.5 },
  { pct: 0.700, reps: 8, sets: 5, rpe: 7 },
  { pct: 0.700, reps: 8, sets: 6, rpe: 7.5 },
  { pct: 0.725, reps: 7, sets: 5, rpe: 7 },
  { pct: 0.725, reps: 7, sets: 6, rpe: 7.5 },
  { pct: 0.750, reps: 6, sets: 5, rpe: 7 },
  { pct: 0.750, reps: 6, sets: 6, rpe: 7.5 },
  { pct: 0.775, reps: 6, sets: 5, rpe: 7.5 },
]

/** Sixes, fives and fours, heavier: what accumulation switches to after a plateau. */
const V2_ACCUMULATION_HEAVY: SchemeEntry[] = [
  { pct: 0.725, reps: 6, sets: 4, rpe: 6 },
  { pct: 0.725, reps: 6, sets: 5, rpe: 6.5 },
  { pct: 0.750, reps: 6, sets: 5, rpe: 7 },
  { pct: 0.750, reps: 6, sets: 6, rpe: 7.5 },
  { pct: 0.775, reps: 5, sets: 5, rpe: 7 },
  { pct: 0.775, reps: 5, sets: 6, rpe: 7.5 },
  { pct: 0.800, reps: 5, sets: 5, rpe: 7.5 },
  { pct: 0.800, reps: 5, sets: 6, rpe: 8 },
  { pct: 0.825, reps: 4, sets: 5, rpe: 7.5 },
]

const V2_TRANSMUTATION: SchemeEntry[] = [
  { pct: 0.800, reps: 5, sets: 4, rpe: 7.5 },
  { pct: 0.800, reps: 5, sets: 5, rpe: 8 },
  { pct: 0.825, reps: 4, sets: 4, rpe: 7.5 },
  { pct: 0.825, reps: 4, sets: 5, rpe: 8 },
  { pct: 0.850, reps: 3, sets: 4, rpe: 7.5 },
  { pct: 0.875, reps: 3, sets: 4, rpe: 8.5 },
]

function v2Schemes(repRange: RepRange): Record<BlockPhase, SchemeEntry[]> {
  return {
    accumulation: repRange === "heavy" ? V2_ACCUMULATION_HEAVY : V2_ACCUMULATION_MODERATE,
    transmutation: V2_TRANSMUTATION,
    realization: REALIZATION_SCHEME,
    deload: DELOAD_SCHEME,
    reacclimation: [],
  }
}

/** The scheme version new blocks are made with. */
export const SCHEME_VERSION = 2

/** What a block's sessions are planned from, beyond its phase and peak. */
export type BlockProgram = Partial<Pick<TrainingBlock, "schemeVersion" | "repRange" | "extraSets">>

/** The program a block made today starts on: current schemes, default rep range, no extra volume. */
const FRESH_PROGRAM: BlockProgram = { schemeVersion: SCHEME_VERSION }

function schemesFor(program: BlockProgram): Record<BlockPhase, SchemeEntry[]> {
  return (program.schemeVersion ?? 1) >= 2 ? v2Schemes(program.repRange ?? "moderate") : V1_SCHEMES
}

/** Extra accumulation sets a cycle can build up to. */
export const MAX_EXTRA_SETS = 2
/** Cycles in a row without a new peak before accumulation switches rep range. */
const STALLS_BEFORE_SWITCH = 2

export const PHASE_SESSION_TYPE: Record<BlockPhase, SessionType> = {
  accumulation: "Volume",
  transmutation: "Intensity",
  realization: "Peak",
  deload: "Deload",
  reacclimation: "Volume",
}

// Re-acclimation rebuild sessions are a fixed volume scheme at the given rebuild load.
const REACCLIMATION_REPS = 5
const REACCLIMATION_SETS = 3

/**
 * How long each phase of a new block runs, in weeks, and the fewest sessions it can be
 * squeezed into. A full week of deload replaces the usual single session after a cycle
 * that didn't raise the peak.
 */
const PHASE_WEEKS: Record<BlockPhase, { weeks: number; min: number }> = {
  accumulation: { weeks: 3, min: 6 },
  transmutation: { weeks: 2, min: 4 },
  realization: { weeks: 1, min: 3 },
  deload: { weeks: 1 / 3, min: 1 },
  reacclimation: { weeks: 0, min: 0 },
}
const DELOAD_WEEK = { weeks: 1, min: 2 }

/** Assumed when there isn't enough history to measure, and the pace the schemes are written for. */
export const DEFAULT_SESSIONS_PER_WEEK = 3

/** A light day is this share of the step it repeats. */
const LIGHT_LOAD = 0.85
const LIGHT_RPE_DROP = 2

/** Load nudges never take the cycle further than this from the anchor's own percentages. */
const MAX_OFFSET_PCT = 0.075
/** A new anchor moves at most this far from the old one in a single cycle. */
const MAX_ANCHOR_CHANGE = 0.05
/** Effort assumed for a realization set logged without an RPE: on target, so skipping the RPE is never the faster way up. */
const ASSUMED_PEAK_RPE = 9.5

/** Working sets that were lifted: at least one rep. */
function getWorkingSets(session: Session) {
  return session.sets.filter((s) => !s.isWarmup && s.kg > 0 && s.reps > 0)
}

/** Every working set attempted, missed ones (logged at 0 reps) included. */
function getAttemptedSets(session: Session) {
  return session.sets.filter((s) => !s.isWarmup && s.kg > 0)
}

function chrono(a: Session, b: Session): number {
  const byDate = (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0)
  return byDate !== 0 ? byDate : a.id - b.id
}

export function nextBlockPhase(current: BlockPhase): BlockPhase {
  const idx = BLOCK_PHASE_ORDER.indexOf(current)
  return BLOCK_PHASE_ORDER[(idx + 1) % BLOCK_PHASE_ORDER.length]
}

/**
 * The smallest change worth making to a load: 2.5% of the anchor, never under one
 * 2.5kg step. A fixed 2.5kg is 4% of a 60kg bench but barely 1% of a 200kg one.
 */
export function loadStep(anchorWeight: number): number {
  return Math.max(2.5, roundToPlate(anchorWeight * 0.025))
}

/**
 * Sessions for a new block of a phase at a given benching frequency. A block runs each
 * scheme step at most twice, heavy then light, so light days never come back to back.
 */
export function blockLengthFor(
  phase: BlockPhase,
  sessionsPerWeek: number,
  opts: { deloadWeek?: boolean } = {}
): number {
  const { weeks, min } = phase === "deload" && opts.deloadWeek ? DELOAD_WEEK : PHASE_WEEKS[phase]
  const perWeek = Math.min(6, Math.max(2, Math.round(sessionsPerWeek)))
  const length = Math.max(min, Math.round(weeks * perWeek))
  const steps = v2Schemes("moderate")[phase].length
  return steps > 1 ? Math.min(length, 2 * steps - 1) : length
}

/**
 * How often the user actually benches: main-lift sessions over the four weeks before
 * `asOf`. With under two weeks of history there is nothing to measure yet.
 */
export function measureSessionsPerWeek(sessions: Session[], asOf: string | null): number {
  const dated = sessions.filter((s) => s.confirmed && s.date && getAttemptedSets(s).length > 0)
  if (dated.length === 0) return DEFAULT_SESSIONS_PER_WEEK
  const end = asOf
    ? new Date(asOf).getTime()
    : Math.max(...dated.map((s) => new Date(s.date!).getTime()))
  const first = Math.min(...dated.map((s) => new Date(s.date!).getTime()))
  const DAY = 86_400_000
  if (end - first < 14 * DAY) return DEFAULT_SESSIONS_PER_WEEK
  const windowStart = Math.max(first, end - 28 * DAY)
  const weeks = Math.max(2, (end - windowStart) / (7 * DAY))
  const count = dated.filter((s) => {
    const t = new Date(s.date!).getTime()
    return t > windowStart - DAY && t <= end
  }).length
  return Math.min(6, Math.max(2, Math.round(count / weeks)))
}

/**
 * Which scheme step a slot trains, and whether it is a light repeat. A block longer
 * than its scheme repeats steps (the repeat runs light, so heavy and light days
 * alternate); a shorter one drops steps. Either way the final slot is always the
 * scheme's last step, so a realization block always ends on the test.
 */
function slotEntry(schemeLength: number, blockLength: number, index: number): { step: number; light: boolean } {
  const last = schemeLength - 1
  const len = Math.max(1, blockLength)
  const i = Math.min(Math.max(0, index), len - 1)
  const stepAt = (k: number) => (k >= len - 1 ? last : Math.floor((k * last) / (len - 1)))
  const step = stepAt(i)
  return { step, light: len > schemeLength && i > 0 && i < len - 1 && stepAt(i - 1) === step }
}

/**
 * The rounded load for each step of a scheme. Light anchors can round neighbouring
 * percentages onto the same plate; that just repeats the load. Stepping the earlier
 * session down instead cascades, and could leave a block lighter than the one before it.
 */
function schemeLoads(scheme: SchemeEntry[], anchorWeight: number): number[] {
  return scheme.map((e) => roundToPlate(anchorWeight * e.pct))
}

/**
 * One session of a phase's scheme. `program` says which schemes to read and how much
 * extra volume the cycle carries; without one, the schemes a new block would get.
 */
export function prescribeBlockSession(
  phase: BlockPhase,
  sessionIndexInBlock: number,
  anchorWeight: number,
  blockLength?: number,
  loadOffset = 0,
  program: BlockProgram = FRESH_PROGRAM
): Prescription {
  // Fall back to accumulation for any phase without a percentage scheme
  // (e.g. reacclimation, which should go through prescribeForBlock instead).
  const schemes = schemesFor(program)
  const ownScheme = schemes[phase]?.length > 0
  const scheme = ownScheme ? schemes[phase] : schemes.accumulation
  const schemePhase: BlockPhase = ownScheme ? phase : "accumulation"
  const type = PHASE_SESSION_TYPE[schemePhase]
  const slot = slotEntry(scheme.length, blockLength ?? scheme.length, sessionIndexInBlock)
  const step = slot.step
  // A deload is light already: a deload week repeats its one session, never lighter still.
  const light = slot.light && schemePhase !== "deload"
  const entry = scheme[step]
  const base = schemeLoads(scheme, anchorWeight)[step] + loadOffset
  // Volume a cycle has earned goes on the heavy accumulation days; light days stay light.
  const extra = schemePhase === "accumulation" && !light ? Math.max(0, program.extraSets ?? 0) : 0
  return {
    weight: roundToPlate(light ? base * LIGHT_LOAD : base),
    reps: entry.reps,
    sets: entry.sets + extra,
    sessionType: type,
    rpe: entry.rpe === null ? null : light ? entry.rpe - LIGHT_RPE_DROP : entry.rpe,
    light,
  }
}

/** Session count for a block — dynamic for re-acclimation (its rebuildLoads length). */
export function getBlockLength(
  block: Pick<TrainingBlock, "phase" | "rebuildLoads" | "length">
): number {
  if (block.phase === "reacclimation") return block.rebuildLoads?.length ?? 0
  return block.length ?? BLOCK_LENGTHS[block.phase] ?? 0
}

/**
 * How far into the block the user is: sessions logged plus slots jumped over. The
 * next session prescribes from this index, and the block is done once it reaches
 * getBlockLength().
 */
export function blockPosition(block: Pick<TrainingBlock, "sessionIds" | "skippedSlots">): number {
  return block.sessionIds.length + (block.skippedSlots?.length ?? 0)
}

/**
 * Each logged session's 1-based place in its block. Sessions fill the slots in the
 * order given (oldest first), stepping around any slot that was jumped over.
 */
export function blockSlotNumbers(
  block: Pick<TrainingBlock, "skippedSlots">,
  chronoSessionIds: number[]
): Map<number, number> {
  const skipped = new Set(block.skippedSlots ?? [])
  const numbers = new Map<number, number>()
  let slot = 0
  for (const id of chronoSessionIds) {
    while (skipped.has(slot)) slot++
    numbers.set(id, slot + 1)
    slot++
  }
  return numbers
}

/**
 * Prescription for the nth session of a specific block. Re-acclimation reads its
 * weight from rebuildLoads; every other phase delegates to the percentage scheme,
 * shifted by `loadOffset` (see cycleLoadOffset).
 */
export function prescribeForBlock(
  block: Pick<TrainingBlock, "phase" | "rebuildLoads" | "anchorWeight" | "length"> & BlockProgram,
  sessionIndexInBlock: number,
  loadOffset = 0
): Prescription {
  if (block.phase === "reacclimation") {
    const loads = block.rebuildLoads ?? []
    const weight = loads.length > 0
      ? loads[Math.min(sessionIndexInBlock, loads.length - 1)]
      : block.anchorWeight
    return {
      weight: roundToPlate(weight),
      reps: REACCLIMATION_REPS,
      sets: REACCLIMATION_SETS,
      sessionType: PHASE_SESSION_TYPE.reacclimation,
      rpe: null,
      light: false,
    }
  }
  return prescribeBlockSession(
    block.phase,
    sessionIndexInBlock,
    block.anchorWeight,
    getBlockLength(block),
    block.phase === "deload" ? 0 : loadOffset,
    programOf(block)
  )
}

/** The scheme fields of a block. One saved without a schemeVersion runs version 1. */
export function programOf(block: BlockProgram): BlockProgram {
  return {
    schemeVersion: block.schemeVersion ?? 1,
    repRange: block.repRange,
    extraSets: block.extraSets,
  }
}

/** Reps over the plan on every working set that read as a set with more in it. */
const EXTRA_REPS_EASY = 2
/** How far under target a top set must be to count as easy: further at six reps and up, where RPE is a rougher guess. */
const EASY_RPE_MARGIN = { highReps: 1.5, lowReps: 1 }
const HIGH_REPS = 6
/** The effort the peak single is planned at. */
const PEAK_SINGLE_RPE = 9.5

/**
 * How one logged session moves the load for the sessions after it. Missed reps, or a
 * top set a full RPE over target, takes a step off. A top set well under target (1.5
 * RPE for sets of six and up, 1 below that), or every set beating its reps by two or
 * more, adds a step. Sets logged without an RPE say nothing about effort, only reps.
 *
 * Far from failure RPE is a rough guess (an RPE 6 set gets called a 7 all the time), so
 * a top set only counts as too hard from RPE 8 up. Light days move the load only on
 * missed reps.
 *
 * Peak-block sessions also cap what the single can be: a double or opener that came in
 * harder than planned scales the peak down by as much, so a cycle that ran easy in its
 * eights can't send the lifter to a single the openers already showed isn't there.
 */
function adjustOffset(offset: number, rx: Prescription, session: Session, anchorWeight: number, plannedReps: number | null): number {
  if (rx.rpe === null) return offset
  const attempted = getAttemptedSets(session)
  if (attempted.length === 0) return offset
  const working = attempted.filter((s) => s.reps > 0)
  const target = plannedReps ?? Math.max(1, ...working.map((s) => s.reps))
  // A set logged at 0 reps is a miss, the clearest one there is.
  const missed = attempted.some((s) => s.reps < target)
  const rpes = working.map((s) => s.rpe).filter((r): r is number => r != null)
  const top = rpes.length > 0 ? Math.max(...rpes) : null
  const step = loadStep(anchorWeight)
  let next = offset
  if (missed) next -= step
  else if (!rx.light) {
    const margin = rx.reps >= HIGH_REPS ? EASY_RPE_MARGIN.highReps : EASY_RPE_MARGIN.lowReps
    const tooHard = top !== null && top - Math.max(rx.rpe, 7) >= 1
    const easyByRpe = top !== null && rx.rpe - top >= margin
    const easyByReps =
      plannedReps !== null && working.length > 0 && working.every((s) => s.reps >= plannedReps + EXTRA_REPS_EASY)
    if (tooHard) next -= step
    else if (easyByRpe || easyByReps) next += step
  }
  if (rx.sessionType === "Peak") {
    // Measured against what the plan expected of this session, not as an absolute max:
    // Brzycki reads low on singles and doubles next to the effort chart the targets come
    // from, and the bias cancels when both sides use it. A session on target caps nothing.
    const rated = working.filter((s) => s.rpe != null)
    if (rated.length > 0) {
      const shown = Math.max(...rated.map((s) => effortE1RM(s.kg, s.reps, s.rpe!)))
      const expected = effortE1RM(rx.weight, rx.reps, rx.rpe)
      const peak = roundToPlate(((anchorWeight + offset) * shown) / expected)
      next = Math.min(next, peak - anchorWeight)
    }
  }
  const limit = roundToPlate(anchorWeight * MAX_OFFSET_PCT)
  return Math.min(limit, Math.max(-limit, next))
}

/**
 * The kilos to add to (or take off) the scheme's loads for `target`'s sessions, learned
 * from every session logged so far this cycle. It is replayed from the logs each time
 * rather than stored, so editing or unlogging a session corrects it on its own.
 *
 * It carries from block to block through a cycle and starts again at zero whenever the
 * anchor changes: at the deload (the anchor was just re-derived) or after an edit.
 */
export function cycleLoadOffset(
  blocks: TrainingBlock[],
  sessions: Session[],
  target: Pick<TrainingBlock, "id" | "phase" | "anchorWeight"> &
    Partial<Pick<TrainingBlock, "sessionIds" | "skippedSlots" | "length" | "rebuildLoads">> &
    BlockProgram
): number {
  if (target.phase === "reacclimation" || target.phase === "deload") return 0
  const byId = new Map(sessions.filter((s) => s.confirmed).map((s) => [s.id, s]))
  const earlier = blocks
    .filter((b) => b.id < target.id && b.phase !== "reacclimation")
    .sort((x, y) => x.id - y.id)
  // Nothing before the last deload can count: the offset starts again there.
  const lastDeload = earlier.map((b) => b.phase).lastIndexOf("deload")
  const chain = earlier.slice(Math.max(0, lastDeload))
  const own: TrainingBlock = {
    status: "active",
    startDate: null,
    endDate: null,
    sessionIds: [],
    ...blocks.find((b) => b.id === target.id),
    ...target,
  }

  let offset = 0
  let anchor: number | null = null
  for (const block of [...chain, own]) {
    if (block.phase === "deload" || block.anchorWeight !== anchor) offset = 0
    anchor = block.anchorWeight
    const logged = (block.sessionIds ?? [])
      .map((id) => byId.get(id))
      .filter((s): s is Session => !!s)
      .sort(chrono)
    const slots = blockSlotNumbers(block, logged.map((s) => s.id))
    for (const session of logged) {
      const rx = prescribeForBlock(block, (slots.get(session.id) ?? 1) - 1, offset)
      // Blocks saved before the current schemes were planned against different rep
      // counts, so for those a miss is read off the session itself.
      offset = adjustOffset(offset, rx, session, block.anchorWeight, block.length != null ? rx.reps : null)
    }
  }
  return offset
}

/** e1RM of one set, effort included: Brzycki run on the reps the set had in it. */
function effortE1RM(kg: number, reps: number, rpe: number): number {
  const repsInTank = reps + Math.max(0, 10 - rpe)
  return repsInTank >= 37 ? kg : kg * (36 / (37 - repsInTank))
}

/** How a cycle's peak test went. "untested" when the single was jumped over or never logged. */
export type CycleOutcome = "raised" | "stalled" | "untested"

export interface CycleReview {
  /** The next cycle's peak. */
  anchor: number
  outcome: CycleOutcome
}

/**
 * After a realization block, the peak for the next cycle: the best effort-adjusted e1RM
 * the block showed, and at least one load step over the single when that was made at
 * the planned peak or above, no harder than RPE 9.5. So a cycle that goes exactly to
 * plan raises the peak a step, a fast single raises it by what it showed and a grinder
 * holds it. A single that was only missed (logged at 0 reps) sets the peak a step under
 * the missed weight, never above the old peak: missing 102.5 on a 100 peak holds 100,
 * missing 100 drops it to 97.5. Sets logged without an RPE count as on target. The
 * change is held to 5% either way per cycle, rounded down to the plate.
 */
export function reviewCycle(completedRealizationBlock: TrainingBlock, sessions: Session[]): CycleReview {
  const block = completedRealizationBlock
  const anchor = block.anchorWeight
  const logged = sessions
    .filter((s) => s.confirmed && block.sessionIds.includes(s.id))
    .sort(chrono)
  const sets = logged.flatMap(getWorkingSets)
  if (logged.flatMap(getAttemptedSets).length === 0) return { anchor, outcome: "untested" }

  const finalSlot = getBlockLength(block) - 1
  const slots = blockSlotNumbers(block, logged.map((s) => s.id))
  const test = logged.find((s) => slots.get(s.id) === finalSlot + 1)
  const testSkipped = block.skippedSlots?.includes(finalSlot) ?? false

  let best = sets.length > 0 ? Math.max(...sets.map((s) => effortE1RM(s.kg, s.reps, s.rpe ?? ASSUMED_PEAK_RPE))) : anchor
  const made = test
    ? getWorkingSets(test).filter((s) => s.kg >= anchor && (s.rpe ?? ASSUMED_PEAK_RPE) <= PEAK_SINGLE_RPE)
    : []
  // Without the test itself, the doubles and openers can show the peak was too low,
  // but taper work is no grounds for cutting it.
  if (!test || testSkipped) best = Math.max(best, anchor)
  else if (made.length > 0) best = Math.max(best, Math.max(...made.map((s) => s.kg)) + loadStep(anchor))
  else if (getWorkingSets(test).length === 0) {
    const missedKg = getAttemptedSets(test).map((s) => s.kg)
    if (missedKg.length > 0) best = Math.min(anchor, Math.max(...missedKg) - loadStep(anchor))
  }

  const capped = Math.min(anchor * (1 + MAX_ANCHOR_CHANGE), Math.max(anchor * (1 - MAX_ANCHOR_CHANGE), best))
  // Down to the plate, never up: a peak is earned, not rounded into.
  const next = Math.floor(capped / 2.5 + 1e-9) * 2.5
  const outcome: CycleOutcome = !test || testSkipped ? "untested" : next > anchor ? "raised" : "stalled"
  return { anchor: next, outcome }
}

/** The next cycle's peak after a realization block (see reviewCycle). */
export function deriveNextAnchor(completedRealizationBlock: TrainingBlock, sessions: Session[]): number {
  return reviewCycle(completedRealizationBlock, sessions).anchor
}

/**
 * The first block of a program: accumulation at `anchorWeight`, sized to how often the
 * user benches, on the current schemes with no extra volume.
 */
export function createFirstBlock(id: number, anchorWeight: number, sessions: Session[]): TrainingBlock {
  return {
    id,
    phase: "accumulation",
    status: "active",
    sessionIds: [],
    anchorWeight: roundToPlate(anchorWeight),
    startDate: null,
    endDate: null,
    length: blockLengthFor("accumulation", measureSessionsPerWeek(sessions, null)),
    schemeVersion: SCHEME_VERSION,
  }
}

/**
 * Factory for the next block after a completed one, sized to how often the user benches.
 *
 * Finishing realization closes the cycle. A new peak earns the next cycle a set more
 * accumulation volume (up to MAX_EXTRA_SETS); a cycle that didn't raise it takes the
 * extra volume back off and buys a full deload week, and a second one in a row switches
 * accumulation to the other rep range. A cycle whose test was jumped over changes nothing.
 */
export function createNextBlock(
  completedBlock: TrainingBlock,
  sessions: Session[],
  newId: number
): TrainingBlock {
  const phase = nextBlockPhase(completedBlock.phase)
  const perWeek = completedBlock.sessionsPerWeek ?? measureSessionsPerWeek(sessions, completedBlock.endDate)
  let anchor = completedBlock.anchorWeight
  let repRange: RepRange = completedBlock.repRange ?? "moderate"
  let extraSets = completedBlock.extraSets ?? 0
  let stalls = completedBlock.stalls ?? 0
  let review: TrainingBlock["review"]
  let deloadWeek = false

  if (completedBlock.phase === "realization") {
    const result = reviewCycle(completedBlock, sessions)
    anchor = result.anchor
    let change: NonNullable<TrainingBlock["review"]>["change"] = null
    if (result.outcome === "raised") {
      stalls = 0
      if (extraSets < MAX_EXTRA_SETS) {
        extraSets += 1
        change = "volume-up"
      }
    } else if (result.outcome === "stalled") {
      stalls += 1
      deloadWeek = true
      if (stalls >= STALLS_BEFORE_SWITCH) {
        repRange = repRange === "moderate" ? "heavy" : "moderate"
        stalls = 0
        change = "rep-range"
      } else if (extraSets > 0) {
        change = "volume-reset"
      }
      extraSets = 0
    }
    review = { previousAnchor: completedBlock.anchorWeight, outcome: result.outcome, change }
  }

  return {
    id: newId,
    phase,
    status: "active",
    sessionIds: [],
    anchorWeight: anchor,
    startDate: null,
    endDate: null,
    length: blockLengthFor(phase, perWeek, { deloadWeek }),
    schemeVersion: SCHEME_VERSION,
    repRange,
    extraSets,
    stalls,
    ...(completedBlock.sessionsPerWeek != null ? { sessionsPerWeek: completedBlock.sessionsPerWeek } : {}),
    ...(review ? { review } : {}),
  }
}

/**
 * One-time migration: assigns SessionType to historical "Push" sessions
 * by their chronological position in the old 13-session macro cycle.
 */
export function migrateSessionTypes(sessions: Session[]): Session[] | null {
  const needsMigration = sessions.some((s) => s.confirmed && (s.type as string) === "Push")
  if (!needsMigration) return null

  const LEGACY_BLOCK: SessionType[] = ["Volume", "Intensity", "Peak"]
  const LEGACY_MACRO_TOTAL = 13

  const allConfirmed = sessions
    .filter((s) => s.confirmed)
    .sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

  const typeMap = new Map<number, SessionType>()
  allConfirmed.forEach((s, i) => {
    const pos = i % LEGACY_MACRO_TOTAL
    typeMap.set(s.id, pos === 12 ? "Deload" : LEGACY_BLOCK[pos % 3])
  })

  return allConfirmed.map((s) => ({ ...s, type: typeMap.get(s.id) ?? s.type }))
}
