/**
 * Shared builders and fast-check generators for the training-engine tests.
 *
 * `simulateProgram` drives the engine the way the app does: the active block's next
 * slot is prescribed from `cycleLoadOffset` + `prescribeForBlock`, the lifter logs a
 * session that deviates from it as the script says (or jumps over the slot), and a
 * block that runs out is closed with `closeBlock`, which builds the next one with
 * `createNextBlock`. Every generated history is therefore one the app could hold.
 */
import fc from "fast-check"
import type { CycleLength, MainLiftSet, Session, TrainingBlock } from "../types"
import {
  blockLengthFor,
  blockPosition,
  createFirstBlock,
  cycleLoadOffset,
  getBlockLength,
  prescribeForBlock,
  type Prescription,
} from "../prescription"
import { closeBlock } from "../jump"

// ─── Builders ─────────────────────────────────────────────────────────────────

let setSeq = 0

export function set(kg: number, reps: number, rpe: number | null = null, isWarmup = false): MainLiftSet {
  return { id: `s${++setSeq}`, kg, reps, rpe, e1rm: null, note: "", isWarmup }
}

const DAY = 86_400_000
const EPOCH = Date.UTC(2026, 0, 5, 17, 0, 0)

/** ISO timestamp `day` days after a fixed Monday, late afternoon UTC. */
export function dayIso(day: number): string {
  return new Date(EPOCH + day * DAY).toISOString()
}

export function session(id: number, day: number, sets: MainLiftSet[], extra: Partial<Session> = {}): Session {
  return {
    id,
    date: dayIso(day),
    type: "Volume",
    bw: null,
    sets,
    confirmed: true,
    coachNote: "",
    ...extra,
  }
}

export function block(partial: Partial<TrainingBlock> & Pick<TrainingBlock, "id" | "phase" | "anchorWeight">): TrainingBlock {
  return {
    status: "active",
    sessionIds: [],
    startDate: null,
    endDate: null,
    schemeVersion: 2,
    ...partial,
  }
}

/** A multiple of 2.5 that floating point represents exactly (everything here is). */
export function isPlate(kg: number): boolean {
  return Number.isFinite(kg) && Math.abs(kg / 2.5 - Math.round(kg / 2.5)) < 1e-9
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** A realistic peak: 20–300 kg on the plate. */
export const anchorArb = fc.integer({ min: 8, max: 120 }).map((k) => k * 2.5)
export const cycleLengthArb = fc.constantFrom<CycleLength>("short", "standard", "long")
export const perWeekArb = fc.integer({ min: 2, max: 6 })
/** RPE as the logger offers it: 5–10 in halves. */
export const rpeArb = fc.integer({ min: 10, max: 20 }).map((n) => n / 2)

/** How one logged set differs from what was prescribed. */
export interface SetScript {
  /** Plates (2.5 kg) over or under the prescribed load. */
  kgPlates: number
  /** Reps over or under the prescription; "miss" is a set logged at 0 reps. */
  reps: number | "miss"
  /** RPE relative to the target, or null when the set was logged without one. */
  rpe: number | null
}

/** A slot of the program: logged with these sets, or jumped over. */
export type SlotScript = { skip: true } | { skip: false; sets: SetScript[]; warmups: number }

export const setScriptArb: fc.Arbitrary<SetScript> = fc.record({
  kgPlates: fc.oneof({ weight: 6, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: -2, max: 2 }) }),
  reps: fc.oneof(
    { weight: 4, arbitrary: fc.constant(0) },
    { weight: 3, arbitrary: fc.integer({ min: -3, max: 3 }) },
    { weight: 1, arbitrary: fc.constant("miss" as const) }
  ),
  rpe: fc.oneof(
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 3, arbitrary: fc.integer({ min: -6, max: 4 }).map((n) => n / 2) }
  ),
})

