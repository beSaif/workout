import { describe, expect, it } from "vitest"
import fc from "fast-check"
import type { BlockPhase, Session, TrainingBlock } from "./types"
import { roundToPlate } from "./e1rm"
import {
  MAX_EXTRA_SETS,
  blockLengthFor,
  createNextBlock,
  cycleLengthFor,
  cycleLoadOffset,
  deriveNextAnchor,
  getBlockLength,
  loadStep,
  measureSessionsPerWeek,
  prescribeForBlock,
  reviewCycle,
  type BlockProgram,
} from "./prescription"
import {
  anchorArb,
  block,
  cycleLengthArb,
  isPlate,
  perWeekArb,
  programSetupArb,
  rpeArb,
  session,
  set,
  simulateProgram,
} from "./__tests__/training"

const RUNS = { numRuns: 150 }
const SIM_RUNS = { numRuns: 120 }

/** The farthest the doc lets the in-cycle offset go: 7.5% of the peak, to the nearest plate. */
const offsetLimit = (anchor: number) => 0.075 * anchor + 1.25
const WEEKS: Record<string, Partial<Record<BlockPhase, number>>> = {
  short: { accumulation: 2, transmutation: 1, realization: 1 },
  standard: { accumulation: 3, transmutation: 2, realization: 1 },
  long: { accumulation: 4, transmutation: 3, realization: 1 },
}

const programArb: fc.Arbitrary<BlockProgram> = fc.record({
  schemeVersion: fc.constantFrom(1, 2),
  repRange: fc.constantFrom("moderate" as const, "heavy" as const),
  extraSets: fc.integer({ min: 0, max: MAX_EXTRA_SETS }),
  cycleLength: cycleLengthArb,
})

/** A block as `createNextBlock` would size it, plus the offset a cycle could carry into it. */
const plannedBlockArb = fc
  .record({
    phase: fc.constantFrom<BlockPhase>("accumulation", "transmutation", "realization", "deload"),
    anchor: anchorArb,
    perWeek: perWeekArb,
    program: programArb,
    offsetSteps: fc.integer({ min: -3, max: 3 }),
  })
  .map(({ phase, anchor, perWeek, program, offsetSteps }) => {
    const b = block({
      id: 1,
      phase,
      anchorWeight: anchor,
      ...program,
      length: blockLengthFor(phase, perWeek, { cycleLength: program.cycleLength }),
    })
    const offset = Math.max(-roundToPlate(anchor * 0.075), Math.min(roundToPlate(anchor * 0.075), offsetSteps * loadStep(anchor)))
    return { block: b, anchor, perWeek, offset }
  })

const allSlots = (b: TrainingBlock, offset = 0) =>
  Array.from({ length: getBlockLength(b) }, (_, i) => prescribeForBlock(b, i, offset))

// ─── Prescribed loads ─────────────────────────────────────────────────────────

