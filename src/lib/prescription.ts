import { Session, TrainingBlock, BlockPhase, SessionType } from "./types"
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

/** Volume and intensity both climb: reps per session go 32 → 40 before the loads take over. */
const ACCUMULATION_SCHEME: SchemeEntry[] = [
  { pct: 0.675, reps: 8, sets: 4, rpe: 6 },
  { pct: 0.700, reps: 8, sets: 4, rpe: 6.5 },
  { pct: 0.700, reps: 8, sets: 5, rpe: 7 },
  { pct: 0.725, reps: 7, sets: 5, rpe: 7 },
  { pct: 0.750, reps: 6, sets: 5, rpe: 7 },
  { pct: 0.775, reps: 6, sets: 5, rpe: 7.5 },
]

const TRANSMUTATION_SCHEME: SchemeEntry[] = [
  { pct: 0.800, reps: 5, sets: 4, rpe: 7.5 },
  { pct: 0.825, reps: 4, sets: 4, rpe: 7.5 },
  { pct: 0.850, reps: 3, sets: 4, rpe: 7.5 },
  { pct: 0.875, reps: 3, sets: 4, rpe: 8.5 },
]

/**
 * A taper into the test, not a second intensity block: doubles, then openers, then the
 * single. The single is the old max plus whatever the cycle showed (see cycleLoadOffset).
 */
const REALIZATION_SCHEME: SchemeEntry[] = [
  { pct: 0.900, reps: 2, sets: 3, rpe: 8.5 },
  { pct: 0.925, reps: 1, sets: 2, rpe: 8 },
  { pct: 1.000, reps: 1, sets: 1, rpe: 9.5 },
]

const DELOAD_SCHEME: SchemeEntry[] = [
  { pct: 0.600, reps: 5, sets: 3, rpe: null },
]

const PHASE_SCHEMES: Record<BlockPhase, SchemeEntry[]> = {
  accumulation: ACCUMULATION_SCHEME,
  transmutation: TRANSMUTATION_SCHEME,
  realization: REALIZATION_SCHEME,
  deload: DELOAD_SCHEME,
  // Re-acclimation is prescribed from the block's rebuildLoads, not a percentage scheme.
  reacclimation: [],
}

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

/** How long each phase runs, in weeks, and the fewest sessions it can be squeezed into. */
const PHASE_WEEKS: Record<BlockPhase, { weeks: number; min: number }> = {
  accumulation: { weeks: 2, min: 4 },
  transmutation: { weeks: 4 / 3, min: 3 },
  realization: { weeks: 1, min: 3 },
  deload: { weeks: 1 / 3, min: 1 },
  reacclimation: { weeks: 0, min: 0 },
}

/** Assumed when there isn't enough history to measure, and the pace the schemes are written for. */
export const DEFAULT_SESSIONS_PER_WEEK = 3

/** A light day is this share of the step it repeats. */
const LIGHT_LOAD = 0.85
const LIGHT_RPE_DROP = 2

/** Load nudges never take the cycle further than this from the anchor's own percentages. */
const MAX_OFFSET_PCT = 0.075
/** A new anchor moves at most this far from the old one in a single cycle. */
const MAX_ANCHOR_CHANGE = 0.05
/** Effort assumed for a completed realization set that was logged without an RPE. */
const ASSUMED_PEAK_RPE = 9

