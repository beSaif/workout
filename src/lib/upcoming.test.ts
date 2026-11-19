import { describe, expect, it } from "vitest"
import fc from "fast-check"
import type { BlockPhase, MainLift, MainLiftSet, Session, TrainingAge, TrainingBlock, TrainingDay, UserProfile } from "./types"
import { MAIN_LIFT_SHORT } from "./types"
import {
  blockPosition,
  createFirstBlock,
  cycleLengthFor,
  cycleLoadOffset,
  getBlockLength,
  prescribeForBlock,
  SCHEME_VERSION,
} from "./prescription"
import { jumpToSession } from "./jump"
import { restartActiveBlock } from "./layoff"
import { suggestNextDay } from "./balance"
import { DEFAULT_MUSCLE_GROUPS, DEFAULT_TRAINING_DAYS } from "./exerciseConfig"
import {
  asLoggedSession,
  backfillMuscles,
  blocksAfterConfirm,
  blocksWithoutSession,
  countSkippedSlots,
  createUpcomingSession,
  describePrescription,
  getActiveBlock,
  removedMainLift,
  restoreMainLift,
  skipMainLift,
  slotLabel,
  sortSessions,
  upcomingMatchesMode,
} from "./upcoming"

// ─── The program, driven through the same calls Home makes ─────────────────────────────

const CONFIG = DEFAULT_MUSCLE_GROUPS
const DAY_MS = 86_400_000
const PHASES: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload", "reacclimation"]

interface World {
  profile: UserProfile
  trainingDays: TrainingDay[]
  blocks: TrainingBlock[]
  /** Logged sessions, oldest first. */
  confirmed: Session[]
  upcoming: Session
  now: Date
}

type Action =
  | { kind: "log"; repsDelta: number; rpe: number | null; gapDays: number }
  | { kind: "log-without-main"; gapDays: number }
  | { kind: "skip" }
  | { kind: "restore" }
  | { kind: "jump"; phase: BlockPhase; index: number }
  | { kind: "restart"; gapDays: number }

const later = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS)

function upcomingFor(w: Omit<World, "upcoming">): Session {
  return createUpcomingSession(w.confirmed, w.blocks, CONFIG, w.profile, w.trainingDays, w.now)
}

/** What the logger hands back for the upcoming card: the main lift as performed, plus an accessory. */
function performed(upcoming: Session, date: Date, repsDelta: number, rpe: number | null): Session {
  return {
    ...upcoming,
    confirmed: true,
    date: date.toISOString(),
    sets: upcoming.sets.map((s): MainLiftSet =>
      s.isWarmup ? s : { ...s, reps: Math.max(0, s.reps + repsDelta), rpe }
    ),
    extraWorkouts: [{ muscle: "back", exercises: [{ name: "Lat Pulldown", sets: [{ kg: 50, reps: 10, rpe: null }] }] }],
  }
}

/** What the logger hands back when the main lift was removed there: accessories only, no Skip on record. */
function performedWithoutMain(upcoming: Session, date: Date): Session {
  return { ...performed(upcoming, date, 0, null), sets: [] }
}

/** handleConfirmSession: the session is stored as asLoggedSession files it, then the block moves on (or not). */
function confirm(w: World, fromLogger: Session, gapDays: number): World {
  const logged = asLoggedSession(fromLogger, w.profile)
  const confirmed = [...w.confirmed, logged]
  const { blocks } = blocksAfterConfirm(w.blocks, logged, confirmed, w.profile)
  const now = later(w.now, gapDays)
  return { ...w, confirmed, blocks, now, upcoming: upcomingFor({ ...w, confirmed, blocks, now }) }
}