describe("prescribed loads", () => {
  it("are always on the plate (multiples of 2.5 kg) and positive", () => {
    fc.assert(
      fc.property(plannedBlockArb, ({ block: b, offset }) => {
        for (const rx of allSlots(b, offset)) {
          expect(isPlate(rx.weight)).toBe(true)
          expect(rx.weight).toBeGreaterThan(0)
          expect(rx.reps).toBeGreaterThan(0)
          expect(rx.sets).toBeGreaterThan(0)
        }
      }),
      RUNS
    )
  })

  it("re-acclimation loads are on the plate whatever rebuild loads were stored", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 10, max: 300, noNaN: true }), { minLength: 1, maxLength: 6 }), (loads) => {
        const b = block({ id: 1, phase: "reacclimation", anchorWeight: 100, rebuildLoads: loads })
        expect(getBlockLength(b)).toBe(loads.length)
        for (let i = 0; i < loads.length + 2; i++) expect(isPlate(prescribeForBlock(b, i, 7.5).weight)).toBe(true)
      }),
      RUNS
    )
  })

  it("a heavier peak or a bigger offset never prescribes a lighter session", () => {
    fc.assert(
      fc.property(plannedBlockArb, fc.integer({ min: 1, max: 8 }), ({ block: b, offset }, plates) => {
        const heavier = { ...b, anchorWeight: b.anchorWeight + plates * 2.5 }
        const base = allSlots(b, offset)
        allSlots(heavier, offset).forEach((rx, i) => expect(rx.weight).toBeGreaterThanOrEqual(base[i].weight))
        allSlots(b, offset + 2.5).forEach((rx, i) => expect(rx.weight).toBeGreaterThanOrEqual(base[i].weight))
      }),
      RUNS
    )
  })

  it("every load is a percentage of the peak: the realization block ends on the single at peak + offset", () => {
    fc.assert(
      fc.property(plannedBlockArb, ({ block: b, offset }) => {
        const real = { ...b, phase: "realization" as const, length: Math.max(3, b.length ?? 3) }
        const last = prescribeForBlock(real, getBlockLength(real) - 1, offset)
        expect(last).toMatchObject({ reps: 1, sets: 1, sessionType: "Peak", light: false, weight: real.anchorWeight + offset })
        // Nothing in the cycle is heavier than the single it builds to.
        for (const phase of ["accumulation", "transmutation", "realization"] as const) {
          for (const rx of allSlots({ ...real, phase, length: blockLengthFor(phase, 3) }, offset)) {
            expect(rx.weight).toBeLessThanOrEqual(last.weight)
          }
        }
      }),
      RUNS
    )
  })

  it("heavy days climb through a block: the load never drops from one heavy day to the next", () => {
    fc.assert(
      fc.property(plannedBlockArb, ({ block: b, offset }) => {
        const heavy = allSlots(b, offset).filter((rx) => !rx.light)
        for (let i = 1; i < heavy.length; i++) expect(heavy[i].weight).toBeGreaterThanOrEqual(heavy[i - 1].weight)
      }),
      RUNS
    )
  })

  it("the deload ignores the cycle's offset and prescribes 60% of the peak", () => {
    fc.assert(
      fc.property(anchorArb, perWeekArb, fc.boolean(), fc.integer({ min: -3, max: 3 }), (anchor, perWeek, week, steps) => {
        const d = block({ id: 1, phase: "deload", anchorWeight: anchor, length: blockLengthFor("deload", perWeek, { deloadWeek: week }) })
        for (const rx of allSlots(d, steps * 2.5)) {
          expect(rx).toMatchObject({ weight: roundToPlate(anchor * 0.6), sessionType: "Deload", rpe: null, light: false })
        }
      }),
      RUNS
    )
  })
})

// ─── Cycle shape ──────────────────────────────────────────────────────────────

