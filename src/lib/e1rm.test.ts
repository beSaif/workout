import { describe, expect, it } from "vitest"
import { calcE1RM, roundToPlate } from "./e1rm"

describe("calcE1RM (Brzycki)", () => {
  it("is the weight itself for a single", () => {
    expect(calcE1RM(100, 1)).toBe(100)
  })

  it("matches weight × 36 / (37 − reps)", () => {
    expect(calcE1RM(100, 5)).toBe(112.5)
    expect(calcE1RM(80, 8)).toBe(99.3)
  })

  it("is undefined for a missed set or reps past the formula's range", () => {
    expect(calcE1RM(100, 0)).toBeNull()
    expect(calcE1RM(100, 37)).toBeNull()
  })
})

describe("roundToPlate", () => {
  it("rounds to the nearest 2.5 kg by default", () => {
    expect(roundToPlate(101.2)).toBe(100)
    expect(roundToPlate(101.3)).toBe(102.5)
  })
})
