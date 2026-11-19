import { Session, TrainingBlock, BlockPhase, SessionType, RepRange, CycleLength, TrainingAge } from "./types"
import { roundToPlate } from "./e1rm"

export interface Prescription {
  weight: number
  reps: number
  sets: number
  sessionType: SessionType
  /** The effort the working sets should feel like. Null where effort doesn't steer the load (deload, rebuild). */
  rpe: number | null
  /** A light day: the load only moves on missed reps. Version 3 light days are paused bench. */
  light: boolean
  /** Version 3 Volume and Intensity sessions: where the session sits in the heavy / light / medium week. */
  day?: DayRole
  /** Heavy days open with one heavy single before the working sets, which are then back-off sets. */
  topSet?: { weight: number; reps: number; rpe: number }
  /** Three-second pause on the chest every rep. */
  paused?: boolean
}

/** The three sessions of a version 3 week, in the order they come. */
export type DayRole = "heavy" | "light" | "medium"
const WEEK_ORDER: DayRole[] = ["heavy", "light", "medium"]
export const DAY_LABEL: Record<DayRole, string> = { heavy: "Heavy", light: "Light", medium: "Medium" }

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

// ─── Version 3: the heavy / light / medium week ───────────────────────────────
// Volume and Intensity run in weeks of three sessions, in the order they are logged:
// a heavy day (one top single at about RPE 7–8, then back-off sets), a light day (paused
// bench) and a medium day (the volume work). Each week climbs a step. Peak and Deload are
// shared with version 2: a taper into the test, then an easy week.

interface DayEntry {
  pct: number
  reps: number
  sets: number
  rpe: number
}

interface WeekEntry {
  /** The single that opens the heavy day, before its back-off sets. */
  top: { pct: number; rpe: number }
  heavy: DayEntry
  light: DayEntry
  medium: DayEntry
}

/** Light days are paused bench, aimed this easy. */
const LIGHT_DAY_RPE = 6

/** Volume, default rep range: back-offs in sixes, the medium day in eights and sevens. */
const V3_VOLUME_MODERATE: WeekEntry[] = [
  {
    top: { pct: 0.875, rpe: 6.5 },
    heavy: { pct: 0.725, reps: 6, sets: 4, rpe: 6 },
    light: { pct: 0.650, reps: 5, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.675, reps: 8, sets: 5, rpe: 6 },
  },
  {
    top: { pct: 0.900, rpe: 7.5 },
    heavy: { pct: 0.750, reps: 6, sets: 4, rpe: 6.5 },
    light: { pct: 0.650, reps: 5, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.700, reps: 8, sets: 5, rpe: 7 },
  },
  {
    top: { pct: 0.900, rpe: 7.5 },
    heavy: { pct: 0.775, reps: 6, sets: 4, rpe: 7.5 },
    light: { pct: 0.675, reps: 5, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.725, reps: 7, sets: 5, rpe: 7 },
  },
]

/** Volume after two cycles without a new peak: a rep lower and 2.5–5% heavier across the week. */
const V3_VOLUME_HEAVY: WeekEntry[] = [
  {
    top: { pct: 0.875, rpe: 6.5 },
    heavy: { pct: 0.750, reps: 5, sets: 4, rpe: 6 },
    light: { pct: 0.675, reps: 4, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.725, reps: 6, sets: 5, rpe: 6 },
  },
  {
    top: { pct: 0.900, rpe: 7.5 },
    heavy: { pct: 0.775, reps: 5, sets: 4, rpe: 6.5 },
    light: { pct: 0.675, reps: 4, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.750, reps: 6, sets: 5, rpe: 6.5 },
  },
  {
    top: { pct: 0.900, rpe: 7.5 },
    heavy: { pct: 0.800, reps: 5, sets: 4, rpe: 7.5 },
    light: { pct: 0.700, reps: 4, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.775, reps: 6, sets: 5, rpe: 7.5 },
  },
]