/** One user action, as Home's handlers carry it out. Actions the UI wouldn't offer are no-ops. */
function step(w: World, action: Action): World {
  switch (action.kind) {
    case "log":
      return confirm(w, performed(w.upcoming, w.now, action.repsDelta, action.rpe), action.gapDays)
    case "log-without-main":
      return confirm(w, performedWithoutMain(w.upcoming, w.now), action.gapDays)
    case "skip":
      // handleSkipMainLift: only offered on a card that still has its main lift
      if (w.upcoming.skippedMainLift) return w
      return { ...w, upcoming: skipMainLift(w.upcoming, w.profile) }
    case "restore":
      // handleRestoreMainLift
      if (!w.upcoming.skippedMainLift) return w
      return { ...w, upcoming: restoreMainLift(w.upcoming, w.confirmed, w.blocks, CONFIG, w.profile, w.trainingDays, w.now) }
    case "jump": {
      // handleJumpTo (the coach note's jump caution aside)
      const jumped = jumpToSession(w.blocks, w.confirmed, { phase: action.phase, index: action.index }, w.now.toISOString())
      if (!jumped) return w
      const regenerated = upcomingFor({ ...w, blocks: jumped })
      return {
        ...w,
        blocks: jumped,
        upcoming: {
          ...regenerated,
          id: w.upcoming.id,
          selectedTrainingDayId: w.upcoming.selectedTrainingDayId,
          selectedMuscleGroups: w.upcoming.selectedMuscleGroups,
        },
      }
    }
    case "restart": {
      // handleRestartBlock after a layoff
      if (!getActiveBlock(w.blocks)) return w
      const now = later(w.now, action.gapDays)
      const { sessions, blocks } = restartActiveBlock([...w.confirmed, w.upcoming], w.blocks)
      return { ...w, confirmed: sessions, blocks, now, upcoming: upcomingFor({ ...w, confirmed: sessions, blocks, now }) }
    }
  }
}

// ─── Generators ─────────────────────────────────────────────────────────────────────────

const plateKg = (min: number, max: number) =>
  fc.integer({ min: min / 2.5, max: max / 2.5 }).map((n) => n * 2.5)

const mainLiftArb = fc.constantFrom<MainLift>("bench", "deadlift", "squat")
const trainingAgeArb = fc.option(fc.constantFrom<TrainingAge>("new", "some", "years"), { nil: undefined })

/** Lift-focused, including profiles saved before the mode existed (no trainingMode at all). */
const liftProfileArb: fc.Arbitrary<UserProfile> = fc.record({
  email: fc.constant("sam@example.com"),
  name: fc.constant("Sam"),
  bw: fc.integer({ min: 50, max: 140 }),
  trainingMode: fc.constantFrom<UserProfile["trainingMode"]>("lift-focused", undefined),
  mainLift: mainLiftArb,
  anchor: plateKg(20, 250),
  target: plateKg(30, 300),
  trainingAge: trainingAgeArb,
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
})

const balancedProfileArb: fc.Arbitrary<UserProfile> = liftProfileArb.chain((p) =>
  fc.boolean().map((keepLift) => ({ ...p, trainingMode: "balanced" as const, mainLift: keepLift ? p.mainLift : undefined }))
)

const trainingDaysArb = fc.constantFrom<TrainingDay[]>(
  DEFAULT_TRAINING_DAYS,
  [{ id: "full", name: "Full body", order: 0, muscleGroupIds: ["chest", "back", "legs"] }],
  []
)

const startArb = fc
  .integer({ min: 0, max: 300 })
  .map((d) => new Date(Date.UTC(2026, 0, 5, 18) + d * DAY_MS))

/**
 * Where the program can start from: the block Home seeds for a new lift-focused user, no
 * block yet (before the first one is seeded), or a legacy re-acclimation detour still
 * stored from before that feature was retired.
 */
