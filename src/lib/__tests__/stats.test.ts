import { describe, expect, it } from "vitest"
import { getBestE1RM, getBestWeight, sessionSummary, sessionWork } from "@/lib/stats"
import type { ExtraWorkout, MainLiftSet, Session } from "@/lib/types"

let nextSetId = 0
function set(kg: number, reps: number, extra: Partial<MainLiftSet> = {}): MainLiftSet {
  return {
    id: `S${++nextSetId}`,
    kg,
    reps,
    rpe: null,
    e1rm: null,
    note: "",
    isWarmup: false,
    ...extra,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    date: "2026-01-01T10:00:00.000Z",
    type: "Volume",
    bw: null,
    sets: [],
    confirmed: true,
    coachNote: "",
    ...overrides,
  }
}

describe("getBestE1RM", () => {
  it("returns null with no sessions", () => {
    expect(getBestE1RM([])).toBeNull()
  })

  it("takes the highest working-set e1RM across confirmed, dated sessions", () => {
    const sessions = [
      session({ sets: [set(100, 5, { e1rm: 112.5 }), set(100, 5, { e1rm: 112.5 })] }),
      session({ id: 2, sets: [set(105, 3, { e1rm: 111.2 }), set(110, 1, { e1rm: 110 })] }),
    ]
    expect(getBestE1RM(sessions)).toBe(112.5)
  })

  it("ignores warm-ups, unconfirmed, undated and deload sessions, and null e1RMs", () => {
    const sessions = [
      session({ sets: [set(150, 1, { e1rm: 150, isWarmup: true }), set(100, 5, { e1rm: 112.5 })] }),
      session({ id: 2, confirmed: false, sets: [set(140, 1, { e1rm: 140 })] }),
      session({ id: 3, date: null, sets: [set(130, 1, { e1rm: 130 })] }),
      session({ id: 4, type: "Deload", sets: [set(120, 1, { e1rm: 120 })] }),
      session({ id: 5, sets: [set(200, 0, { e1rm: null })] }),
    ]
    expect(getBestE1RM(sessions)).toBe(112.5)
  })

  it("returns null when nothing qualifies", () => {
    expect(getBestE1RM([session({ confirmed: false, sets: [set(100, 5, { e1rm: 112.5 })] })])).toBeNull()
  })
})

describe("getBestWeight", () => {
  it("returns null with no sessions", () => {
    expect(getBestWeight([])).toBeNull()
  })

  it("takes the heaviest made working set from confirmed sessions", () => {
    const sessions = [
      session({ sets: [set(60, 5, { isWarmup: true }), set(100, 5), set(102.5, 3)] }),
      session({ id: 2, sets: [set(105, 1)] }),
    ]
    expect(getBestWeight(sessions)).toBe(105)
  })

  it("ignores warm-ups, missed (0-rep) attempts and unconfirmed sessions", () => {
    const sessions = [
      session({ sets: [set(150, 1, { isWarmup: true }), set(100, 5), set(120, 0)] }),
      session({ id: 2, confirmed: false, sets: [set(130, 1)] }),
    ]
    expect(getBestWeight(sessions)).toBe(100)
  })

  it("still counts deload and undated sessions (only confirmed is checked)", () => {
    expect(getBestWeight([session({ type: "Deload", sets: [set(90, 5)] })])).toBe(90)
    expect(getBestWeight([session({ date: null, sets: [set(95, 5)] })])).toBe(95)
  })
})

describe("sessionSummary", () => {
  it("reports the first working set, working-set count and best e1RM", () => {
    const s = session({
      sets: [
        set(60, 5, { isWarmup: true, e1rm: 70 }),
        set(100, 5, { e1rm: 112.5 }),
        set(105, 3, { e1rm: 111.2 }),
        set(110, 1, { e1rm: null }),
      ],
    })
    expect(sessionSummary(s)).toEqual({ weight: 100, reps: 5, setCount: 3, bestE1RM: 112.5 })
  })

  it("is empty for a session without working sets", () => {
    const s = session({ sets: [set(60, 5, { isWarmup: true, e1rm: 70 })] })
    expect(sessionSummary(s)).toEqual({ weight: null, reps: null, setCount: 0, bestE1RM: null })
  })
})

