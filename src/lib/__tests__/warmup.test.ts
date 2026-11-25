import { describe, expect, it } from "vitest"
import { generateWarmups } from "@/lib/warmup"

const steps = (sets: ReturnType<typeof generateWarmups>) => sets.map((s) => [s.kg, s.reps])

describe("generateWarmups", () => {
  it("ramps bar → 67% → 87% for ordinary rep counts (default 5)", () => {
    // 67 → 67.5, 87 → 87.5 after plate rounding
    expect(steps(generateWarmups(100))).toEqual([
      [20, 10],
      [67.5, 5],
      [87.5, 3],
    ])
  })

  it("uses the same ramp for triples and above", () => {
    expect(steps(generateWarmups(100, 3))).toEqual(steps(generateWarmups(100)))
    expect(steps(generateWarmups(100, 8))).toEqual(steps(generateWarmups(100)))
  })

  it("ramps with singles before heavy doubles and singles", () => {
    const expected = [
      [20, 10],
      [50, 5],
      [70, 3],
      [80, 1],
      [90, 1],
    ]
    expect(steps(generateWarmups(100, 1))).toEqual(expected)
    expect(steps(generateWarmups(100, 2))).toEqual(expected)
  })

  it("shapes every step as an unrated warm-up set with sequential ids", () => {
    const sets = generateWarmups(100)
    expect(sets.map((s) => s.id)).toEqual(["W1", "W2", "W3"])
    for (const s of sets) {
      expect(s).toMatchObject({ rpe: null, e1rm: null, note: "", isWarmup: true })
    }
  })

  it("drops steps at or under the bar for light working weights", () => {
    // 25: 67% → 17.5 (≤ bar, dropped), 87% → 22.5 (kept)
    expect(steps(generateWarmups(25))).toEqual([
      [20, 10],
      [22.5, 3],
    ])
    // 30: 67% → 20 (equal to the bar, dropped), 87% → 25 (kept)
    expect(steps(generateWarmups(30))).toEqual([
      [20, 10],
      [25, 3],
    ])
  })

  it("leaves only the empty bar when the working weight is the bar or less", () => {
    expect(steps(generateWarmups(20))).toEqual([[20, 10]])
    expect(steps(generateWarmups(10))).toEqual([[20, 10]])
  })

  it("squashes repeated or sub-bar steps on a light singles day", () => {
    // 30 × 1: 50% → 15, 70% → 20 (both ≤ bar), 80% → 25, 90% → 27.5
    expect(steps(generateWarmups(30, 1))).toEqual([
      [20, 10],
      [25, 1],
      [27.5, 1],
    ])
  })
})