function getWorkingSets(session: Session) {
  return session.sets.filter((s) => !s.isWarmup && s.kg > 0 && s.reps > 0)
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

/** Sessions for a phase at a given benching frequency. */
export function blockLengthFor(phase: BlockPhase, sessionsPerWeek: number): number {
  const { weeks, min } = PHASE_WEEKS[phase]
  const perWeek = Math.min(6, Math.max(2, Math.round(sessionsPerWeek)))
  return Math.max(min, Math.round(weeks * perWeek))
}

/**
 * How often the user actually benches: main-lift sessions over the four weeks before
 * `asOf`. With under two weeks of history there is nothing to measure yet.
 */
export function measureSessionsPerWeek(sessions: Session[], asOf: string | null): number {
  const dated = sessions.filter((s) => s.confirmed && s.date && getWorkingSets(s).length > 0)
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

export function prescribeBlockSession(
  phase: BlockPhase,
  sessionIndexInBlock: number,
  anchorWeight: number,
  blockLength?: number,
  loadOffset = 0
): Prescription {
  // Fall back to accumulation for any phase without a percentage scheme
  // (e.g. reacclimation, which should go through prescribeForBlock instead).
  const scheme = PHASE_SCHEMES[phase]?.length ? PHASE_SCHEMES[phase] : ACCUMULATION_SCHEME
  const type = scheme === ACCUMULATION_SCHEME ? PHASE_SESSION_TYPE.accumulation : PHASE_SESSION_TYPE[phase]
  const { step, light } = slotEntry(scheme.length, blockLength ?? scheme.length, sessionIndexInBlock)
  const entry = scheme[step]
  const base = schemeLoads(scheme, anchorWeight)[step] + loadOffset
  return {
    weight: roundToPlate(light ? base * LIGHT_LOAD : base),
    reps: entry.reps,
    sets: entry.sets,
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
  block: Pick<TrainingBlock, "phase" | "rebuildLoads" | "anchorWeight" | "length">,
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
    block.phase === "deload" ? 0 : loadOffset
  )
}

/**
 * How one logged session moves the load for the sessions after it. Missed reps, or a
 * top set a full RPE over target, takes a step off; one at least 1.5 under adds a
 * step. Sets logged without an RPE say nothing about effort, only about missed reps.
 *
 * Far from failure RPE is a rough guess (an RPE 6 set gets called a 7 all the time), so
 * a top set only counts as too hard from RPE 8 up, and light days move the load only
 * on missed reps.
 */
function adjustOffset(offset: number, rx: Prescription, session: Session, anchorWeight: number, plannedReps: number | null): number {
  if (rx.rpe === null) return offset
  const working = getWorkingSets(session)
  if (working.length === 0) return offset
  const target = plannedReps ?? Math.max(...working.map((s) => s.reps))
  const missed = working.some((s) => s.reps < target)
  const rpes = working.map((s) => s.rpe).filter((r): r is number => r != null)
  const top = rpes.length > 0 ? Math.max(...rpes) : null
  const step = loadStep(anchorWeight)
  let next = offset
  if (missed) next -= step
  else if (top !== null && !rx.light) {
    if (top - Math.max(rx.rpe, 7) >= 1) next -= step
    else if (rx.rpe - top >= 1.5) next += step
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
    Partial<Pick<TrainingBlock, "sessionIds" | "skippedSlots" | "length" | "rebuildLoads">>
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

/**
 * After a realization block, the anchor for the next cycle: the best effort-adjusted
 * e1RM from the block's sets, so a fast single raises it by about what it showed and a
 * missed rep lowers it. A set logged without an RPE counts as RPE 9. The change is
 * held to 5% either way per cycle.
 */
export function deriveNextAnchor(completedRealizationBlock: TrainingBlock, sessions: Session[]): number {
  const anchor = completedRealizationBlock.anchorWeight
  const sets = sessions
    .filter((s) => s.confirmed && completedRealizationBlock.sessionIds.includes(s.id))
    .flatMap(getWorkingSets)
  if (sets.length === 0) return anchor

  let best = Math.max(...sets.map((s) => effortE1RM(s.kg, s.reps, s.rpe ?? ASSUMED_PEAK_RPE)))
  // Without the test itself, the doubles and openers can show the anchor was too low,
  // but taper work is no grounds for cutting it.
  const finalSlot = getBlockLength(completedRealizationBlock) - 1
  if (completedRealizationBlock.skippedSlots?.includes(finalSlot)) best = Math.max(best, anchor)

  const capped = Math.min(anchor * (1 + MAX_ANCHOR_CHANGE), Math.max(anchor * (1 - MAX_ANCHOR_CHANGE), best))
  // Down to the plate, never up: a max is what was shown, not a hair more.
  return Math.floor(capped / 2.5 + 1e-9) * 2.5
}

/** Factory for the next block after a completed one, sized to how often the user benches. */
export function createNextBlock(
  completedBlock: TrainingBlock,
  sessions: Session[],
  newId: number
): TrainingBlock {
  const phase = nextBlockPhase(completedBlock.phase)
  // Bump anchor only when finishing realization (before the deload between cycles)
  const anchor =
    completedBlock.phase === "realization"
      ? deriveNextAnchor(completedBlock, sessions)
      : completedBlock.anchorWeight

  return {
    id: newId,
    phase,
    status: "active",
    sessionIds: [],
    anchorWeight: anchor,
    startDate: null,
    endDate: null,
    length: blockLengthFor(phase, measureSessionsPerWeek(sessions, completedBlock.endDate)),
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
