import "server-only"
import { readProfiles, store } from "./server/db"
import { TrainingDay, UserProfile } from "./types"
import {
  MuscleGroupConfig,
  DEFAULT_MUSCLE_GROUPS,
  DEFAULT_TRAINING_DAYS,
  retireReplacedGroups,
} from "./exerciseConfig"
import { RoutineBundle, PersonSummary, buildRoutineBundle } from "./routines"
import { athletesKey, coachKey, exercisesKey, trainingDaysKey } from "./userKeys"

/**
 * The coach / athlete link, server side.
 *
 * Each user stores at most one coach pointer. Following the pointers from a user
 * lands on the person whose routine they actually train: if A trains under B and B
 * trains under C, A gets C's routine, because that is what B trains. Cycles are
 * refused when a link is made (`wouldCycle`), and the walk below is bounded and
 * remembers where it has been in case two links race past that check.
 */

/** Far longer than any real chain; only here so a corrupt loop cannot spin. */
const MAX_CHAIN = 16

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

export async function getCoach(email: string): Promise<string | null> {
  const coach = await store.get<string>(coachKey(email))
  return typeof coach === "string" && coach ? normalize(coach) : null
}

/** The email whose own groups and days this user trains. Themselves if they have no coach. */
export async function resolveRoutineSource(email: string): Promise<string> {
  let current = normalize(email)
  const seen = new Set([current])
  for (let i = 0; i < MAX_CHAIN; i++) {
    const next = await getCoach(current)
    if (!next || seen.has(next)) break
    seen.add(next)
    current = next
  }
  return current
}

/** Would `athlete` training under `coach` close a loop back to `athlete`? */
export async function wouldCycle(athlete: string, coach: string): Promise<boolean> {
  const target = normalize(athlete)
  let current: string | null = normalize(coach)
  const seen = new Set<string>()
  for (let i = 0; current && i < MAX_CHAIN; i++) {
    if (current === target) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = await getCoach(current)
  }
  return false
}

/** A user's own stored split, falling back to the defaults every new account starts on. */
async function loadStoredSplit(
  email: string
): Promise<{ config: MuscleGroupConfig[] | null; days: TrainingDay[] | null }> {
  const [config, days] = await Promise.all([
    store.get<MuscleGroupConfig[]>(exercisesKey(email)),
    store.get<TrainingDay[]>(trainingDaysKey(email)),
  ])
  return {
    config: Array.isArray(config) && config.length > 0 ? config : null,
    days: Array.isArray(days) && days.length > 0 ? days : null,
  }
}

/** The routine a user trains — their coach's (resolved down the chain) or their own. */
export async function loadRoutineOf(email: string): Promise<RoutineBundle> {
  const source = await resolveRoutineSource(email)
  const { config, days } = await loadStoredSplit(source)
  return buildRoutineBundle(config ?? DEFAULT_MUSCLE_GROUPS, days ?? DEFAULT_TRAINING_DAYS)
}

/**
 * Bring an athlete's stored split in line with their coach's routine, and return it.
 *
 * The coach's groups replace the athlete's; anything the athlete had that the coach
 * does not is kept as a retired, name-only entry so their history still reads right,
 * and their cardio library is left alone — it was never part of anyone's routine.
 *
 * `ownConfig` lets a caller pass a config the athlete is in the middle of saving, so
 * a cardio edit made while following survives even though split edits do not.
 * Writes only when something changed, so an idle GET costs no KV write.
 */
export async function syncAthleteSplit(
  athlete: string,
  ownConfig?: MuscleGroupConfig[]
): Promise<{ config: MuscleGroupConfig[]; days: TrainingDay[] }> {
  const [routine, stored] = await Promise.all([loadRoutineOf(athlete), loadStoredSplit(athlete)])
  const outgoing = ownConfig ?? stored.config ?? DEFAULT_MUSCLE_GROUPS
  const config = retireReplacedGroups(routine.muscleGroups, outgoing)
  const days = routine.trainingDays

  const writes: Promise<unknown>[] = []
  if (JSON.stringify(config) !== JSON.stringify(stored.config)) {
    writes.push(store.set(exercisesKey(athlete), config))
  }
  if (JSON.stringify(days) !== JSON.stringify(stored.days)) {
    writes.push(store.set(trainingDaysKey(athlete), days))
  }
  await Promise.all(writes)
  return { config, days }
}

/**
 * End a coaching link, leaving the athlete on the last version of the routine as
 * their own. Safe to call when there is no link.
 */
export async function stopTrainingUnder(athlete: string): Promise<void> {
  const coach = await getCoach(athlete)
  if (!coach) return
  await syncAthleteSplit(athlete)
  await Promise.all([store.del(coachKey(athlete)), store.srem(athletesKey(coach), normalize(athlete))])
}

export async function countAthletes(email: string): Promise<number> {
  return store.scard(athletesKey(email))
}

export function toPersonSummary(profile: UserProfile): PersonSummary {
  const person: PersonSummary = { email: profile.email, name: profile.name }
  if (profile.trainingMode) person.trainingMode = profile.trainingMode
  if (profile.mainLift) person.mainLift = profile.mainLift
  return person
}

/** Summaries for a set of emails, in the order given, skipping accounts that are gone. */
export async function loadPeople(emails: string[]): Promise<PersonSummary[]> {
  if (emails.length === 0) return []
  const profiles = await readProfiles(emails)
  return profiles
    .filter((p): p is UserProfile => p !== null && typeof p === "object" && !!p.email)
    .map(toPersonSummary)
}