const V3_INTENSITY: WeekEntry[] = [
  {
    top: { pct: 0.900, rpe: 7.5 },
    heavy: { pct: 0.800, reps: 4, sets: 4, rpe: 7 },
    light: { pct: 0.700, reps: 3, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.775, reps: 5, sets: 5, rpe: 6.5 },
  },
  {
    top: { pct: 0.925, rpe: 8 },
    heavy: { pct: 0.825, reps: 4, sets: 4, rpe: 7.5 },
    light: { pct: 0.725, reps: 3, sets: 4, rpe: LIGHT_DAY_RPE },
    medium: { pct: 0.800, reps: 5, sets: 5, rpe: 7.5 },
  },
]

/** The weeks a version 3 block runs, or null for a phase that keeps the version 2 scheme. */
function v3Weeks(phase: BlockPhase, repRange: RepRange | undefined): WeekEntry[] | null {
  if (phase === "accumulation") return repRange === "heavy" ? V3_VOLUME_HEAVY : V3_VOLUME_MODERATE
  if (phase === "transmutation") return V3_INTENSITY
  return null
}

/**
 * Which week of the scheme a slot trains, and which day of it. Slots run heavy, light,
 * medium, heavy, ... in the order they are logged. A block with more weeks than the
 * scheme repeats its early weeks; one with fewer drops the middle ones, so it always
 * finishes on the heaviest week.
 */
function weekSlot(weeks: number, blockLength: number, index: number): { week: number; day: DayRole } {
  const i = Math.max(0, index)
  const blockWeeks = Math.max(1, Math.ceil(Math.max(1, blockLength) / WEEK_ORDER.length))
  const w = Math.min(Math.floor(i / WEEK_ORDER.length), blockWeeks - 1)
  return { week: spreadIndex(w, blockWeeks, weeks), day: WEEK_ORDER[i % WEEK_ORDER.length] }
}

/** Index `k` of `from` evenly onto `to`, first onto first and last onto last. */
function spreadIndex(k: number, from: number, to: number): number {
  return to <= 1 || k >= from - 1 ? to - 1 : Math.floor((k * (to - 1)) / (from - 1))
}

/** Hard sets a version 3 Volume block carries before extra sets: heavy and medium days. Light days aren't hard sets. */
function v3HardSets(weeks: WeekEntry[], blockLength: number): { sets: number; mediumDays: number } {
  let sets = 0
  let mediumDays = 0
  for (let i = 0; i < blockLength; i++) {
    const { week, day } = weekSlot(weeks.length, blockLength, i)
    if (day === "heavy") sets += weeks[week].heavy.sets + 1
    if (day === "medium") {
      sets += weeks[week].medium.sets
      mediumDays++
    }
  }
  return { sets, mediumDays }
}

function prescribeV3(
  phase: BlockPhase,
  weeks: WeekEntry[],
  index: number,
  anchorWeight: number,
  blockLength: number,
  loadOffset: number,
  program: BlockProgram
): Prescription {
  const { week, day } = weekSlot(weeks.length, blockLength, index)
  const entry = weeks[week][day]
  const extra = phase === "accumulation" && day === "medium" ? extraSetsAllowed(phase, blockLength, program) : 0
  const top = weeks[week].top
  return {
    weight: roundToPlate(roundToPlate(anchorWeight * entry.pct) + loadOffset),
    reps: entry.reps,
    sets: entry.sets + extra,
    sessionType: PHASE_SESSION_TYPE[phase],
    rpe: entry.rpe,
    light: day === "light",
    day,
    ...(day === "heavy"
      ? { topSet: { weight: roundToPlate(roundToPlate(anchorWeight * top.pct) + loadOffset), reps: 1, rpe: top.rpe } }
      : {}),
    ...(day === "light" ? { paused: true } : {}),
  }
}

// ─── Older schemes, kept to read what was logged on them ──────────────────────
// No new block is planned on these. Blocks made on them keep them for the sessions
// already logged, so the load replay and the cycle reports judge each session against
// what it was actually given.

// ─── Version 1 ────────────────────────────────────────────────────────────────
// The schemes blocks were planned with before cycles were lengthened.

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
// Its Peak and Deload schemes are still the current ones.

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
export const SCHEME_VERSION = 3

/** What a block's sessions are planned from, beyond its phase and peak. */
export type BlockProgram = Partial<Pick<TrainingBlock, "schemeVersion" | "repRange" | "extraSets" | "cycleLength">>

