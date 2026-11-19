import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { calcE1RM, calcE1RMFromRepsInTank } from "./e1rm"

const kgArb = fc.integer({ min: 1, max: 160 }).map((k) => k * 2.5)

describe("calcE1RMFromRepsInTank (Brzycki, unrounded)", () => {
  it("is weight × 36 / (37 − reps) on the reps a set had in it", () => {
    expect(calcE1RMFromRepsInTank(100, 1)).toBe(100)
    expect(calcE1RMFromRepsInTank(100, 5)).toBe(112.5)
    // A double at RPE 8.5 had 3.5 reps in it.
    expect(calcE1RMFromRepsInTank(90, 3.5)).toBeCloseTo(96.716, 3)
  })

  it("falls back to the weight itself at 37 reps in the tank and beyond", () => {
    fc.assert(fc.property(kgArb, fc.double({ min: 37, max: 1000, noNaN: true }), (kg, reps) => {
      expect(calcE1RMFromRepsInTank(kg, reps)).toBe(kg)
    }))
  })

  it("agrees with calcE1RM, to its 0.1 kg rounding, wherever both apply", () => {
    fc.assert(fc.property(kgArb, fc.integer({ min: 1, max: 36 }), (kg, reps) => {
      expect(Math.round(calcE1RMFromRepsInTank(kg, reps) * 10) / 10).toBe(calcE1RM(kg, reps))
    }))
  })

  it("rises with the weight and with the reps in the tank", () => {
    fc.assert(fc.property(kgArb, fc.double({ min: 0, max: 35, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (kg, reps, more) => {
      expect(calcE1RMFromRepsInTank(kg + 2.5, reps)).toBeGreaterThan(calcE1RMFromRepsInTank(kg, reps))
      expect(calcE1RMFromRepsInTank(kg, reps + more)).toBeGreaterThanOrEqual(calcE1RMFromRepsInTank(kg, reps))
    }))
  })
})
