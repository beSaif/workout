import { describe, expect, it } from "vitest"
import fc from "fast-check"
import type { Session, TrainingBlock } from "./types"
import { calcE1RM } from "./e1rm"
import { buildCycleReport, cycleReviewFor } from "./cycleReport"
import { block, programSetupArb, session, set, simulateProgram, type ProgramRun } from "./__tests__/training"

const SIM_RUNS = { numRuns: 100 }

/** Deloads that close a cycle (follow a realization block), with the blocks of that cycle. */
function cyclesOf(run: ProgramRun) {
  const sorted = [...run.blocks].sort((a, b) => a.id - b.id)
  const deloads = sorted.filter((b) => b.phase === "deload")
  return deloads.map((deload, i) => {
    const from = i === 0 ? 0 : deloads[i - 1].id
    const blocks = sorted.filter((b) => b.id > from && b.id <= deload.id)
    return { deload, number: i + 1, blocks, realization: blocks.find((b) => b.phase === "realization")! }
  })
}

const isLifted = (x: Session["sets"][number]) => !x.isWarmup && x.kg > 0 && x.reps > 0
const isMissed = (x: Session["sets"][number]) => !x.isWarmup && x.kg > 0 && x.reps === 0

describe("buildCycleReport, from a hand-logged cycle", () => {
  // Volume ×2, Intensity ×1 (one slot jumped), Peak ×3 with a miss then a made single.
  const blocks: TrainingBlock[] = [
    block({ id: 1, phase: "accumulation", anchorWeight: 100, length: 2, sessionIds: [1, 2], status: "completed" }),
    block({ id: 2, phase: "transmutation", anchorWeight: 100, length: 2, sessionIds: [3], skippedSlots: [1], status: "completed" }),
    block({ id: 3, phase: "realization", anchorWeight: 100, length: 3, sessionIds: [4, 5, 6], status: "completed" }),
    block({ id: 4, phase: "deload", anchorWeight: 102.5, length: 1, sessionIds: [], review: { previousAnchor: 100, outcome: "raised", change: "volume-up" } }),
  ]
  const sessions: Session[] = [
    session(0, -10, [set(95, 3)], { type: "Volume" }), // before the cycle: e1RM 100.6
    session(1, 1, [set(40, 5, null, true), set(67.5, 8, 6), set(67.5, 8, 6), set(67.5, 0, null)], { type: "Volume" }),
    session(2, 3, [set(70, 8, 7), set(70, 8, 7.5)], { type: "Volume" }),
    session(3, 5, [set(80, 5, 9), set(80, 5)], { type: "Intensity" }),
    session(4, 7, [set(90, 2, 8.5), set(90, 2, 8.5), set(90, 2, 8.5)], { type: "Peak" }),
    session(5, 9, [set(92.5, 1, 8), set(92.5, 1, 8.5)], { type: "Peak" }),
    session(6, 11, [set(60, 3, null, true), set(102.5, 0, null), set(100, 1, 9)], { type: "Peak" }),
    session(7, 12, [set(100, 1, 9)], { type: "Peak", confirmed: false }), // a draft never counts
  ]
  const report = buildCycleReport(blocks, sessions, 4)!

  it("reads peak, outcome and change off the deload's review", () => {
    expect(report).toMatchObject({ number: 1, previousPeak: 100, nextPeak: 102.5, outcome: "raised", change: "volume-up" })
  })

  it("counts sessions, jumped slots and sets by phase, warm-ups excluded", () => {
    expect(report.phases).toEqual([
      { phase: "accumulation", sessions: 2, skipped: 0, sets: 5 },
      { phase: "transmutation", sessions: 1, skipped: 1, sets: 2 },
      { phase: "realization", sessions: 3, skipped: 0, sets: 7 },
      { phase: "deload", sessions: 0, skipped: 0, sets: 0 },
    ])
    expect(report.missedSets).toBe(2)
  })

  it("judges the peak test on the made single, not the miss before it", () => {
    expect(report.test).toEqual({ kg: 100, reps: 1, rpe: 9 })
  })

  it("takes best e1RM before and during the cycle from lifted sets only", () => {
    // The made single (100) beats every Volume set; the 102.5 miss is not a lift.
    expect(report.e1rm).toEqual({ before: calcE1RM(95, 3), during: 100 })
  })

  it("rates effort session by session against target", () => {
    // Top set against target: S1 6 vs 6, S2 7.5 vs 7.5 (a two-slot block ends on its last step),
    // S3 9 vs 7.5 (harder), S4 8.5 vs 8.5, S5 8.5 vs 8 and S6 9 vs 9.5 (both within one RPE).
    expect(report.effort).toEqual({ onTarget: 5, harder: 1, easier: 0, unrated: 0 })
  })

  it("reports the heaviest attempt when the single was only missed", () => {
    const missedOnly = sessions.map((s) => (s.id === 6 ? { ...s, sets: [set(102.5, 0, null), set(100, 0, null)] } : s))
    expect(buildCycleReport(blocks, missedOnly, 4)!.test).toEqual({ kg: 102.5, reps: 0, rpe: null })
  })

  it("has no test when the single was jumped over", () => {
    const jumped = blocks.map((b) => (b.id === 3 ? { ...b, sessionIds: [4, 5], skippedSlots: [2] } : b))
    expect(buildCycleReport(jumped, sessions, 4)!.test).toBeNull()
  })
})

