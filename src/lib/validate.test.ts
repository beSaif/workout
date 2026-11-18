import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { isMuscleGroupConfigArray, isTrainingDayArray, parseSessionsPayload } from "./validate"

const RUNS = { numRuns: 200 }
const CAP = 5000

// ─── Valid documents, as clients old and new write them ───────────────────────

const setArb = fc.record(
  {
    id: fc.string(),
    kg: fc.double({ min: 0, max: 400, noNaN: true }),
    reps: fc.integer({ min: 0, max: 30 }),
    rpe: fc.option(fc.double({ min: 5, max: 10, noNaN: true }), { nil: null }),
    e1rm: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: null }),
    note: fc.string(),
    isWarmup: fc.boolean(),
  },
  // Older clients wrote sets with fewer fields; only kg and reps are load-bearing.
  { requiredKeys: ["kg", "reps"] }
)

const sessionArb = fc.record(
  {
    id: fc.integer(),
    date: fc.option(fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), { nil: null }),
    type: fc.constantFrom("Volume", "Intensity", "Peak", "Deload", "Free", "Push"),
    bw: fc.option(fc.double({ min: 30, max: 200, noNaN: true }), { nil: null }),
    sets: fc.array(setArb, { maxLength: 8 }),
    confirmed: fc.boolean(),
    coachNote: fc.string(),
    blockId: fc.integer(),
    skippedMainLift: fc.boolean(),
    extraWorkouts: fc.array(fc.record({ muscle: fc.string(), exercises: fc.array(fc.record({ name: fc.string(), sets: fc.constant([]) })) }), { maxLength: 2 }),
  },
  { requiredKeys: ["id", "date", "type", "sets", "confirmed"] }
)

const blockArb = fc.record(
  {
    id: fc.integer(),
    phase: fc.constantFrom("accumulation", "transmutation", "realization", "deload", "reacclimation"),
    status: fc.constantFrom("active", "completed", "interrupted"),
    sessionIds: fc.array(fc.integer(), { maxLength: 12 }),
    anchorWeight: fc.double({ min: 20, max: 300, noNaN: true }),
    length: fc.integer({ min: 1, max: 24 }),
    startDate: fc.constant(null),
    endDate: fc.constant(null),
    skippedSlots: fc.array(fc.nat(20), { maxLength: 3 }),
    schemeVersion: fc.constant(2),
  },
  { requiredKeys: ["id", "phase", "status", "sessionIds", "anchorWeight"] }
)

const groupArb = fc.record({
  id: fc.string(),
  name: fc.string(),
  order: fc.nat(),
  exercises: fc.array(fc.record({ id: fc.string(), name: fc.string(), order: fc.nat() }), { maxLength: 4 }),
})

const dayArb = fc.record({
  id: fc.string(),
  name: fc.string(),
  order: fc.nat(),
  muscleGroupIds: fc.array(fc.string(), { maxLength: 5 }),
})

// ─── Corruptions: one field of one item made the wrong type ───────────────────

type Doc = Record<string, unknown>
const wrong = fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.boolean(), fc.object(), fc.constant([]))

/** Replace `key` of `item` with a value of the wrong type (never one the validator accepts). */
function corrupt(item: Doc, key: string, value: unknown, accepted: (v: unknown) => boolean): Doc | null {
  if (accepted(value)) return null
  return { ...item, [key]: value }
}

const sessionFields: Record<string, (v: unknown) => boolean> = {
  id: (v) => typeof v === "number",
  date: (v) => v === null || typeof v === "string",
  type: (v) => typeof v === "string",
  confirmed: (v) => typeof v === "boolean",
  sets: (v) => Array.isArray(v) && v.length === 0,
}
const blockFields: Record<string, (v: unknown) => boolean> = {
  id: (v) => typeof v === "number",
  phase: (v) => typeof v === "string",
  status: (v) => typeof v === "string",
  anchorWeight: (v) => typeof v === "number",
  sessionIds: (v) => Array.isArray(v) && v.length === 0,
}