describe("cycle shape", () => {
  it("first cycle length follows training age", () => {
    expect(cycleLengthFor("new")).toBe("short")
    expect(cycleLengthFor("some")).toBe("standard")
    expect(cycleLengthFor("years")).toBe("long")
    expect(cycleLengthFor(undefined)).toBe("standard")
  })

  it("sessions per phase are weeks × days a week: standard at three a week is 9 + 6 + 3 + 1", () => {
    const at3 = (cycleLength: "short" | "standard" | "long") =>
      (["accumulation", "transmutation", "realization", "deload"] as const).map((p) => blockLengthFor(p, 3, { cycleLength }))
    expect(at3("short")).toEqual([6, 3, 3, 1])
    expect(at3("standard")).toEqual([9, 6, 3, 1])
    expect(at3("long")).toEqual([12, 9, 3, 1])
  })

  it("at standard and three a week, each session is its own scheme step", () => {
    for (const phase of ["accumulation", "transmutation", "realization"] as const) {
      const b = block({ id: 1, phase, anchorWeight: 100, length: blockLengthFor(phase, 3) })
      const steps = allSlots(b).map((rx) => `${rx.weight}x${rx.reps}x${rx.sets}`)
      expect(new Set(steps).size).toBe(steps.length)
    }
  })

  it("a block's length tracks weeks × frequency, never under its minimum", () => {
    fc.assert(
      fc.property(cycleLengthArb, perWeekArb, fc.constantFrom("accumulation", "transmutation", "realization") as fc.Arbitrary<BlockPhase>, (cl, perWeek, phase) => {
        const len = blockLengthFor(phase, perWeek, { cycleLength: cl })
        const planned = WEEKS[cl][phase]! * perWeek
        expect(len).toBeGreaterThanOrEqual(Math.round(planned))
        expect(len).toBeGreaterThanOrEqual(3)
      }),
      RUNS
    )
  })

  it("under four sessions a week every session is heavy", () => {
    fc.assert(
      fc.property(plannedBlockArb.filter(({ perWeek }) => perWeek < 4), ({ block: b }) => {
        expect(allSlots({ ...b, schemeVersion: 2 }).every((rx) => !rx.light)).toBe(true)
      }),
      RUNS
    )
  })

  it("from four a week, light days are 85% of the heavy day before, never two together, heavy days about three a week", () => {
    fc.assert(
      fc.property(
        plannedBlockArb.filter(({ perWeek, block: b }) => perWeek >= 4 && b.phase !== "deload"),
        ({ block: b, perWeek, offset }) => {
          const v2 = { ...b, schemeVersion: 2 }
          const slots = allSlots(v2, offset)
          expect(slots[0].light).toBe(false)
          expect(slots[slots.length - 1].light).toBe(false)
          slots.forEach((rx, i) => {
            if (!rx.light) return
            expect(slots[i - 1].light).toBe(false)
            expect(rx.weight).toBe(roundToPlate(slots[i - 1].weight * 0.85))
            expect(rx.reps).toBe(slots[i - 1].reps)
          })
          const weeks = WEEKS[v2.cycleLength ?? "standard"][v2.phase]!
          const heavy = slots.filter((rx) => !rx.light).length
          expect(heavy).toBeGreaterThanOrEqual(Math.min(slots.length, Math.floor(3 * weeks)))
          if (perWeek >= 4 && slots.length / weeks >= 4) expect(heavy).toBeLessThan(slots.length)
        }
      ),
      RUNS
    )
  })

  it("deload weeks repeat one session and have no light days", () => {
    fc.assert(
      fc.property(anchorArb, perWeekArb, (anchor, perWeek) => {
        const d = block({ id: 1, phase: "deload", anchorWeight: anchor, length: blockLengthFor("deload", perWeek, { deloadWeek: true }) })
        const slots = allSlots(d)
        expect(slots.length).toBeGreaterThanOrEqual(2)
        expect(new Set(slots.map((rx) => JSON.stringify(rx))).size).toBe(1)
      }),
      RUNS
    )
  })

  it("earned extra sets go on heavy Volume days only, at most two, under 20 heavy sets a week", () => {
    fc.assert(
      fc.property(anchorArb, perWeekArb, cycleLengthArb, fc.constantFrom("moderate" as const, "heavy" as const), fc.integer({ min: 0, max: MAX_EXTRA_SETS }), (anchor, perWeek, cl, repRange, extraSets) => {
        const length = blockLengthFor("accumulation", perWeek, { cycleLength: cl })
        const base = block({ id: 1, phase: "accumulation", anchorWeight: anchor, length, cycleLength: cl, repRange, extraSets: 0 })
        const plain = allSlots(base)
        const extra = allSlots({ ...base, extraSets })
        let heavySets = 0
        extra.forEach((rx, i) => {
          const added = rx.sets - plain[i].sets
          if (rx.light) expect(added).toBe(0)
          expect(added).toBeGreaterThanOrEqual(0)
          expect(added).toBeLessThanOrEqual(extraSets)
          if (!rx.light) heavySets += rx.sets
        })
        expect(heavySets / WEEKS[cl].accumulation!).toBeLessThan(20)
      }),
      RUNS
    )
  })

  it("measured frequency is a whole number of days from 2 to 6, and 3 without two weeks of history", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 120 }), { maxLength: 40 }), (days) => {
        const sessions = days.map((d, i) => session(i + 1, d, [set(100, 5)]))
        const n = measureSessionsPerWeek(sessions, null)
        expect(Number.isInteger(n)).toBe(true)
        expect(n).toBeGreaterThanOrEqual(2)
        expect(n).toBeLessThanOrEqual(6)
        const span = days.length ? Math.max(...days) - Math.min(...days) : 0
        if (span < 14) expect(n).toBe(3)
      }),
      RUNS
    )
  })
})

// ─── Within a cycle ───────────────────────────────────────────────────────────

