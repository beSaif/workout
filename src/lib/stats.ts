import { MuscleGroup, Session, isCardioSet } from "@/lib/types"

export function getBestE1RM(sessions: Session[]): number | null {
  const validSets = sessions
    .filter((s) => s.confirmed && s.date != null && s.type !== "Deload")
    .flatMap((s) => s.sets.filter((set) => !set.isWarmup))
    .map((set) => set.e1rm)
    .filter((v): v is number => v != null)
  return validSets.length > 0 ? Math.max(...validSets) : null
}

export function getBestWeight(sessions: Session[]): number | null {
  const all = sessions
    .filter((s) => s.confirmed)
    .flatMap((s) => s.sets.filter((set) => !set.isWarmup && set.reps > 0))
    .map((s) => s.kg)
    .filter((v): v is number => v != null)
  return all.length > 0 ? Math.max(...all) : null
}

export function getLatestBW(sessions: Session[]): number | null {
  const withBW = sessions
    .filter((s) => s.confirmed && s.bw != null && s.date != null)
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
  return withBW[0]?.bw ?? null
}

export interface SessionSummary {
  weight: number | null
  reps: number | null
  setCount: number
  bestE1RM: number | null
}

/** Top working-set weight/reps, working-set count, and best e1RM for a single session. */
export function sessionSummary(session: Session): SessionSummary {
  const working = session.sets.filter((s) => !s.isWarmup)
  const e1rms = working.map((s) => s.e1rm).filter((v): v is number => v != null)
  return {
    weight: working[0]?.kg ?? null,
    reps: working[0]?.reps ?? null,
    setCount: working.length,
    bestE1RM: e1rms.length > 0 ? Math.max(...e1rms) : null,
  }
}

export interface WorkSummary {
  /** Muscle groups this session trained, by id. */
  muscles: MuscleGroup[]
  /** Distinct exercises worked, main lift included when it has working sets. */
  exercises: number
  /** Working sets across the main lift and every accessory. */
  sets: number
  /** Total tonnage (kg × reps) across those sets. Cardio adds nothing to it. */
  volume: number
  /** Heaviest single set of the session, whatever exercise it came from. */
  topSet: { kg: number; reps: number; exercise: string } | null
  /** Minutes of cardio logged, across every timed exercise. 0 when there was none. */
  cardioMinutes: number
}

/**
 * Everything a session actually contained, accessories included. Balanced-mode
 * sessions carry no main lift, so `sessionSummary` alone reports them as empty.
 */
export function sessionWork(session: Session, mainLiftLabel = "Main Lift"): WorkSummary {
  const working = session.sets.filter((s) => !s.isWarmup)
  const extras = session.extraWorkouts ?? []

  let exercises = working.length > 0 ? 1 : 0
  let sets = working.length
  let volume = working.reduce((sum, s) => sum + s.kg * s.reps, 0)
  // A missed attempt (0 reps) was never lifted, so it can't be the top set.
  const made = working.filter((s) => s.reps > 0)
  let topSet: { kg: number; reps: number } | null =
    made.length > 0 ? made.reduce((best, s) => (s.kg > best.kg ? s : best), made[0]) : null
  let topSetLabel = mainLiftLabel

  let cardioMinutes = 0

  for (const workout of extras) {
    for (const exercise of workout.exercises) {
      if (exercise.sets.length === 0) continue
      exercises += 1
      sets += exercise.sets.length
      for (const set of exercise.sets) {
        // A cardio bout carries time, not load: it counts as work done, but it can
        // neither add tonnage nor become the session's top set at 0kg.
        if (isCardioSet(set)) {
          cardioMinutes += set.minutes ?? 0
          continue
        }
        volume += set.kg * set.reps
        if (topSet == null || set.kg > topSet.kg) {
          topSet = set
          topSetLabel = exercise.name
        }
      }
    }
  }

  const muscles =
    session.selectedMuscleGroups && session.selectedMuscleGroups.length > 0
      ? session.selectedMuscleGroups
      : extras.map((w) => w.muscle)

  return {
    muscles,
    exercises,
    sets,
    volume: Math.round(volume),
    topSet: topSet ? { kg: topSet.kg, reps: topSet.reps, exercise: topSetLabel } : null,
    cardioMinutes: Math.round(cardioMinutes),
  }
}