describe("parseSessionsPayload", () => {
  it("accepts { sessions, blocks } as sent, without rebuilding it", () => {
    fc.assert(
      fc.property(fc.array(sessionArb, { maxLength: 12 }), fc.array(blockArb, { maxLength: 6 }), (sessions, blocks) => {
        const parsed = parseSessionsPayload({ sessions, blocks })
        expect(parsed).not.toBeNull()
        expect(parsed!.sessions).toBe(sessions)
        expect(parsed!.blocks).toBe(blocks)
      }),
      RUNS
    )
  })

  it("accepts a document without blocks, and the legacy bare session array, as no blocks", () => {
    fc.assert(
      fc.property(fc.array(sessionArb, { maxLength: 12 }), (sessions) => {
        expect(parseSessionsPayload({ sessions })).toEqual({ sessions, blocks: [] })
        const legacy = parseSessionsPayload(sessions)
        expect(legacy).toEqual({ sessions, blocks: [] })
        expect(legacy!.sessions).toBe(sessions)
      }),
      RUNS
    )
  })

  it("rejects the whole document when any one session or block is malformed", () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { minLength: 1, maxLength: 8 }),
        fc.array(blockArb, { minLength: 1, maxLength: 4 }),
        fc.nat(),
        fc.constantFrom(...Object.keys(sessionFields)),
        fc.constantFrom(...Object.keys(blockFields)),
        wrong,
        fc.boolean(),
        (sessions, blocks, at, sKey, bKey, value, inSessions) => {
          if (inSessions) {
            const i = at % sessions.length
            const bad = corrupt(sessions[i] as Doc, sKey, value, sessionFields[sKey])
            if (!bad) return
            const broken = sessions.map((s, j) => (j === i ? bad : s))
            expect(parseSessionsPayload({ sessions: broken, blocks })).toBeNull()
            expect(parseSessionsPayload(broken)).toBeNull()
          } else {
            const i = at % blocks.length
            const bad = corrupt(blocks[i] as Doc, bKey, value, blockFields[bKey])
            if (!bad) return
            expect(parseSessionsPayload({ sessions, blocks: blocks.map((b, j) => (j === i ? bad : b)) })).toBeNull()
          }
        }
      ),
      RUNS
    )
  })

  it("rejects a set without numeric kg and reps, and a block listing a non-numeric session id", () => {
    const s = { id: 1, date: null, type: "Volume", confirmed: true, sets: [{ kg: 100, reps: 5 }] }
    expect(parseSessionsPayload([s])).not.toBeNull()
    expect(parseSessionsPayload([{ ...s, sets: [{ kg: "100", reps: 5 }] }])).toBeNull()
    expect(parseSessionsPayload([{ ...s, sets: [{ kg: 100 }] }])).toBeNull()
    expect(parseSessionsPayload([{ ...s, sets: [null] }])).toBeNull()
    const b = { id: 1, phase: "accumulation", status: "active", anchorWeight: 100, sessionIds: [1] }
    expect(parseSessionsPayload({ sessions: [s], blocks: [b] })).not.toBeNull()
    expect(parseSessionsPayload({ sessions: [s], blocks: [{ ...b, sessionIds: ["1"] }] })).toBeNull()
  })

  it("rejects what isn't a sessions document", () => {
    for (const body of [null, undefined, 0, "sessions", true, {}, { sessions: null }, { sessions: {} }, { sessions: [], blocks: null }, { sessions: [], blocks: {} }]) {
      expect(parseSessionsPayload(body)).toBeNull()
    }
  })

  it("never throws, whatever arrives", () => {
    fc.assert(
      fc.property(fc.anything({ withNullPrototype: true, withBoxedValues: true, withSparseArray: true }), (body) => {
        const parsed = parseSessionsPayload(body)
        if (parsed) {
          expect(Array.isArray(parsed.sessions)).toBe(true)
          expect(Array.isArray(parsed.blocks)).toBe(true)
        }
      }),
      RUNS
    )
  })

  it(`caps sessions and blocks at ${CAP}, in either form`, () => {
    const s = { id: 1, date: null, type: "Volume", confirmed: true, sets: [] }
    const b = { id: 1, phase: "deload", status: "active", anchorWeight: 100, sessionIds: [] }
    const many = <T,>(x: T, n: number) => Array.from({ length: n }, () => x)
    expect(parseSessionsPayload(many(s, CAP))).not.toBeNull()
    expect(parseSessionsPayload(many(s, CAP + 1))).toBeNull()
    expect(parseSessionsPayload({ sessions: many(s, CAP), blocks: many(b, CAP) })).not.toBeNull()
    expect(parseSessionsPayload({ sessions: many(s, CAP + 1) })).toBeNull()
    expect(parseSessionsPayload({ sessions: [s], blocks: many(b, CAP + 1) })).toBeNull()
  })
})

describe("isMuscleGroupConfigArray and isTrainingDayArray", () => {
  it("accept well-formed routines", () => {
    fc.assert(
      fc.property(fc.array(groupArb, { maxLength: 10 }), fc.array(dayArb, { maxLength: 7 }), (groups, days) => {
        expect(isMuscleGroupConfigArray(groups)).toBe(true)
        expect(isTrainingDayArray(days)).toBe(true)
      }),
      RUNS
    )
  })

  it("reject a routine with any one malformed entry", () => {
    fc.assert(
      fc.property(
        fc.array(groupArb, { minLength: 1, maxLength: 6 }),
        fc.array(dayArb, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.constantFrom("id", "name", "exercises"),
        fc.constantFrom("id", "name", "muscleGroupIds"),
        fc.oneof(fc.constant(null), fc.integer(), fc.boolean(), fc.object()),
        (groups, days, at, gKey, dKey, value) => {
          const gi = at % groups.length
          expect(isMuscleGroupConfigArray(groups.map((g, i) => (i === gi ? { ...g, [gKey]: value } : g)))).toBe(false)
          const di = at % days.length
          expect(isTrainingDayArray(days.map((d, i) => (i === di ? { ...d, [dKey]: value } : d)))).toBe(false)
        }
      ),
      RUNS
    )
    expect(isTrainingDayArray([{ id: "a", name: "A", muscleGroupIds: [1] }])).toBe(false)
    expect(isMuscleGroupConfigArray({ id: "a", name: "A", exercises: [] })).toBe(false)
    expect(isTrainingDayArray(null)).toBe(false)
  })

  it(`cap at ${CAP} entries`, () => {
    const g = { id: "g", name: "G", exercises: [] }
    const d = { id: "d", name: "D", muscleGroupIds: [] }
    expect(isMuscleGroupConfigArray(Array(CAP).fill(g))).toBe(true)
    expect(isMuscleGroupConfigArray(Array(CAP + 1).fill(g))).toBe(false)
    expect(isTrainingDayArray(Array(CAP).fill(d))).toBe(true)
    expect(isTrainingDayArray(Array(CAP + 1).fill(d))).toBe(false)
  })

  it("never throw, whatever arrives", () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        expect(typeof isMuscleGroupConfigArray(body)).toBe("boolean")
        expect(typeof isTrainingDayArray(body)).toBe("boolean")
      }),
      RUNS
    )
  })
})