describe("load step", () => {
  it("is 2.5% of the peak to the nearest plate, never under 2.5 kg", () => {
    expect(loadStep(60)).toBe(2.5)
    expect(loadStep(100)).toBe(2.5)
    expect(loadStep(200)).toBe(5)
    fc.assert(
      fc.property(anchorArb, (anchor) => {
        const step = loadStep(anchor)
        expect(isPlate(step)).toBe(true)
        expect(step).toBeGreaterThanOrEqual(2.5)
        expect(Math.abs(step - anchor * 0.025)).toBeLessThanOrEqual(Math.max(1.25, 2.5 - anchor * 0.025))
      }),
      RUNS
    )
  })
})

/** One accumulation block on a 100 kg peak, three a week, with the given sessions logged in order. */
function offsetAfter(sessions: Session[], anchor = 100, phase: BlockPhase = "accumulation"): number {
  const b = block({ id: 1, phase, anchorWeight: anchor, length: blockLengthFor(phase, 3), sessionIds: sessions.map((s) => s.id) })
  return cycleLoadOffset([b], sessions, b)
}

/** Sessions that log exactly what was prescribed, each RPE shifted by `rpeShift` (null: unrated). */
function onPlan(anchor: number, phase: BlockPhase, count: number, rpeShift: number | null = 0, repShift = 0): Session[] {
  const b = block({ id: 1, phase, anchorWeight: anchor, length: blockLengthFor(phase, 3) })
  const out: Session[] = []
  for (let i = 0; i < count; i++) {
    const offset = cycleLoadOffset([{ ...b, sessionIds: out.map((s) => s.id) }], out, { ...b, sessionIds: out.map((s) => s.id) })
    const rx = prescribeForBlock(b, i, offset)
    const rpe = rpeShift === null || rx.rpe === null ? null : Math.min(10, rx.rpe + rpeShift)
    out.push(session(i + 1, i * 2, Array.from({ length: rx.sets }, () => set(rx.weight, rx.reps + repShift, rpe))))
  }
  return out
}