export const slotScriptArb: fc.Arbitrary<SlotScript> = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ skip: true } as const) },
  {
    weight: 12,
    arbitrary: fc.record({
      skip: fc.constant(false as const),
      sets: fc.array(setScriptArb, { minLength: 1, maxLength: 7 }),
      warmups: fc.integer({ min: 0, max: 3 }),
    }),
  }
)

/** The working sets a script turns a prescription into. */
export function materialize(rx: Prescription, script: SetScript[], warmups = 0): MainLiftSet[] {
  const target = rx.rpe ?? 7
  const warm = Array.from({ length: warmups }, (_, i) => set(Math.max(20, rx.weight * (0.4 + 0.15 * i)), 5, null, true))
  return [
    ...warm,
    ...script.map((s) =>
      set(
        Math.max(2.5, rx.weight + s.kgPlates * 2.5),
        s.reps === "miss" ? 0 : Math.max(1, rx.reps + s.reps),
        s.rpe === null ? null : Math.min(10, Math.max(5, target + s.rpe))
      )
    ),
  ]
}

export interface ProgramSetup {
  anchor: number
  cycleLength: CycleLength
  perWeek: number
  /** Consumed one per slot until the program has run `cycles` deloads. */
  slots: SlotScript[]
}

export const programSetupArb = (maxSlots = 60): fc.Arbitrary<ProgramSetup> =>
  fc.record({
    anchor: anchorArb,
    cycleLength: cycleLengthArb,
    perWeek: perWeekArb,
    // Long enough, most of the time, to close a cycle or more at any length and frequency.
    slots: fc.array(slotScriptArb, { minLength: Math.ceil(maxSlots / 3), maxLength: maxSlots, size: "max" }),
  })

export interface LoggedSlot {
  blockId: number
  slot: number
  offset: number
  rx: Prescription
  sessionId: number
}

export interface ProgramRun {
  blocks: TrainingBlock[]
  sessions: Session[]
  /** Every prescription the lifter was given, in order, with the offset it carried. */
  logged: LoggedSlot[]
  /** Blocks in the order they were closed (a snapshot at the moment of closing). */
  closed: TrainingBlock[]
}

/**
 * Run the program for as many slots as the setup scripts. The first block is set up the
 * way the onboarding and cycle report leave it: the chosen frequency and length stored
 * on it, so every block after carries them.
 */
export function simulateProgram(setup: ProgramSetup): ProgramRun {
  const first = createFirstBlock(1, setup.anchor, [], setup.cycleLength)
  let blocks: TrainingBlock[] = [
    {
      ...first,
      sessionsPerWeek: setup.perWeek,
      length: blockLengthFor("accumulation", setup.perWeek, { cycleLength: setup.cycleLength }),
      setUp: true,
    },
  ]
  const sessions: Session[] = []
  const logged: LoggedSlot[] = []
  const closed: TrainingBlock[] = []
  let day = 0
  let nextSessionId = 1

  for (const script of setup.slots) {
    const active = blocks.find((b) => b.status === "active")!
    const slot = blockPosition(active)
    let updated: TrainingBlock
    if (script.skip) {
      updated = { ...active, skippedSlots: [...(active.skippedSlots ?? []), slot] }
    } else {
      const offset = cycleLoadOffset(blocks, sessions, active)
      const rx = prescribeForBlock(active, slot, offset)
      const id = nextSessionId++
      day += 1 + (id % 3 === 0 ? 1 : 0)
      sessions.push(session(id, day, materialize(rx, script.sets, script.warmups), { type: rx.sessionType, blockId: active.id }))
      logged.push({ blockId: active.id, slot, offset, rx, sessionId: id })
      updated = { ...active, sessionIds: [...active.sessionIds, id] }
    }
    if (blockPosition(updated) >= getBlockLength(updated)) {
      const done: TrainingBlock = { ...updated, status: "completed", endDate: dayIso(day) }
      closed.push(done)
      blocks = closeBlock(blocks, done, sessions)
    } else {
      blocks = blocks.map((b) => (b.id === updated.id ? updated : b))
    }
  }
  return { blocks, sessions, logged, closed }
}