type Start = { kind: "seeded" } | { kind: "none" } | { kind: "reacclimation"; rebuildLoads: number[] }
const startKindArb: fc.Arbitrary<Start> = fc.oneof(
  { weight: 6, arbitrary: fc.constant<Start>({ kind: "seeded" }) },
  { weight: 1, arbitrary: fc.constant<Start>({ kind: "none" }) },
  {
    weight: 2,
    arbitrary: fc.array(plateKg(20, 200), { maxLength: 3 }).map((rebuildLoads): Start => ({ kind: "reacclimation", rebuildLoads })),
  }
)

function initialBlocks(start: Start, profile: UserProfile): TrainingBlock[] {
  const anchor = profile.anchor ?? 0
  const first = createFirstBlock(1, anchor, [], cycleLengthFor(profile.trainingAge))
  switch (start.kind) {
    case "none":
      return []
    case "seeded":
      return [first]
    case "reacclimation":
      return [
        { ...first, status: "interrupted" },
        {
          id: 2,
          phase: "reacclimation",
          status: "active",
          sessionIds: [],
          anchorWeight: first.anchorWeight,
          startDate: null,
          endDate: null,
          rebuildLoads: start.rebuildLoads,
          resumeBlockId: 1,
          schemeVersion: SCHEME_VERSION,
        },
      ]
  }
}

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.record({
      kind: fc.constant("log" as const),
      repsDelta: fc.integer({ min: -3, max: 2 }),
      rpe: fc.option(fc.integer({ min: 12, max: 20 }).map((n) => n / 2), { nil: null }),
      gapDays: fc.integer({ min: 1, max: 4 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant("log-without-main" as const), gapDays: fc.integer({ min: 1, max: 4 }) }),
  },
  { weight: 2, arbitrary: fc.constant<Action>({ kind: "skip" }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: "restore" }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("jump" as const),
      phase: fc.constantFrom(...PHASES),
      index: fc.integer({ min: 0, max: 8 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("restart" as const), gapDays: fc.integer({ min: 14, max: 40 }) }) }
)

/** A lift-focused world plus the actions that took it there, every intermediate state kept. */
const liftHistoryArb = fc
  .record({
    profile: liftProfileArb,
    trainingDays: trainingDaysArb,
    start: startKindArb,
    now: startArb,
    actions: fc.array(actionArb, { maxLength: 60, size: "max" }),
  })
  .map(({ profile, trainingDays, start, now, actions }) => {
    const base = { profile, trainingDays, blocks: initialBlocks(start, profile), confirmed: [] as Session[], now }
    const states: World[] = [{ ...base, upcoming: upcomingFor(base) }]
    for (const action of actions) states.push(step(states[states.length - 1], action))
    return states
  })

const last = <T>(xs: T[]) => xs[xs.length - 1]
const working = (s: Session) => s.sets.filter((set) => !set.isWarmup)

/** The logger opens with the main lift exactly when the card carries main-lift sets (buildDefaultOrder). */
const opensWithMainLift = (s: Session) => s.sets.length > 0

// ─── The Main Lift invariant ────────────────────────────────────────────────────────────

