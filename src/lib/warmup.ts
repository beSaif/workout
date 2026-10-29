import { MainLiftSet } from "./types"
import { roundToPlate } from "./e1rm"

const BAR = 20

/**
 * Warm-up sets for a working weight. Ordinary days ramp with a few reps per step. Heavy
 * doubles and singles ramp with singles instead: a triple at 87% before a max is itself
 * a hard set, and it is spent before the one that counts.
 */
export function generateWarmups(workingWeight: number, workingReps = 5): MainLiftSet[] {
  const ramp: Array<[pct: number, reps: number]> =
    workingReps <= 2
      ? [[0.5, 5], [0.7, 3], [0.8, 1], [0.9, 1]]
      : [[0.67, 5], [0.87, 3]]

  const steps: Array<{ kg: number; reps: number }> = [{ kg: BAR, reps: 10 }]
  for (const [pct, reps] of ramp) {
    const kg = roundToPlate(workingWeight * pct)
    // Light working weights squash the ramp: skip steps at or under the bar, at or over
    // the working weight, or repeating the step before.
    if (kg <= steps[steps.length - 1].kg || kg >= workingWeight) continue
    steps.push({ kg, reps })
  }

  return steps.map(({ kg, reps }, i) => ({
    id: `W${i + 1}`,
    kg,
    reps,
    rpe: null,
    e1rm: null,
    note: "",
    isWarmup: true,
  }))
}
