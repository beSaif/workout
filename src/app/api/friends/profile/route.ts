import { NextResponse } from "next/server"
import { PublicProfile, Session, TrainingDay, FriendSessionSummary } from "@/lib/types"
import { readProfile, readValidSessionsDoc, store } from "@/lib/server/db"
import { withUser, type UserRouteContext } from "@/lib/server/withUser"
import {
  friendsKey,
  friendRequestsOutKey,
  trainingDaysKey,
  exercisesKey,
} from "@/lib/userKeys"
import {
  MuscleGroupConfig,
  DEFAULT_MUSCLE_GROUPS,
  DEFAULT_TRAINING_DAYS,
  getMuscleLabel,
} from "@/lib/exerciseConfig"
import { getSessionLabel, getMainLiftLabel, isLiftFocused } from "@/lib/trainingMode"
import { sessionWork } from "@/lib/stats"
import { buildFriendCard } from "@/lib/friendCard"
import { ProfileSocial } from "@/lib/routines"
import { countAthletes, getCoach, loadPeople, loadRoutineOf } from "@/lib/coach"

/**
 * GET /api/friends/profile?email= → someone's profile: their card, their routine,
 * and how many gymbros and athletes they have. No email means the viewer's own.
 *
 * Profiles are open to anyone signed in, because everyone's routine is public. What
 * stays gymbros-only is the personal part: the full profile and the last session.
 * A stranger gets the aggregated card (streaks and records, never raw sessions)
 * and only the profile fields the card draws.
 */
export const GET = withUser(async (ctx) => {
  try {
    return await profileView(ctx)
  } catch {
    // The client only checks `ok`; this keeps a KV outage from reading as a bare 500.
    return NextResponse.json({ error: "KV read failed" }, { status: 503 })
  }
})

async function profileView({ email: myEmail, request }: UserRouteContext<Record<string, never>>): Promise<Response> {
  const { searchParams } = new URL(request.url)
  // No email means "my own card": /me reads the card it would show a gymbro, of
  // the viewer. Everything below is already computed from one user's own data.
  const myEmailLower = myEmail.trim().toLowerCase()
  const targetEmail = searchParams.get("email")?.trim().toLowerCase() || myEmailLower

  const isSelf = targetEmail === myEmailLower

  const [
    profile,
    sessionsDoc,
    trainingDaysRaw,
    exercisesRaw,
    isFriendRaw,
    requestPendingRaw,
    gymbroCount,
    athleteCount,
    coachEmail,
    myCoach,
  ] = await Promise.all([
    readProfile(targetEmail),
    // Read-only, so a malformed document shows as no sessions.
    readValidSessionsDoc(targetEmail),
    store.get<TrainingDay[]>(trainingDaysKey(targetEmail)),
    store.get<MuscleGroupConfig[]>(exercisesKey(targetEmail)),
    isSelf ? 0 : store.sismember(friendsKey(myEmailLower), targetEmail),
    isSelf ? 0 : store.sismember(friendRequestsOutKey(myEmailLower), targetEmail),
    store.scard(friendsKey(targetEmail)),
    countAthletes(targetEmail),
    getCoach(targetEmail),
    isSelf ? null : getCoach(myEmailLower),
  ])

  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 })

  const isFriend = !!isFriendRaw
  const [coach] = coachEmail ? await loadPeople([coachEmail]) : []
  const routine = await loadRoutineOf(targetEmail)
  const social: ProfileSocial = {
    gymbroCount,
    athleteCount,
    coach: coach ?? null,
    isSelf,
    isFriend,
    requestPending: !!requestPendingRaw,
    isMyCoach: myCoach === targetEmail,
  }

  const allSessions = sessionsDoc.sessions

  const confirmed = allSessions
    .filter((s) => s.confirmed && s.date)
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
  const lastSession: Session | null = confirmed[0] ?? null

  let lastSessionSummary: FriendSessionSummary | null = null
  if (lastSession) {
    const trainingDays = trainingDaysRaw?.length ? trainingDaysRaw : DEFAULT_TRAINING_DAYS
    const exerciseConfig = exercisesRaw?.length ? exercisesRaw : DEFAULT_MUSCLE_GROUPS
    const work = sessionWork(lastSession, getMainLiftLabel(profile))
    lastSessionSummary = {
      label: getSessionLabel(lastSession, trainingDays),
      muscles: work.muscles.map((m) => getMuscleLabel(exerciseConfig, m)),
      exercises: work.exercises,
      sets: work.sets,
      volume: work.volume,
      topSet: work.topSet,
    }
  }

  // Aggregated here on purpose: the viewer gets streaks and records, never the
  // friend's raw session list.
  const card = buildFriendCard(allSessions, {
    mainLiftLabel: getMainLiftLabel(profile),
    anchor: profile.anchor ?? null,
    target: profile.target ?? null,
    liftFocused: isLiftFocused(profile),
  })

  if (!isSelf && !isFriend) {
    const publicProfile: PublicProfile = {
      email: profile.email,
      name: profile.name,
      trainingMode: profile.trainingMode,
      mainLift: profile.mainLift,
      anchor: profile.anchor,
      target: profile.target,
    }
    return NextResponse.json({
      profile: publicProfile,
      lastSession: null,
      lastSessionSummary: null,
      card,
      social,
      routine,
    })
  }

  return NextResponse.json({ profile, lastSession, lastSessionSummary, card, social, routine })
}