describe("the in-cycle offset", () => {
  it("doesn't move for sessions that go exactly to plan, rated or not", () => {
    for (const phase of ["accumulation", "transmutation", "realization"] as const) {
      expect(offsetAfter(onPlan(100, phase, 3, 0), 100, phase)).toBe(0)
      expect(offsetAfter(onPlan(100, phase, 3, null), 100, phase)).toBe(0)
    }
  })

  it("comes down a step on missed reps, a step per session, and stops at 7.5%", () => {
    const missed = onPlan(100, "accumulation", 5, 0, -1)
    expect(missed.slice(0, 4).map((_, i) => offsetAfter(missed.slice(0, i + 1)))).toEqual([-2.5, -5, -7.5, -7.5])
  })

  it("comes down on a top set a full RPE over target, but only from RPE 8", () => {
    expect(offsetAfter(onPlan(100, "transmutation", 1, 1), 100, "transmutation")).toBe(-2.5) // 7.5 → 8.5
    // The first Volume step is planned at RPE 6: a 7 is a guess, an 8 is real.
    const first = (rpe: number) => offsetAfter([session(1, 0, [set(67.5, 8, rpe), set(67.5, 8, rpe), set(67.5, 8, rpe), set(67.5, 8, rpe)])])
    expect(first(7)).toBe(0)
    expect(first(7.5)).toBe(0)
    expect(first(8)).toBe(-2.5)
  })

  it("goes up on a top set 1.5 under target at six reps and up, 1 under at five and fewer", () => {
    // Volume step 3 (70% × 8 @ 7): 5.5 is easy, 6 is not.
    const vol = (rpe: number) => offsetAfter(onPlan(100, "accumulation", 2).concat(session(3, 5, Array.from({ length: 5 }, () => set(70, 8, rpe)))))
    expect(vol(5.5)).toBe(2.5)
    expect(vol(6)).toBe(0)
    // Intensity step 1 (80% × 5 @ 7.5): 6.5 is easy.
    const int = (rpe: number) => offsetAfter([session(1, 0, Array.from({ length: 4 }, () => set(80, 5, rpe)))], 100, "transmutation")
    expect(int(6.5)).toBe(2.5)
    expect(int(7)).toBe(0)
  })

  it("goes up when every set beats its reps by two, RPE or not", () => {
    expect(offsetAfter(onPlan(100, "accumulation", 1, null, 2))).toBe(2.5)
    expect(offsetAfter(onPlan(100, "accumulation", 1, null, 1))).toBe(0)
  })

  it("a Peak-block session that came in harder than planned scales the single down", () => {
    const b = block({ id: 1, phase: "realization", anchorWeight: 100, length: 3 })
    const rx = prescribeForBlock(b, 0)
    expect(rx).toMatchObject({ weight: 90, reps: 2, rpe: 8.5 })
    const doubles = (rpe: number) => session(1, 0, Array.from({ length: rx.sets }, () => set(90, 2, rpe)))
    // Half an RPE over isn't "a full RPE over", but the e1RM it shows is 1.5% under plan:
    // 98.5 to the plate is 97.5.
    expect(offsetAfter([doubles(9)], 100, "realization")).toBe(-2.5)
    // At RPE 10 the doubles show 4.3% under plan: the single drops 5, more than one step.
    expect(offsetAfter([doubles(10)], 100, "realization")).toBe(-5)
  })

  it("steps are 2.5% of the peak: 5 kg at a 200 kg peak", () => {
    expect(offsetAfter(onPlan(200, "accumulation", 1, 0, -1), 200)).toBe(-5)
  })

  it("stays within 7.5% of the peak (to the plate) and on the plate, whatever is logged", () => {
    fc.assert(
      fc.property(programSetupArb(60), (setup) => {
        const run = simulateProgram(setup)
        for (const l of run.logged) {
          const anchor = run.blocks.find((b) => b.id === l.blockId)!.anchorWeight
          expect(isPlate(l.offset)).toBe(true)
          expect(Math.abs(l.offset)).toBeLessThanOrEqual(offsetLimit(anchor))
          expect(isPlate(l.rx.weight)).toBe(true)
        }
      }),
      SIM_RUNS
    )
  })

  it("one Volume or Intensity session moves it by at most one step, and a session with a miss never raises it", () => {
    fc.assert(
      fc.property(programSetupArb(40), (setup) => {
        const run = simulateProgram(setup)
        const byId = new Map(run.sessions.map((s) => [s.id, s]))
        for (const b of run.blocks) {
          if (b.phase !== "accumulation" && b.phase !== "transmutation") continue
          const step = loadStep(b.anchorWeight)
          let ids: number[] = []
          let prev = cycleLoadOffset(run.blocks, run.sessions, { ...b, sessionIds: ids })
          for (const id of b.sessionIds) {
            ids = [...ids, id]
            const next = cycleLoadOffset(run.blocks, run.sessions, { ...b, sessionIds: ids })
            expect(Math.abs(next - prev)).toBeLessThanOrEqual(step)
            if (byId.get(id)!.sets.some((s) => !s.isWarmup && s.reps === 0)) expect(next).toBeLessThanOrEqual(prev)
            prev = next
          }
        }
      }),
      SIM_RUNS
    )
  })

  it("starts again at zero each cycle: nothing logged before the last deload counts", () => {
    fc.assert(
      fc.property(programSetupArb(80), (setup) => {
        const run = simulateProgram(setup)
        const active = run.blocks.find((b) => b.status === "active")!
        const lastDeload = Math.max(0, ...run.blocks.filter((b) => b.phase === "deload" && b.id < active.id).map((b) => b.id))
        const oldBlocks = new Set(run.blocks.filter((b) => b.id <= lastDeload).map((b) => b.id))
        // Rewrite every earlier cycle's session as a string of misses.
        const rewritten = run.sessions.map((s) =>
          oldBlocks.has(s.blockId!) ? { ...s, sets: s.sets.map((x) => ({ ...x, reps: 0, rpe: 10 })) } : s
        )
        expect(cycleLoadOffset(run.blocks, rewritten, active)).toBe(cycleLoadOffset(run.blocks, run.sessions, active))
        // The first Volume session after a deload carries no offset.
        for (const l of run.logged) {
          const b = run.blocks.find((x) => x.id === l.blockId)!
          if (b.phase === "deload" || (b.phase === "accumulation" && l.slot === 0 && (b.skippedSlots ?? []).length === 0)) {
            expect(l.offset).toBe(0)
          }
        }
      }),
      SIM_RUNS
    )
  })

  it("is replayed from the logs: deterministic, independent of storage order, blind to unconfirmed sessions", () => {
    fc.assert(
      fc.property(programSetupArb(50), fc.integer(), (setup, seed) => {
        const run = simulateProgram(setup)
        const active = run.blocks.find((b) => b.status === "active")!
        const offset = cycleLoadOffset(run.blocks, run.sessions, active)
        expect(cycleLoadOffset(run.blocks, run.sessions, active)).toBe(offset)
        const shuffled = shuffle(run.sessions, seed)
        // The order a block lists its sessions in says nothing: they are replayed by date.
        const reordered = run.blocks.map((b) => ({ ...b, sessionIds: shuffle(b.sessionIds, seed) }))
        expect(cycleLoadOffset(reordered, shuffled, reordered.find((b) => b.id === active.id)!)).toBe(offset)
        const drafts = run.sessions.map((s) => ({ ...s, id: s.id + 10_000, confirmed: false, sets: s.sets.map((x) => ({ ...x, reps: 0 })) }))
        const blocks = run.blocks.map((b) => (b.id === active.id ? { ...b, sessionIds: [...b.sessionIds, ...drafts.map((d) => d.id)] } : b))
        expect(cycleLoadOffset(blocks, [...shuffled, ...drafts], { ...active, sessionIds: [...active.sessionIds, ...drafts.map((d) => d.id)] })).toBe(offset)
      }),
      SIM_RUNS
    )
  })
})