describe("sessionWork", () => {
  const extras: ExtraWorkout[] = [
    {
      muscle: "back",
      exercises: [
        { name: "Row", sets: [{ kg: 80, reps: 10, rpe: null }, { kg: 80, reps: 8, rpe: null }] },
        { name: "Unlogged", sets: [] },
      ],
    },
    {
      muscle: "cardio",
      exercises: [
        {
          name: "Bike",
          sets: [
            { kg: 0, reps: 0, rpe: null, minutes: 12.4 },
            { kg: 0, reps: 0, rpe: null, minutes: 10 },
          ],
        },
      ],
    },
  ]

  it("totals the main lift and accessories, skipping warm-ups and empty exercises", () => {
    const s = session({
      sets: [set(60, 5, { isWarmup: true }), set(100, 5), set(100, 5), set(105, 0)],
      extraWorkouts: extras,
    })
    expect(sessionWork(s, "Bench")).toEqual({
      muscles: ["back", "cardio"],
      exercises: 3, // main lift, Row, Bike
      sets: 7, // 3 main working + 2 Row + 2 Bike
      volume: 2440, // 100×5×2 + 105×0 + 80×10 + 80×8
      topSet: { kg: 100, reps: 5, exercise: "Bench" },
      cardioMinutes: 22, // 22.4 rounded
    })
  })

  it("never picks a missed attempt as the top set", () => {
    const s = session({ sets: [set(100, 5), set(110, 0)] })
    expect(sessionWork(s).topSet).toEqual({ kg: 100, reps: 5, exercise: "Main Lift" })
  })

  it("lets a heavier accessory set take the top set", () => {
    const s = session({
      sets: [set(100, 5)],
      extraWorkouts: [{ muscle: "legs", exercises: [{ name: "Deadlift", sets: [{ kg: 140, reps: 5, rpe: null }] }] }],
    })
    expect(sessionWork(s).topSet).toEqual({ kg: 140, reps: 5, exercise: "Deadlift" })
  })

  it("keeps the earlier set on a tie", () => {
    const s = session({
      sets: [set(100, 5)],
      extraWorkouts: [{ muscle: "legs", exercises: [{ name: "Squat", sets: [{ kg: 100, reps: 8, rpe: null }] }] }],
    })
    expect(sessionWork(s, "Bench").topSet).toEqual({ kg: 100, reps: 5, exercise: "Bench" })
  })

  it("handles a balanced (accessories-only) session", () => {
    const s = session({
      type: "Free",
      extraWorkouts: [
        {
          muscle: "back",
          exercises: [
            { name: "Row", sets: [{ kg: 80, reps: 10, rpe: null }] },
            { name: "Deadlift", sets: [{ kg: 140, reps: 5, rpe: null }] },
          ],
        },
      ],
    })
    expect(sessionWork(s)).toEqual({
      muscles: ["back"],
      exercises: 2,
      sets: 2,
      volume: 1500,
      topSet: { kg: 140, reps: 5, exercise: "Deadlift" },
      cardioMinutes: 0,
    })
  })

  it("reports no top set and no volume for a cardio-only session", () => {
    const s = session({ type: "Free", extraWorkouts: [extras[1]] })
    const work = sessionWork(s)
    expect(work.topSet).toBeNull()
    expect(work.volume).toBe(0)
    expect(work.sets).toBe(2)
    expect(work.cardioMinutes).toBe(22)
  })

  it("prefers selectedMuscleGroups when present and non-empty", () => {
    expect(sessionWork(session({ selectedMuscleGroups: ["chest"], extraWorkouts: extras })).muscles).toEqual([
      "chest",
    ])
    expect(sessionWork(session({ selectedMuscleGroups: [], extraWorkouts: extras })).muscles).toEqual([
      "back",
      "cardio",
    ])
  })

  it("rounds volume to a whole number", () => {
    const s = session({ sets: [set(33.3, 3)] }) // 99.9
    expect(sessionWork(s).volume).toBe(100)
  })

  it("is all zeros for an empty session", () => {
    expect(sessionWork(session())).toEqual({
      muscles: [],
      exercises: 0,
      sets: 0,
      volume: 0,
      topSet: null,
      cardioMinutes: 0,
    })
  })
})