describe("cycleReviewFor, for deloads saved before reviews existed", () => {
  const real = block({ id: 3, phase: "realization", anchorWeight: 100, length: 3, sessionIds: [4, 5, 6], status: "completed" })
  const legacy = (anchor: number) => block({ id: 4, phase: "deload", anchorWeight: anchor, length: 1 })

  it("reads the outcome off the two peaks", () => {
    expect(cycleReviewFor([real], legacy(102.5))).toEqual({ previousAnchor: 100, outcome: "raised", change: null })
    expect(cycleReviewFor([real], legacy(100))).toEqual({ previousAnchor: 100, outcome: "stalled", change: null })
    expect(cycleReviewFor([real], legacy(97.5))).toEqual({ previousAnchor: 100, outcome: "stalled", change: null })
  })

  it("is untested when the final slot was jumped over, whatever the peaks say", () => {
    const jumped = { ...real, sessionIds: [4, 5], skippedSlots: [2] }
    expect(cycleReviewFor([jumped], legacy(102.5))?.outcome).toBe("untested")
  })

  it("is null without a realization block before the deload, or for a block that isn't a deload", () => {
    expect(cycleReviewFor([block({ id: 2, phase: "transmutation", anchorWeight: 100 })], legacy(100))).toBeNull()
    expect(cycleReviewFor([real], real)).toBeNull()
  })
})