function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs]
  let s = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ─── Between cycles ───────────────────────────────────────────────────────────

/** A realization block whose doubles and openers were jumped over and whose test is `test`. */
function testedBlock(anchor: number, test: Session, extra: Partial<TrainingBlock> = {}): TrainingBlock {
  return block({ id: 3, phase: "realization", anchorWeight: anchor, length: 3, sessionIds: [test.id], skippedSlots: [0, 1], status: "completed", ...extra })
}

const floorPlate = (kg: number) => Math.floor(kg / 2.5 + 1e-9) * 2.5

describe("the next cycle's peak", () => {
  it("doc examples: a missed single never raises the peak", () => {
    const missed = (kg: number) => reviewCycle(testedBlock(100, session(1, 1, [set(kg, 0)])), [session(1, 1, [set(kg, 0)])])
    expect(missed(102.5)).toEqual({ anchor: 100, outcome: "stalled" })
    expect(missed(100)).toEqual({ anchor: 97.5, outcome: "stalled" })
  })

  it("a single made at the peak to plan raises it a step; a grinder holds it", () => {
    const at = (kg: number, rpe: number | null) => {
      const test = session(1, 1, [set(kg, 1, rpe)])
      return reviewCycle(testedBlock(100, test), [test])
    }
    expect(at(100, 9.5)).toEqual({ anchor: 102.5, outcome: "raised" })
    expect(at(100, null)).toEqual({ anchor: 102.5, outcome: "raised" })
    expect(at(100, 10)).toEqual({ anchor: 100, outcome: "stalled" })
  })

  it("is on the plate, rounded down, and moves at most 5% (plus the round-down)", () => {
    fc.assert(
      fc.property(programSetupArb(60), (setup) => {
        const run = simulateProgram(setup)
        for (const real of run.closed.filter((b) => b.phase === "realization")) {
          const { anchor, outcome } = reviewCycle(real, run.sessions)
          const old = real.anchorWeight
          expect(isPlate(anchor)).toBe(true)
          expect(anchor).toBeLessThanOrEqual(old * 1.05 + 1e-9)
          expect(anchor).toBeGreaterThanOrEqual(floorPlate(old * 0.95))
          expect(outcome === "raised").toBe(outcome !== "untested" && anchor > old)
          expect(deriveNextAnchor(real, run.sessions)).toBe(anchor)
        }
      }),
      SIM_RUNS
    )
  })

  it("a single made at or over the peak at RPE 9.5 or easier sets the next peak at least a step over it (within the 5% cap)", () => {
    fc.assert(
      fc.property(anchorArb, fc.integer({ min: 0, max: 4 }), fc.option(rpeArb.filter((r) => r <= 9.5), { nil: null }), (anchor, over, rpe) => {
        const kg = anchor + over * 2.5
        const test = session(1, 1, [set(kg, 1, rpe)])
        const { anchor: next } = reviewCycle(testedBlock(anchor, test), [test])
        expect(next).toBeGreaterThanOrEqual(floorPlate(Math.min(anchor * 1.05, kg + loadStep(anchor))))
      }),
      RUNS
    )
  })

  it("from a 50 kg peak up, a single made at the peak to plan is a raised cycle", () => {
    fc.assert(
      fc.property(anchorArb.filter((a) => a >= 50), fc.option(rpeArb.filter((r) => r <= 9.5), { nil: null }), (anchor, rpe) => {
        const test = session(1, 1, [set(anchor, 1, rpe)])
        const review = reviewCycle(testedBlock(anchor, test), [test])
        expect(review.outcome).toBe("raised")
        expect(review.anchor).toBeGreaterThan(anchor)
      }),
      RUNS
    )
  })

  it("a single that was only missed never raises the peak and lands a step under the miss", () => {
    fc.assert(
      fc.property(anchorArb, fc.array(fc.integer({ min: -6, max: 6 }), { minLength: 1, maxLength: 3 }), (anchor, plates) => {
        const misses = plates.map((p) => set(Math.max(2.5, anchor + p * 2.5), 0, null))
        const top = Math.max(...misses.map((s) => s.kg))
        const test = session(1, 1, misses)
        const { anchor: next, outcome } = reviewCycle(testedBlock(anchor, test), [test])
        expect(outcome).toBe("stalled")
        expect(next).toBeLessThanOrEqual(anchor)
        expect(next).toBeLessThanOrEqual(Math.max(top - loadStep(anchor), floorPlate(anchor * 0.95)))
        if (top >= anchor + loadStep(anchor)) expect(next).toBe(anchor)
        if (top === anchor) expect(next).toBe(anchor - loadStep(anchor))
      }),
      RUNS
    )
  })

  it("missed sets never count as lifted: adding misses anywhere in the block changes nothing once a set was made", () => {
    fc.assert(
      fc.property(programSetupArb(60), fc.integer({ min: -4, max: 4 }), (setup, plates) => {
        const run = simulateProgram(setup)
        for (const real of run.closed.filter((b) => b.phase === "realization")) {
          const withMisses = run.sessions.map((s) =>
            real.sessionIds.includes(s.id) && s.sets.some((x) => !x.isWarmup && x.reps > 0)
              ? { ...s, sets: [set(real.anchorWeight + plates * 2.5, 0, 10), ...s.sets, set(real.anchorWeight + 10, 0, null)] }
              : s
          )
          expect(reviewCycle(real, withMisses)).toEqual(reviewCycle(real, run.sessions))
        }
      }),
      SIM_RUNS
    )
  })

  it("is deterministic and independent of the order sessions are stored in", () => {
    fc.assert(
      fc.property(programSetupArb(60), fc.integer(), (setup, seed) => {
        const run = simulateProgram(setup)
        for (const real of run.closed.filter((b) => b.phase === "realization")) {
          const review = reviewCycle(real, run.sessions)
          expect(reviewCycle(real, shuffle(run.sessions, seed))).toEqual(review)
          expect(reviewCycle({ ...real, sessionIds: shuffle(real.sessionIds, seed) }, run.sessions)).toEqual(review)
          expect(createNextBlock(real, shuffle(run.sessions, seed), 99)).toEqual(createNextBlock(real, run.sessions, 99))
        }
      }),
      SIM_RUNS
    )
  })

  it("a jumped-over test never lowers the peak and leaves volume, stalls and rep range alone", () => {
    fc.assert(
      fc.property(programSetupArb(60), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 1 }), fc.constantFrom("moderate" as const, "heavy" as const), (setup, extraSets, stalls, repRange) => {
        const run = simulateProgram(setup)
        for (const real of run.closed.filter((b) => b.phase === "realization")) {
          const finalSlot = getBlockLength(real) - 1
          const skipped: TrainingBlock = {
            ...real,
            extraSets,
            stalls,
            repRange,
            sessionIds: real.sessionIds.slice(0, Math.min(real.sessionIds.length, finalSlot - (real.skippedSlots ?? []).filter((s) => s < finalSlot).length)),
            skippedSlots: [...(real.skippedSlots ?? []).filter((s) => s < finalSlot), finalSlot],
          }
          const review = reviewCycle(skipped, run.sessions)
          expect(review.outcome).toBe("untested")
          expect(review.anchor).toBeGreaterThanOrEqual(real.anchorWeight)
          const next = createNextBlock(skipped, run.sessions, 99)
          expect(next).toMatchObject({ phase: "deload", extraSets, stalls, repRange, review: { outcome: "untested", change: null } })
          // The usual deload, not the full week a stalled cycle buys.
          expect(next.length).toBe(blockLengthFor("deload", setup.perWeek, { cycleLength: setup.cycleLength }))
        }
      }),
      SIM_RUNS
    )
  })

  it("a realization block with nothing logged keeps the peak exactly", () => {
    fc.assert(
      fc.property(anchorArb, (anchor) => {
        const real = block({ id: 3, phase: "realization", anchorWeight: anchor, length: 3, skippedSlots: [0, 1, 2] })
        expect(reviewCycle(real, [])).toEqual({ anchor, outcome: "untested" })
      }),
      RUNS
    )
  })
})