/** The program a block made today starts on: current schemes, default rep range, no extra volume. */
const FRESH_PROGRAM: BlockProgram = { schemeVersion: SCHEME_VERSION }

/** Version 1's and 2's step schemes; version 3 keeps version 2's for Peak and Deload. */
function schemesFor(program: BlockProgram): Record<BlockPhase, SchemeEntry[]> {
  return (program.schemeVersion ?? 1) >= 2 ? v2Schemes(program.repRange ?? "moderate") : V1_SCHEMES
}

/** Extra accumulation sets per heavy session a cycle can build up to. */
export const MAX_EXTRA_SETS = 2
/**
 * Extra sets never take heavy accumulation days past this many working sets a week: about
 * the top of the range that still pays off, before fatigue outruns it. Light days don't
 * count; they aren't hard sets.
 */
const WEEKLY_HEAVY_SET_CAP = 20
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
 * squeezed into, for each cycle length. Short cycles suit lifters who still progress
 * fast, long ones lifters who need more time in volume. A full week of deload replaces
 * the usual single session after a cycle that didn't raise the peak.
 */
const PHASE_WEEKS: Record<CycleLength, Record<BlockPhase, { weeks: number; min: number }>> = {
  short: {
    accumulation: { weeks: 2, min: 4 },
    transmutation: { weeks: 1, min: 3 },
    realization: { weeks: 1, min: 3 },
    deload: { weeks: 1 / 3, min: 1 },
    reacclimation: { weeks: 0, min: 0 },
  },
  standard: {
    accumulation: { weeks: 3, min: 6 },
    transmutation: { weeks: 2, min: 4 },
    realization: { weeks: 1, min: 3 },
    deload: { weeks: 1 / 3, min: 1 },
    reacclimation: { weeks: 0, min: 0 },
  },
  long: {
    accumulation: { weeks: 4, min: 8 },
    transmutation: { weeks: 3, min: 6 },
    realization: { weeks: 1, min: 3 },
    deload: { weeks: 1 / 3, min: 1 },
    reacclimation: { weeks: 0, min: 0 },
  },
}
const DELOAD_WEEK = { weeks: 1, min: 2 }

export const CYCLE_LENGTHS: CycleLength[] = ["short", "standard", "long"]
export const CYCLE_LENGTH_LABEL: Record<CycleLength, string> = { short: "Short", standard: "Standard", long: "Long" }

/** The cycle length that suits how long someone has been lifting. */
export function cycleLengthFor(trainingAge: TrainingAge | undefined): CycleLength {
  return trainingAge === "new" ? "short" : trainingAge === "years" ? "long" : "standard"
}

/** Planned weeks of a phase in a cycle of the given length. */
function phaseWeeks(phase: BlockPhase, cycleLength: CycleLength | undefined): number {
  return PHASE_WEEKS[cycleLength ?? "standard"][phase].weeks
}

/** Days a week from which some sessions run light. Below it every session is heavy. */
const LIGHT_REPEAT_FREQUENCY = 3.5
/** Heavy sessions a week aimed for once light days come in. */
const HEAVY_DAYS_PER_WEEK = 3

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