describe("Main Lift mode: the main lift opens every upcoming session", () => {
  it("holds in every reachable state unless the card was explicitly skipped", () => {
    fc.assert(
      fc.property(liftHistoryArb, (states) => {
        for (const w of states) {
          const u = w.upcoming
          expect(u.confirmed).toBe(false)
          expect(upcomingMatchesMode(u, w.profile)).toBe(true)

          if (u.skippedMainLift === true) {
            expect(u.type).toBe("Free")
            expect(u.sets).toEqual([])
            expect(u.blockId).toBeUndefined()
            continue
          }

          expect(opensWithMainLift(u)).toBe(true)
          expect(u.type).not.toBe("Free")
          const work = working(u)
          expect(work.length).toBeGreaterThan(0)
          // Warm-ups ramp into the working sets; nothing else is mixed in.
          const firstWork = u.sets.findIndex((s) => !s.isWarmup)
          expect(u.sets.slice(firstWork).every((s) => !s.isWarmup)).toBe(true)
          expect(new Set(work.map((s) => `${s.kg}x${s.reps}`)).size).toBe(1)
          expect(work[0].kg).toBeGreaterThan(0)

          // The load is the real engine's prescription for the active block's next slot.
          const active = getActiveBlock(w.blocks)
          expect(u.blockId).toBe(active?.id)
          if (active) {
            const rx = prescribeForBlock(active, blockPosition(active), cycleLoadOffset(w.blocks, w.confirmed, active))
            expect(u.type).toBe(rx.sessionType)
            expect(work).toHaveLength(rx.sets)
            expect(work[0]).toMatchObject({ kg: rx.weight, reps: rx.reps })
          }
        }
      })
    )
  })

  it("Skip Bench carries the prescribed main-lift load to the next session, however many times in a row", () => {
    fc.assert(
      fc.property(
        liftHistoryArb,
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 4 }),
        (states, gaps) => {
          let w = last(states)
          if (w.upcoming.skippedMainLift) w = step(w, { kind: "restore" })
          const held = w.upcoming
          const blocksBefore = w.blocks

          for (const gapDays of gaps) {
            w = step(w, { kind: "skip" })
            expect(w.upcoming.skippedMainLift).toBe(true)
            expect(describePrescription(held)).not.toBeNull()
            expect(w.upcoming.coachNote).toContain(describePrescription(held)!)
            // Log the accessories-only session.
            w = step(w, { kind: "log", repsDelta: 0, rpe: null, gapDays })

            const next = w.upcoming
            expect(next.skippedMainLift).toBeUndefined()
            expect(next.id).toBeGreaterThan(held.id)
            expect(next.type).toBe(held.type)
            expect(next.sets).toEqual(held.sets)
            expect(next.blockId).toBe(held.blockId)
            expect(next.coachNote).toBe(held.coachNote)
            expect(w.blocks).toEqual(blocksBefore)
          }
        }
      )
    )
  })

  it("a session logged with the main lift removed counts as a skip: the load carries over, the block stays put", () => {
    fc.assert(
      fc.property(
        liftHistoryArb,
        fc.array(fc.record({ viaSkip: fc.boolean(), gapDays: fc.integer({ min: 1, max: 4 }) }), { minLength: 1, maxLength: 4 }),
        (states, logs) => {
          let w = last(states)
          if (w.upcoming.skippedMainLift) w = step(w, { kind: "restore" })
          const held = w.upcoming
          const blocksBefore = w.blocks

          for (const { viaSkip, gapDays } of logs) {
            if (viaSkip) w = step(w, { kind: "skip" })
            w = step(w, { kind: "log-without-main", gapDays })

            // Filed exactly as a skipped session is, whichever way it got there.
            const logged = last(w.confirmed)
            expect(logged).toMatchObject({ type: "Free", sets: [], skippedMainLift: true, confirmed: true })
            expect(logged.blockId).toBeUndefined()
            expect(w.blocks.some((b) => b.sessionIds.includes(logged.id))).toBe(false)

            const next = w.upcoming
            expect(next.skippedMainLift).toBeUndefined()
            expect(next.id).toBeGreaterThan(held.id)
            expect(next.type).toBe(held.type)
            expect(next.sets).toEqual(held.sets)
            expect(next.blockId).toBe(held.blockId)
            expect(next.coachNote).toBe(held.coachNote)
            expect(w.blocks).toEqual(blocksBefore)
          }
        }
      )
    )
  })

  it("deadlift: removing the main lift and logging keeps Accumulation 1 on deck", () => {
    const profile: UserProfile = {
      email: "sam@example.com", name: "Sam", bw: 90, trainingMode: "lift-focused",
      mainLift: "deadlift", anchor: 100, target: 140, createdAt: "2026-01-01T00:00:00.000Z",
    }
    const now = new Date("2026-03-02T18:00:00.000Z")
    const blocks = [createFirstBlock(1, 100, [])]
    const upcoming = createUpcomingSession([], blocks, CONFIG, profile, DEFAULT_TRAINING_DAYS, now)
    expect(upcoming.coachNote).toMatch(/^\[Accumulation 1\/9\] 67\.5kg × 8 × 4\. Aim for RPE 6\./)

    const fromLogger = performedWithoutMain(upcoming, now)
    // Without the guard this joined the block and Accumulation 2 (67.5 × 8 × 5 @6.5) came next.
    const logged = asLoggedSession(fromLogger, profile)
    expect(logged).toEqual({ ...fromLogger, type: "Free", blockId: undefined, skippedMainLift: true })
    const { blocks: after, completed } = blocksAfterConfirm(blocks, logged, [logged], profile)
    expect(after).toBe(blocks)
    expect(after[0].sessionIds).toEqual([])
    expect(completed).toBeNull()
    // Even a caller that skips asLoggedSession doesn't advance the block.
    expect(blocksAfterConfirm(blocks, fromLogger, [fromLogger], profile).blocks).toBe(blocks)

    const next = createUpcomingSession([logged], after, CONFIG, profile, DEFAULT_TRAINING_DAYS, later(now, 2))
    expect(next.coachNote).toBe(upcoming.coachNote)
    expect(describePrescription(next)).toBe("67.5kg × 8 × 4")
    expect(next.blockId).toBe(1)
  })

  it("Restore puts back exactly the card that was skipped", () => {
    fc.assert(
      fc.property(liftHistoryArb, (states) => {
        let w = last(states)
        if (w.upcoming.skippedMainLift) w = step(w, { kind: "restore" })
        const before = w.upcoming
        const restored = step(step(w, { kind: "skip" }), { kind: "restore" }).upcoming
        expect(restored).toEqual(before)
      })
    )
  })

  it("removing the main lift from the session just logged ends exactly where logging it without would have", () => {
    fc.assert(
      fc.property(liftHistoryArb, fc.integer({ min: 1, max: 4 }), (states, gapDays) => {
        let w = last(states)
        if (w.upcoming.skippedMainLift) w = step(w, { kind: "restore" })

        // handleSaveEdit on the session just logged, its main lift removed.
        const logged = step(w, { kind: "log", repsDelta: 0, rpe: 8, gapDays })
        const original = last(logged.confirmed)
        const dropped = removedMainLift(original, { ...original, sets: [] })
        expect(dropped).not.toBeNull()
        const confirmed = [...logged.confirmed.slice(0, -1), dropped!.session]
        const blocks = blocksWithoutSession(logged.blocks, original)

        const without = step(w, { kind: "log-without-main", gapDays })
        expect(dropped!.session).toEqual(last(without.confirmed))
        expect(blocks).toEqual(without.blocks)
        expect(upcomingFor({ ...logged, confirmed, blocks })).toEqual(without.upcoming)
      })
    )
  })

  it("removedMainLift only fires when an edit takes every main-lift set out of a session that had them", () => {
    const profile: UserProfile = {
      email: "sam@example.com", name: "Sam", bw: 90, trainingMode: "lift-focused", mainLift: "bench",
      anchor: 100, target: 120, createdAt: "2026-01-01T00:00:00.000Z",
    }
    const now = new Date("2026-03-02T18:00:00.000Z")
    const card = createUpcomingSession([], [createFirstBlock(1, 100, [])], CONFIG, profile, DEFAULT_TRAINING_DAYS, now)
    const session = performed(card, now, 0, 8)
    expect(removedMainLift(session, { ...session, sets: session.sets.slice(1) })).toBeNull()
    const skipped: Session = { ...session, type: "Free", sets: [], blockId: undefined, skippedMainLift: true }
    expect(removedMainLift(session, { ...session, sets: [] })).toEqual({ session: skipped })
    expect(removedMainLift(skipped, skipped)).toBeNull()
  })

  it("blocksWithoutSession reopens the block a session just completed, and only unlinks an older one", () => {
    const block = (id: number, sessionIds: number[], status: TrainingBlock["status"]): TrainingBlock => ({
      ...createFirstBlock(id, 100, []), sessionIds, status, endDate: status === "completed" ? "2026-03-01" : null,
    })
    const s = (id: number, blockId?: number) => ({ id, blockId }) as Session
    // Session 3 completed block 1 and block 2 has nothing yet: block 1 reopens, block 2 goes.
    expect(blocksWithoutSession([block(1, [1, 2, 3], "completed"), block(2, [], "active")], s(3, 1))).toEqual([
      block(1, [1, 2], "active"),
    ])
    // Block 2 already holds training: block 1 only loses the session.
    expect(blocksWithoutSession([block(1, [1, 2, 3], "completed"), block(2, [4], "active")], s(2, 1))).toEqual([
      block(1, [1, 3], "completed"),
      block(2, [4], "active"),
    ])
    // A session outside any block changes nothing.
    const blocks = [block(1, [1], "active")]
    expect(blocksWithoutSession(blocks, s(9))).toBe(blocks)
  })

  it("logging the main lift moves the block on by exactly one slot", () => {
    fc.assert(
      fc.property(liftHistoryArb, (states) => {
        let w = last(states)
        if (w.upcoming.skippedMainLift) w = step(w, { kind: "restore" })
        const active = getActiveBlock(w.blocks)
        const logged = performed(w.upcoming, w.now, 0, null)
        expect(asLoggedSession(logged, w.profile)).toBe(logged)
        const confirmed = [...w.confirmed, logged]
        const { blocks, completed } = blocksAfterConfirm(w.blocks, logged, confirmed, w.profile)

        if (!active) {
          expect(blocks).toBe(w.blocks)
          return
        }
        const after = blocks.find((b) => b.id === active.id)!
        expect(after.sessionIds).toEqual([...active.sessionIds, logged.id])
        const filled = blockPosition(after) >= getBlockLength(active)
        expect(completed?.id ?? null).toBe(filled ? active.id : null)
        expect(after.status).toBe(filled ? "completed" : "active")
        // There is always a block to train next.
        expect(getActiveBlock(blocks)).toBeDefined()
      })
    )
  })

  it("the main lift is whichever lift the profile names: the card itself is lift-agnostic", () => {
    fc.assert(
      fc.property(liftHistoryArb, mainLiftArb, (states, other) => {
        const w = last(states)
        const relabelled = upcomingFor({ ...w, profile: { ...w.profile, mainLift: other } })
        expect(relabelled).toEqual(upcomingFor(w))
        // Only the wording of a skip names the lift.
        if (!w.upcoming.skippedMainLift) {
          expect(skipMainLift(w.upcoming, { mainLift: other }).coachNote).toMatch(new RegExp(`^${MAIN_LIFT_SHORT[other]} sat out today`))
        }
      })
    )
  })
})