describe("what the next cycle carries", () => {
  const closeWith = (anchor: number, rpe: number | null, reps: number, prev: Partial<TrainingBlock>) => {
    const test = session(1, 1, [set(anchor, reps, rpe)])
    return createNextBlock(testedBlock(anchor, test, prev), [test], 4)
  }

  it("a raised peak adds a Volume set, up to two; a stalled one drops them and buys a deload week", () => {
    expect(closeWith(100, 9, 1, { extraSets: 0 })).toMatchObject({ anchorWeight: 102.5, extraSets: 1, stalls: 0, length: 1, review: { outcome: "raised", change: "volume-up" } })
    expect(closeWith(100, 9, 1, { extraSets: 2 })).toMatchObject({ extraSets: 2, review: { outcome: "raised", change: null } })
    const stalled = closeWith(100, 10, 1, { extraSets: 2, stalls: 0 })
    expect(stalled).toMatchObject({ anchorWeight: 100, extraSets: 0, stalls: 1, review: { outcome: "stalled", change: "volume-reset" } })
    expect(stalled.length).toBeGreaterThanOrEqual(2)
  })

  it("two stalled cycles in a row switch the rep range", () => {
    expect(closeWith(100, 10, 1, { stalls: 1, repRange: "moderate" })).toMatchObject({ repRange: "heavy", stalls: 0, review: { change: "rep-range" } })
    expect(closeWith(100, null, 0, { stalls: 1, repRange: "heavy" })).toMatchObject({ repRange: "moderate", stalls: 0, review: { change: "rep-range" } })
  })

  it("over whole programs: extra sets stay within 0–2 and only grow after a raised peak; the Volume block after a deload starts at its peak", () => {
    fc.assert(
      fc.property(programSetupArb(80), (setup) => {
        const run = simulateProgram(setup)
        const sorted = [...run.blocks].sort((a, b) => a.id - b.id)
        for (let i = 1; i < sorted.length; i++) {
          const [prev, next] = [sorted[i - 1], sorted[i]]
          expect(next.extraSets ?? 0).toBeGreaterThanOrEqual(0)
          expect(next.extraSets ?? 0).toBeLessThanOrEqual(MAX_EXTRA_SETS)
          expect(next.sessionsPerWeek).toBe(setup.perWeek)
          expect(next.cycleLength).toBe(setup.cycleLength)
          if (prev.phase === "realization") {
            if ((next.extraSets ?? 0) > (prev.extraSets ?? 0)) expect(next.review?.outcome).toBe("raised")
            if (next.review?.outcome === "stalled") expect(next.extraSets).toBe(0)
          } else {
            expect(next.anchorWeight).toBe(prev.anchorWeight)
            expect(next.extraSets ?? 0).toBe(prev.extraSets ?? 0)
          }
          if (prev.phase === "deload") expect(next.phase).toBe("accumulation")
        }
      }),
      SIM_RUNS
    )
  })
})
