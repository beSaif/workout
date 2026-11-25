import { describe, expect, it } from "vitest"
import { calcE1RM, roundToPlate } from "@/lib/e1rm"

describe("calcE1RM (Brzycki: weight × 36 / (37 − reps))", () => {
  it("returns the weight itself for a single", () => {
    expect(calcE1RM(100, 1)).toBe(100)
  })

  it("applies the Brzycki formula", () => {
    expect(calcE1RM(100, 5)).toBe(112.5)
    expect(calcE1RM(60, 10)).toBe(80)
  })

  it("rounds to one decimal place", () => {
    // 82.5 × 36 / 34 = 87.352…
    expect(calcE1RM(82.5, 3)).toBe(87.4)
    // 70 × 36 / 29 = 86.896…
    expect(calcE1RM(70, 8)).toBe(86.9)
  })

  it("is defined up to 36 reps", () => {
    expect(calcE1RM(100, 36)).toBe(3600)
  })

  it("returns null for zero, negative or ≥ 37 reps", () => {
    expect(calcE1RM(100, 0)).toBeNull()
    expect(calcE1RM(100, -1)).toBeNull()
    expect(calcE1RM(100, 37)).toBeNull()
    expect(calcE1RM(100, 50)).toBeNull()
  })

  it("returns 0 for an empty bar of 0kg", () => {
    expect(calcE1RM(0, 5)).toBe(0)
  })
})

describe("roundToPlate", () => {
  it("rounds to the nearest 2.5kg by default", () => {
    expect(roundToPlate(100)).toBe(100)
    expect(roundToPlate(101)).toBe(100)
    expect(roundToPlate(103.7)).toBe(102.5)
    expect(roundToPlate(104)).toBe(105)
  })

  it("rounds a half step up (Math.round)", () => {
    expect(roundToPlate(101.25)).toBe(102.5)
  })

  it("accepts a custom increment", () => {
    expect(roundToPlate(7, 5)).toBe(5)
    expect(roundToPlate(8, 5)).toBe(10)
    expect(roundToPlate(101, 1)).toBe(101)
  })

  it("keeps 0 at 0", () => {
    expect(roundToPlate(0)).toBe(0)
  })
})
