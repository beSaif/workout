import type { FriendCardStats } from "../../../../src/lib/friendCard"
import type { ProfileSocial, RoutineBundle, PersonSummary } from "../../../../src/lib/routines"
import type { FriendSessionSummary, GymbroMessage, UserPresence, UserProfile } from "../../../../src/lib/types"
import { E2E_USER, onboardedProfile } from "./harness"

/**
 * Fake people and response bodies for the social journeys (gymbros, friend-profile,
 * messages, my-card), shaped like src/app/api/** answers. Obviously fake addresses only.
 */

const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

export const OMAR: UserProfile = {
  email: "omar@example.invalid",
  name: "Omar Example",
  bw: 85,
  trainingMode: "lift-focused",
  mainLift: "bench",
  anchor: 90,
  target: 120,
  createdAt: daysAgoIso(200),
}

export const LEA: UserProfile = {
  email: "lea@example.invalid",
  name: "Lea Placeholder",
  bw: 62,
  trainingMode: "balanced",
  createdAt: daysAgoIso(100),
}

/** GET /api/friends: friend profiles with their last session date attached. */
export function friendsList(...people: UserProfile[]) {
  return people.map((p) => ({ ...p, lastSessionDate: daysAgoIso(1) }))
}

export function summary(p: UserProfile): PersonSummary {
  return { email: p.email, name: p.name, trainingMode: p.trainingMode, mainLift: p.mainLift }
}

export function presence(p: UserProfile, inSession: boolean): UserPresence {
  return { email: p.email, name: p.name, inSession, startedAt: inSession ? daysAgoIso(0.01) : null }
}

export function message(from: UserProfile, text: string, minutesAgo = 5): GymbroMessage {
  return {
    id: `msg-${from.email}-${minutesAgo}`,
    fromEmail: from.email,
    fromName: from.name,
    text,
    sentAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  }
}

const card: FriendCardStats = {
  level: 12,
  dayDots: Array.from({ length: 28 }, (_, i) => i % 3 === 0),
  weekStreak: 3,
  sessionsThisWeek: 1,
  daysSinceLast: 1,
  sessionsInWindow: 9,
  avgPerWeek: 2.3,
  records: [
    { exercise: "Bench Press", kg: 95, reps: 1, date: daysAgoIso(3), isFresh: true },
    { exercise: "Incline Press", kg: 60, reps: 8, date: daysAgoIso(20), isFresh: false },
  ],
  standingKg: 95,
  progressPct: 79,
  rarity: "rare",
}

const routine: RoutineBundle = {
  muscleGroups: [
    {
      id: "chest",
      name: "Chest",
      order: 0,
      exercises: [{ id: "incline-press", name: "Incline Press", order: 0, defaultSets: 3 }],
    },
  ],
  trainingDays: [{ id: "day-a", name: "Push Day", order: 0, muscleGroupIds: ["chest"] }],
}

const lastSessionSummary: FriendSessionSummary = {
  label: "Session 12",
  muscles: ["Chest"],
  exercises: 2,
  sets: 9,
  volume: 3240,
  topSet: { kg: 95, reps: 1, exercise: "Bench Press" },
}

/** GET /api/friends/profile?email=<friend> as a gymbro sees it. */
export function friendProfile(p: UserProfile, social: Partial<ProfileSocial> = {}) {
  return {
    profile: p,
    lastSession: null,
    lastSessionSummary,
    card,
    social: {
      gymbroCount: 4,
      athleteCount: 1,
      coach: null,
      isSelf: false,
      isFriend: true,
      requestPending: false,
      isMyCoach: false,
      ...social,
    } satisfies ProfileSocial,
    routine,
  }
}

/** GET /api/friends/profile with no email: the viewer's own card (/me). */
export function myCardProfile() {
  return {
    profile: { ...onboardedProfile(), email: E2E_USER.email, name: E2E_USER.name },
    lastSessionSummary: null,
    card: { ...card, level: 5, records: [{ exercise: "Bench Press", kg: 80, reps: 3, date: daysAgoIso(2), isFresh: true }], standingKg: 80, progressPct: 80 },
    social: {
      gymbroCount: 2,
      athleteCount: 0,
      coach: null,
      isSelf: true,
      isFriend: false,
      requestPending: false,
      isMyCoach: false,
    } satisfies ProfileSocial,
    routine,
  }
}

export { answer } from "./harness"

export { routine as OMAR_ROUTINE }