describe("buildCycleReport over simulated programs", () => {
  it("reports every closed cycle, numbered, with the peaks the blocks carry", () => {
    fc.assert(
      fc.property(programSetupArb(60), (setup) => {
        const run = simulateProgram(setup)
        for (const c of cyclesOf(run)) {
          const report = buildCycleReport(run.blocks, run.sessions, c.deload.id)
          expect(report).not.toBeNull()
          expect(report!.number).toBe(c.number)
          expect(report!.previousPeak).toBe(c.realization.anchorWeight)
          expect(report!.nextPeak).toBe(c.deload.anchorWeight)
          expect(report!.outcome).toBe(c.deload.review!.outcome)
        }
      }),
      SIM_RUNS
    )
  })

  it("sessions, jumped slots and sets by phase add up to what was logged; missed sets are counted, never as lifted", () => {
    fc.assert(
      fc.property(programSetupArb(60), (setup) => {
        const run = simulateProgram(setup)
        for (const c of cyclesOf(run)) {
          const report = buildCycleReport(run.blocks, run.sessions, c.deload.id)!
          let missed = 0
          let lifted: number[] = []
          for (const line of report.phases) {
            const own = c.blocks.filter((b) => b.phase === line.phase)
            const logged = run.sessions.filter((s) => s.confirmed && own.some((b) => b.id === s.blockId))
            const sets = logged.flatMap((s) => s.sets)
            expect(line.sessions).toBe(logged.length)
            expect(line.skipped).toBe(own.reduce((n, b) => n + (b.skippedSlots?.length ?? 0), 0))
            expect(line.sets).toBeGreaterThanOrEqual(sets.filter(isLifted).length)
            expect(line.sets).toBeLessThanOrEqual(sets.filter(isLifted).length + sets.filter(isMissed).length)
            if (line.phase !== "deload") {
              missed += sets.filter(isMissed).length
              lifted = lifted.concat(sets.filter(isLifted).map((x) => calcE1RM(x.kg, x.reps)!))
            }
          }
          expect(report.missedSets).toBe(missed)
          expect(report.e1rm.during).toBe(lifted.length ? Math.max(...lifted) : null)
          const rated = report.effort.onTarget + report.effort.harder + report.effort.easier + report.effort.unrated
          expect(rated).toBe(report.phases.filter((p) => p.phase !== "deload").reduce((n, p) => n + p.sessions, 0))
        }
      }),
      SIM_RUNS
    )
  })

  it("adding missed sets changes only the missed count: never the e1RMs, the effort or a made test single", () => {
    fc.assert(
      fc.property(programSetupArb(60), fc.integer({ min: 1, max: 3 }), (setup, extra) => {
        const run = simulateProgram(setup)
        const withMisses = run.sessions.map((s) => ({
          ...s,
          sets: [...s.sets, ...Array.from({ length: extra }, () => set(400, 0, null))],
        }))
        for (const c of cyclesOf(run)) {
          const before = buildCycleReport(run.blocks, run.sessions, c.deload.id)!
          const after = buildCycleReport(run.blocks, withMisses, c.deload.id)!
          const cycleSessions = run.sessions.filter((s) => c.blocks.some((b) => b.id === s.blockId && b.phase !== "deload"))
          expect(after.missedSets).toBe(before.missedSets + extra * cycleSessions.length)
          expect(after.e1rm).toEqual(before.e1rm)
          expect(after.effort).toEqual(before.effort)
          if (before.test && before.test.reps > 0) expect(after.test).toEqual(before.test)
        }
      }),
      SIM_RUNS
    )
  })

  it("ignores unconfirmed sessions and the order sessions are stored in", () => {
    fc.assert(
      fc.property(programSetupArb(60), (setup) => {
        const run = simulateProgram(setup)
        const drafts = run.sessions.map((s) => ({ ...s, id: s.id + 10_000, confirmed: false }))
        const blocks = run.blocks.map((b) => ({ ...b, sessionIds: [...b.sessionIds, ...b.sessionIds.map((id) => id + 10_000)] }))
        for (const c of cyclesOf(run)) {
          const report = buildCycleReport(run.blocks, run.sessions, c.deload.id)
          expect(buildCycleReport(blocks, [...drafts, ...run.sessions].reverse(), c.deload.id)).toEqual(report)
        }
      }),
      SIM_RUNS
    )
  })

  it("suggests a longer cycle after a stalled one, and never a longer one after a raised one", () => {
    fc.assert(
      fc.property(programSetupArb(60), (setup) => {
        const run = simulateProgram(setup)
        const order = ["short", "standard", "long"]
        for (const c of cyclesOf(run)) {
          const r = buildCycleReport(run.blocks, run.sessions, c.deload.id)!
          const step = order.indexOf(r.suggestedLength) - order.indexOf(r.cycleLength)
          if (r.outcome === "stalled") expect(step).toBe(r.cycleLength === "long" ? 0 : 1)
          if (r.outcome === "raised") expect(step).toBeLessThanOrEqual(0)
          expect(r.lengthReason === null).toBe(step === 0)
        }
      }),
      SIM_RUNS
    )
  })
})