// ─── Balanced mode and switching modes ──────────────────────────────────────────────────

describe("Balanced mode", () => {
  it("never prescribes a main lift and never touches the blocks", () => {
    fc.assert(
      fc.property(liftHistoryArb, balancedProfileArb, (states, balanced) => {
        const w = last(states)
        const u = createUpcomingSession(w.confirmed, w.blocks, CONFIG, balanced, w.trainingDays, w.now)
        expect(u.type).toBe("Free")
        expect(u.sets).toEqual([])
        expect(u.blockId).toBeUndefined()
        expect(u.skippedMainLift).toBeUndefined()
        expect(opensWithMainLift(u)).toBe(false)
        const day = suggestNextDay(w.confirmed, w.trainingDays, CONFIG, { now: w.now })?.day
        expect(u.selectedTrainingDayId).toBe(day?.id)
        expect(u.selectedMuscleGroups).toEqual(day?.muscleGroupIds ?? [])
        expect(upcomingMatchesMode(u, balanced)).toBe(true)

        const logged = { ...u, confirmed: true, date: w.now.toISOString() }
        // No main lift is expected in Balanced mode, so an empty one isn't a skip.
        expect(asLoggedSession(logged, balanced)).toBe(logged)
        const result = blocksAfterConfirm(w.blocks, logged, [...w.confirmed, logged], balanced)
        expect(result.blocks).toBe(w.blocks)
        expect(result.completed).toBeNull()
      })
    )
  })

  it("switching modes regenerates a stale card, and a switch back to Main Lift puts the lift first again", () => {
    fc.assert(
      fc.property(liftHistoryArb, balancedProfileArb, (states, balanced) => {
        const w = last(states)
        const lift = w.profile
        // What the load path does: keep the card if it matches the mode, else regenerate.
        const load = (card: Session, profile: UserProfile) =>
          upcomingMatchesMode(card, profile)
            ? card
            : createUpcomingSession(w.confirmed, w.blocks, CONFIG, profile, w.trainingDays, w.now)

        const inBalanced = load(w.upcoming, balanced)
        expect(inBalanced.type).toBe("Free")
        expect(inBalanced === w.upcoming).toBe(w.upcoming.skippedMainLift === true)

        const backInLift = load(inBalanced, lift)
        if (backInLift.skippedMainLift) {
          expect(backInLift).toBe(w.upcoming)
        } else {
          expect(opensWithMainLift(backInLift)).toBe(true)
          expect(backInLift.sets).toEqual(upcomingFor(w).sets)
        }
      })
    )
  })
})

