/** Brzycki e1RM formula: weight × (36 / (37 − reps)) */
export function calcE1RM(kg: number, reps: number): number | null {
  if (reps <= 0 || reps >= 37) return null
  const raw = kg * (36 / (37 - reps))
  return Math.round(raw * 10) / 10
}

/**
 * Brzycki on the reps a set had in it: the reps done plus the reps left in the tank
 * (RIR), unrounded, for the load maths in the prescription engine. Past the formula's
 * range (37 and up) it falls back to the weight itself rather than going negative.
 */
export function calcE1RMFromRepsInTank(kg: number, repsInTank: number): number {
  return repsInTank >= 37 ? kg : kg * (36 / (37 - repsInTank))
}

/** Round value to nearest increment (default 2.5kg plate) */
export function roundToPlate(value: number, increment = 2.5): number {
  return Math.round(value / increment) * increment
}