/** Sessions for a new block of a phase at a given benching frequency and cycle length. */
export function blockLengthFor(
  phase: BlockPhase,
  sessionsPerWeek: number,
  opts: { deloadWeek?: boolean; cycleLength?: CycleLength } = {}
): number {
  const { weeks, min } =
    phase === "deload" && opts.deloadWeek ? DELOAD_WEEK : PHASE_WEEKS[opts.cycleLength ?? "standard"][phase]
  const perWeek = Math.min(6, Math.max(2, Math.round(sessionsPerWeek)))
  // Volume and Intensity run in whole heavy / light / medium weeks.
  if (v3Weeks(phase, undefined)) {
    const n = WEEK_ORDER.length
    return n * Math.max(Math.ceil(min / n), Math.round((weeks * perWeek) / n))
  }
  return Math.max(min, Math.round(weeks * perWeek))
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
 * Which scheme step a slot trains, and whether it is a light day. `heavy` of the block's
 * slots are heavy, spread evenly with the first and last among them; each slot between
 * repeats the heavy step before it, light. The heavy slots then walk the scheme: fewer
 * of them than steps drops steps, more repeats them at full load. Either way the final
 * slot is the scheme's last step, so a realization block always ends on the test.
 */
function slotEntry(
  schemeLength: number,
  blockLength: number,
  index: number,
  heavy: number
): { step: number; light: boolean } {
  const len = Math.max(1, blockLength)
  const h = Math.min(len, Math.max(1, heavy))
  const i = Math.min(Math.max(0, index), len - 1)
  const spread = (k: number, from: number, to: number) => (to <= 1 || k >= from - 1 ? to - 1 : Math.floor((k * (to - 1)) / (from - 1)))
  const heavyAt = (k: number) => spread(k, len, h)
  const heavyIndex = heavyAt(i)
  const light = i > 0 && heavyAt(i - 1) === heavyIndex
  return { step: spread(heavyIndex, h, schemeLength), light }
}

/**
 * How many of a block's slots run heavy. Version 1 blocks repeat steps light once the
 * block outgrows its scheme. Version 2 blocks keep about three heavy days a week: every
 * slot at under four sessions a week, and from four up, light days in between so the
 * heavy ones stay near three, whatever the cycle length.
 */
function heavySlots(phase: BlockPhase, schemeLength: number, blockLength: number, program: BlockProgram): number {
  if ((program.schemeVersion ?? 1) < 2) return Math.min(blockLength, schemeLength)
  const weeks = phaseWeeks(phase, program.cycleLength)
  const perWeek = weeks > 0 ? blockLength / weeks : 0
  if (perWeek < LIGHT_REPEAT_FREQUENCY) return blockLength
  // At least every other slot heavy, so two light days never fall together.
  const atLeast = Math.ceil((blockLength + 1) / 2)
  return Math.min(blockLength, Math.max(atLeast, Math.ceil((blockLength * HEAVY_DAYS_PER_WEEK) / perWeek)))
}

/**
 * Extra sets an accumulation day may carry: what the cycle earned, held so the block's
 * hard sets stay under WEEKLY_HEAVY_SET_CAP a week. Version 3 puts them on the medium
 * days, version 2 on every heavy day.
 */
function extraSetsAllowed(phase: BlockPhase, blockLength: number, program: BlockProgram): number {
  const earned = Math.max(0, program.extraSets ?? 0)
  if (earned === 0 || phase !== "accumulation") return 0
  const weeks = (program.schemeVersion ?? 1) >= 3 ? v3Weeks(phase, program.repRange) : null
  if (weeks) {
    const { sets, mediumDays } = v3HardSets(weeks, blockLength)
    if (mediumDays === 0) return 0
    const budget = WEEKLY_HEAVY_SET_CAP * phaseWeeks(phase, program.cycleLength) - sets
    return Math.max(0, Math.min(earned, Math.floor(budget / mediumDays)))
  }
  const scheme = schemesFor(program).accumulation
  const heavy = heavySlots("accumulation", scheme.length, blockLength, program)
  let heavyCount = 0
  let heavySets = 0
  for (let i = 0; i < blockLength; i++) {
    const slot = slotEntry(scheme.length, blockLength, i, heavy)
    if (slot.light) continue
    heavyCount++
    heavySets += scheme[slot.step].sets
  }
  if (heavyCount === 0) return 0
  const budget = WEEKLY_HEAVY_SET_CAP * phaseWeeks("accumulation", program.cycleLength) - heavySets
  return Math.max(0, Math.min(earned, Math.floor(budget / heavyCount)))
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
  const schemePhase: BlockPhase = ownScheme ? phase : "accumulation"
  const weeks = (program.schemeVersion ?? 1) >= 3 ? v3Weeks(schemePhase, program.repRange) : null
  if (weeks) {
    const length = blockLength ?? weeks.length * WEEK_ORDER.length
    return prescribeV3(schemePhase, weeks, sessionIndexInBlock, anchorWeight, length, loadOffset, program)
  }
  const scheme = ownScheme ? schemes[phase] : schemes.accumulation
  const type = PHASE_SESSION_TYPE[schemePhase]
  const length = blockLength ?? scheme.length
  const slot = slotEntry(scheme.length, length, sessionIndexInBlock, heavySlots(schemePhase, scheme.length, length, program))
  const step = slot.step
  // A deload is light already: a deload week repeats its one session, never lighter still.
  const light = slot.light && schemePhase !== "deload"
  const entry = scheme[step]
  const base = schemeLoads(scheme, anchorWeight)[step] + loadOffset
  // Volume a cycle has earned goes on the heavy accumulation days; light days stay light.
  const extra = !light ? extraSetsAllowed(schemePhase, length, program) : 0
  return {
    weight: roundToPlate(light ? base * LIGHT_LOAD : base),
    reps: entry.reps,
    sets: entry.sets + extra,
    sessionType: type,
    rpe: entry.rpe === null ? null : light ? entry.rpe - LIGHT_RPE_DROP : entry.rpe,
    light,
  }
}

/** A session's main-lift work in one line, e.g. "90kg × 1, then 72.5kg × 6 × 4". */
export function describeLoad(rx: Prescription): string {
  const work = `${rx.weight}kg × ${rx.reps} × ${rx.sets}${rx.paused ? " paused" : ""}`
  return rx.topSet ? `${rx.topSet.weight}kg × ${rx.topSet.reps}, then ${work}` : work
}

/** The effort a session aims for, by the kind of day it is. Null where effort doesn't steer the load. */
export function effortTarget(rx: Prescription): string | null {
  if (rx.rpe == null) return null
  if (rx.topSet) return `Heavy day · single at RPE ${rx.topSet.rpe}, back-offs at RPE ${rx.rpe}`
  if (rx.paused) return `Light day · 3-second pause on the chest, aim for RPE ${rx.rpe}`
  if (rx.day === "medium") return `Medium day · aim for RPE ${rx.rpe}`
  return `${rx.light ? "Light day · aim" : "Aim"} for RPE ${rx.rpe}`
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
  block: Pick<TrainingBlock, "phase" | "rebuildLoads" | "anchorWeight" | "length"> &
    Partial<Pick<TrainingBlock, "switchSlot">> &
    BlockProgram,
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
  // A block that switched scheme part-way runs the rest of its slots as a block of their
  // own on the current scheme, so the new weeks start on a heavy day.
  const from = block.switchSlot != null && sessionIndexInBlock >= block.switchSlot ? block.switchSlot : 0
  const program = programOf(block)
  return prescribeBlockSession(
    block.phase,
    sessionIndexInBlock - from,
    block.anchorWeight,
    getBlockLength(block) - from,
    block.phase === "deload" ? 0 : loadOffset,
    block.switchSlot != null && from > 0 ? { ...program, schemeVersion: SCHEME_VERSION } : program
  )
}

/** The scheme fields of a block. One saved without a schemeVersion runs version 1. */
export function programOf(block: BlockProgram): BlockProgram {
  return {
    schemeVersion: block.schemeVersion ?? 1,
    repRange: block.repRange,
    extraSets: block.extraSets,
    cycleLength: block.cycleLength,
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
  const all = getAttemptedSets(session)
  if (all.length === 0) return offset
  // A heavy day's single is judged on its own target; the rest are its back-off sets.
  const { top: single, rest: attempted } = splitTopSet(rx, all)
  const working = attempted.filter((s) => s.reps > 0)
  const target = plannedReps ?? Math.max(1, ...working.map((s) => s.reps))
  // A set logged at 0 reps is a miss, the clearest one there is.
  const missed = attempted.some((s) => s.reps < target) || (single != null && single.reps === 0)
  const rpes = working.map((s) => s.rpe).filter((r): r is number => r != null)
  const top = rpes.length > 0 ? Math.max(...rpes) : null
  const singleRpe = rx.topSet && single != null && single.reps > 0 ? single.rpe : null
  const step = loadStep(anchorWeight)
  let next = offset
  if (missed) next -= step
  else if (!rx.light) {
    const margin = rx.reps >= HIGH_REPS ? EASY_RPE_MARGIN.highReps : EASY_RPE_MARGIN.lowReps
    const singleTarget = rx.topSet?.rpe ?? 0
    const tooHard =
      (top !== null && top - Math.max(rx.rpe, 7) >= 1) ||
      (singleRpe != null && singleRpe - Math.max(singleTarget, 7) >= 1)
    // A fast single counts as easy unless the back-offs ran over target.
    const easyByRpe =
      (top !== null && rx.rpe - top >= margin) ||
      (singleRpe != null && singleTarget - singleRpe >= EASY_RPE_MARGIN.lowReps && (top === null || top <= rx.rpe))
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

/**
 * A heavy day's sets split into its top single and the back-off sets after it. The single
 * is the first set, when it is heavier than the back-offs; a session logged without one is
 * all back-offs. Other days are all working sets.
 */
function splitTopSet<T extends { kg: number }>(rx: Prescription, sets: T[]): { top: T | null; rest: T[] } {
  if (!rx.topSet || sets.length === 0 || sets[0].kg <= rx.weight) return { top: null, rest: sets }
  return { top: sets[0], rest: sets.slice(1) }
}

/**
 * How far over (positive) or under its target RPE a session ran, by its hardest set. A
 * heavy day's single is held to the single's target and its back-offs to theirs. Null
 * when the session had no target or no rated set.
 */
export function effortAgainstTarget(rx: Prescription, session: Session): number | null {
  if (rx.rpe == null) return null
  const { top, rest } = splitTopSet(rx, session.sets.filter((x) => !x.isWarmup))
  const diffs = rest.filter((x) => x.rpe != null).map((x) => x.rpe! - rx.rpe!)
  if (top?.rpe != null && rx.topSet) diffs.push(top.rpe - rx.topSet.rpe)
  return diffs.length > 0 ? Math.max(...diffs) : null
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
export function createFirstBlock(
  id: number,
  anchorWeight: number,
  sessions: Session[],
  cycleLength: CycleLength = "standard"
): TrainingBlock {
  return {
    id,
    phase: "accumulation",
    status: "active",
    sessionIds: [],
    anchorWeight: roundToPlate(anchorWeight),
    startDate: null,
    endDate: null,
    length: blockLengthFor("accumulation", measureSessionsPerWeek(sessions, null), { cycleLength }),
    schemeVersion: SCHEME_VERSION,
    cycleLength,
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
  const cycleLength = completedBlock.cycleLength ?? "standard"
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
      // Another set only where the weekly cap leaves room for it at this cycle's frequency.
      const accLength = blockLengthFor("accumulation", perWeek, { cycleLength })
      const program: BlockProgram = { schemeVersion: SCHEME_VERSION, repRange, cycleLength, extraSets: extraSets + 1 }
      if (extraSets < MAX_EXTRA_SETS && extraSetsAllowed("accumulation", accLength, program) > extraSets) {
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
    length: blockLengthFor(phase, perWeek, { deloadWeek, cycleLength }),
    schemeVersion: SCHEME_VERSION,
    repRange,
    extraSets,
    stalls,
    ...(completedBlock.sessionsPerWeek != null ? { sessionsPerWeek: completedBlock.sessionsPerWeek } : {}),
    cycleLength,
    ...(review ? { review } : {}),
  }
}

/**
 * Moves blocks still running an older scheme onto the current one. A block that hasn't
 * started is re-planned outright, resized for Volume and Intensity to whole weeks. One
 * part-way through switches from its next slot (see TrainingBlock.switchSlot), so the
 * sessions already logged keep being read against what they were given. Finished blocks
 * are left alone. Null when nothing needed moving.
 */
export function migrateToCurrentScheme(blocks: TrainingBlock[], sessions: Session[]): TrainingBlock[] | null {
  let changed = false
  const next = blocks.map((b) => {
    if (b.status === "completed" || b.phase === "reacclimation") return b
    if ((b.schemeVersion ?? 1) >= SCHEME_VERSION || b.switchSlot != null) return b
    const position = blockPosition(b)
    if (position >= getBlockLength(b)) return b
    changed = true
    if (position > 0) return { ...b, switchSlot: position }
    const resized = v3Weeks(b.phase, undefined)
      ? {
          length: blockLengthFor(b.phase, b.sessionsPerWeek ?? measureSessionsPerWeek(sessions, null), {
            cycleLength: b.cycleLength,
          }),
        }
      : {}
    return { ...b, schemeVersion: SCHEME_VERSION, ...resized }
  })
  return changed ? next : null
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