describe("upcomingMatchesMode", () => {
  const lift = { email: "a@example.com", name: "A", bw: 80, mainLift: "bench", anchor: 100, createdAt: "" } as UserProfile
  const legacy = { ...lift, trainingMode: undefined }
  const balanced = { ...lift, trainingMode: "balanced" } as UserProfile
  const card = (type: Session["type"], skippedMainLift?: boolean): Session => ({
    id: 1, date: null, type, bw: null, sets: [], confirmed: false, coachNote: "", ...(skippedMainLift ? { skippedMainLift } : {}),
  })

  it.each([
    ["no card → regenerate", undefined, lift, false],
    ["no card (Balanced) → regenerate", undefined, balanced, false],
    ["prescribed card, Main Lift → keep", card("Volume"), lift, true],
    ["prescribed card, legacy profile → keep", card("Intensity"), legacy, true],
    ["Free card, Main Lift → regenerate", card("Free"), lift, false],
    ["skipped card, Main Lift → keep", card("Free", true), lift, true],
    ["Free card, Balanced → keep", card("Free"), balanced, true],
    ["prescribed card, Balanced → regenerate", card("Peak"), balanced, false],
    ["skipped card, Balanced → keep", card("Free", true), balanced, true],
  ] as const)("%s", (_, upcoming, profile, expected) => {
    expect(upcomingMatchesMode(upcoming, profile)).toBe(expected)
  })
})

// ─── Smaller helpers ────────────────────────────────────────────────────────────────────

describe("helpers", () => {
  const set = (kg: number, reps: number, isWarmup = false): MainLiftSet => ({
    id: isWarmup ? "W" : "S", kg, reps, rpe: null, e1rm: null, note: "", isWarmup,
  })
  const session = (over: Partial<Session>): Session => ({
    id: 1, date: null, type: "Volume", bw: null, sets: [], confirmed: false, coachNote: "", ...over,
  })

  it("slotLabel names a slot the way the program does", () => {
    expect(slotLabel("accumulation", 0)).toBe("Volume 1")
    expect(slotLabel("transmutation", 2)).toBe("Intensity 3")
    expect(slotLabel("realization", 1)).toBe("Peak 2")
    expect(slotLabel("deload", 0)).toBe("Deload 1")
    expect(slotLabel("reacclimation", 1)).toMatch(/ 2$/)
  })

  it("countSkippedSlots adds up jumped-over slots across blocks", () => {
    const b = (skippedSlots?: number[]) => ({ ...createFirstBlock(1, 100, []), skippedSlots })
    expect(countSkippedSlots([])).toBe(0)
    expect(countSkippedSlots([b(), b([0, 1]), b([3])])).toBe(3)
  })

  it("describePrescription reads the first working set and counts the working sets", () => {
    expect(describePrescription(session({ sets: [set(40, 5, true), set(62.5, 6), set(62.5, 6), set(62.5, 6)] }))).toBe("62.5kg × 6 × 3")
    expect(describePrescription(session({ sets: [set(40, 5, true)] }))).toBeNull()
    expect(describePrescription(session({ sets: [] }))).toBeNull()
  })

  it("sortSessions puts the upcoming card first, then newest first", () => {
    const a = session({ id: 1, confirmed: true, date: "2026-03-01T10:00:00.000Z" })
    const b = session({ id: 2, confirmed: true, date: "2026-03-05T10:00:00.000Z" })
    const up = session({ id: 3 })
    const input = [a, up, b]
    expect(sortSessions(input).map((s) => s.id)).toEqual([3, 2, 1])
    expect(input.map((s) => s.id)).toEqual([1, 3, 2])
  })

  it("backfillMuscles fills only an upcoming card that has no muscle groups yet", () => {
    const now = new Date("2026-03-10T12:00:00.000Z")
    const logged = session({ id: 1, confirmed: true, date: "2026-03-09T10:00:00.000Z", selectedTrainingDayId: "day-a", selectedMuscleGroups: ["back", "triceps"] })
    const bare = session({ id: 2 })
    const filled = backfillMuscles([logged, bare], CONFIG, DEFAULT_TRAINING_DAYS, now)
    const day = suggestNextDay([logged, bare], DEFAULT_TRAINING_DAYS, CONFIG, { now })!.day
    expect(filled[0]).toBe(logged)
    expect(filled[1]).toMatchObject({ selectedTrainingDayId: day.id, selectedMuscleGroups: day.muscleGroupIds })

    const alreadySet = [logged, session({ id: 2, selectedMuscleGroups: [] })]
    expect(backfillMuscles(alreadySet, CONFIG, DEFAULT_TRAINING_DAYS, now)).toBe(alreadySet)
    const noUpcoming = [logged]
    expect(backfillMuscles(noUpcoming, CONFIG, DEFAULT_TRAINING_DAYS, now)).toBe(noUpcoming)
  })

  it("skipMainLift keeps the card's id and day but drops the lift and leaves the block", () => {
    const card = session({
      id: 7, blockId: 3, selectedTrainingDayId: "day-b", selectedMuscleGroups: ["chest"],
      sets: [set(40, 5, true), set(80, 5), set(80, 5)],
    })
    expect(skipMainLift(card, { mainLift: "squat" })).toEqual({
      ...card,
      type: "Free",
      sets: [],
      blockId: undefined,
      skippedMainLift: true,
      coachNote: "Squat sat out today — 80kg × 5 × 2 moves to the next session. Everything else, full effort.",
    })
    expect(skipMainLift(session({}), null).coachNote).toBe("Main lift sat out today — its load moves to the next session.")
  })

  it("createUpcomingSession numbers the card after the highest id logged", () => {
    const profile = { email: "a@example.com", name: "A", bw: 80, mainLift: "bench", anchor: 100, createdAt: "" } as UserProfile
    const logged = [5, 2, 9].map((id) => session({ id, confirmed: true, date: "2026-03-01T10:00:00.000Z" }))
    expect(createUpcomingSession(logged, [], CONFIG, profile).id).toBe(10)
    expect(createUpcomingSession([], [], CONFIG, profile).id).toBe(1)
  })
})
