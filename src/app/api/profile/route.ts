import { NextResponse } from "next/server"
import { UserProfile, MainLift, TrainingMode } from "@/lib/types"
import { stopTrainingUnder } from "@/lib/coach"
import {
  copySessionsDoc,
  readLegacySessionsDoc,
  readProfile,
  store,
  writeProfile,
  writeSessionsDoc,
} from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import {
  profileKey,
  sessionsKey,
  exercisesKey,
  weightsKey,
  trainingDaysKey,
  athletesKey,
  friendsKey,
  friendRequestsInKey,
  friendRequestsOutKey,
  friendRequestTimesKey,
  messageInboxKey,
  presenceKey,
  pushSubKey,
  reminderStateKey,
  isLegacyOwner,
  LEGACY_EXERCISES_KEY,
} from "@/lib/userKeys"

const ALLOWED_LIFTS: MainLift[] = ["bench", "deadlift", "squat"]
const ALLOWED_MODES: TrainingMode[] = ["lift-focused", "balanced"]

async function tryLegacyMigration(email: string): Promise<UserProfile | null> {
  if (!isLegacyOwner(email)) return null

  const [legacySessions, legacyExercises] = await Promise.all([
    readLegacySessionsDoc(),
    store.get(LEGACY_EXERCISES_KEY),
  ])

  if (!legacySessions && !legacyExercises) return null

  // Bodyweight and anchor are read from the document only when it validates. It is
  // copied across as stored either way, so the owner's history is never dropped.
  const legacy = legacySessions?.valid ?? { sessions: [], blocks: [] }

  const confirmed = legacy.sessions.filter((s) => s.confirmed && s.date)
  const latestBW = [...confirmed]
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
    .find((s) => s.bw != null)?.bw ?? 60

  const activeBlock = legacy.blocks.find((b) => b.status === "active")
  const anchor = activeBlock?.anchorWeight
    ?? legacy.blocks[legacy.blocks.length - 1]?.anchorWeight
    ?? 60

  const profile: UserProfile = {
    email,
    name: "Saif",
    bw: latestBW,
    mainLift: "bench",
    anchor,
    target: 140,
    createdAt: new Date().toISOString(),
  }

  const writes: Array<Promise<unknown>> = [
    writeProfile(email, profile),
    legacySessions ? copySessionsDoc(email, legacySessions) : writeSessionsDoc(email, legacy),
  ]
  if (legacyExercises) {
    writes.push(store.set(exercisesKey(email), legacyExercises))
  }
  await Promise.all(writes)

  return profile
}

export const GET = withUser(async ({ email }) => {
  try {
    const existing = await readProfile(email)
    if (existing) return NextResponse.json(existing)

    const migrated = await tryLegacyMigration(email)
    if (migrated) return NextResponse.json(migrated)

    return NextResponse.json(null)
  } catch {
    return NextResponse.json(null, { status: 503 })
  }
})

export const DELETE = withUser(async ({ email }) => {
  try {
    // Unlink coaching before the split goes: each athlete keeps the routine they were
    // training as their own, which needs this account's days and groups still there.
    const athletes = await store.smembers(athletesKey(email))
    for (const athlete of athletes) await stopTrainingUnder(athlete)
    await stopTrainingUnder(email)

    // Take this account out of everyone else's sets, or their gymbro counts stay
    // inflated and a re-registration with the same email gets the old friends back.
    const me = email.trim().toLowerCase()
    const [friends, requestsIn, requestsOut] = await Promise.all([
      store.smembers(friendsKey(me)),
      store.smembers(friendRequestsInKey(me)),
      store.smembers(friendRequestsOutKey(me)),
    ])
    await Promise.all([
      ...friends.map((f) => store.srem(friendsKey(f), me)),
      ...requestsIn.map((r) => store.srem(friendRequestsOutKey(r), me)),
      ...requestsOut.flatMap((t) => [
        store.srem(friendRequestsInKey(t), me),
        store.hdel(friendRequestTimesKey(t), me),
      ]),
    ])

    await Promise.all([
      store.del(profileKey(email)),
      store.del(sessionsKey(email)),
      store.del(exercisesKey(email)),
      store.del(trainingDaysKey(email)),
      store.del(weightsKey(email)),
      store.del(athletesKey(email)),
      store.del(friendsKey(email)),
      store.del(friendRequestsInKey(email)),
      store.del(friendRequestsOutKey(email)),
      store.del(friendRequestTimesKey(email)),
      store.del(messageInboxKey(email)),
      store.del(presenceKey(email)),
      // The push subscription is the cron's roster; leaving it would keep reminding
      // a deleted account.
      store.del(pushSubKey(email)),
      store.del(reminderStateKey(email)),
    ])
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "KV delete failed" }, { status: 503 })
  }
})

export const POST = withUser(async ({ email, request }) => {
  let body: Partial<UserProfile>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  const bw = Number(body.bw)
  const trainingMode: TrainingMode = body.trainingMode ?? "lift-focused"
  const mainLift = body.mainLift as MainLift | undefined
  const anchor = body.anchor === undefined || body.anchor === null ? undefined : Number(body.anchor)
  const target = body.target === undefined || body.target === null ? undefined : Number(body.target)

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 })
  if (!Number.isFinite(bw) || bw <= 0) return NextResponse.json({ error: "bw invalid" }, { status: 400 })
  if (!ALLOWED_MODES.includes(trainingMode)) return NextResponse.json({ error: "trainingMode invalid" }, { status: 400 })

  const liftValid = mainLift !== undefined && ALLOWED_LIFTS.includes(mainLift)
  const anchorValid = anchor !== undefined && Number.isFinite(anchor) && anchor > 0
  const targetValid = target !== undefined && Number.isFinite(target) && target > 0

  // Lift-focused mode prescribes from these, so they are mandatory there. Balanced mode
  // keeps whatever valid values were sent (so switching back later resumes cleanly) and
  // silently drops anything missing or malformed.
  if (trainingMode === "lift-focused") {
    if (!liftValid) return NextResponse.json({ error: "mainLift invalid" }, { status: 400 })
    if (!anchorValid) return NextResponse.json({ error: "anchor invalid" }, { status: 400 })
    if (!targetValid) return NextResponse.json({ error: "target invalid" }, { status: 400 })
  }

  const existing = await readProfile(email)

  // This handler rebuilds the profile from scratch, so any field it doesn't name is
  // dropped. The three callers of saveProfile all send the whole profile as they knew
  // it, and none of them know about the weight fields — without this merge, editing
  // your name on /profile would silently switch check-ins back off. A missing value
  // here means "unchanged", deliberately unlike `trainingMode` above, which defaults.
  const weighInDaily =
    typeof body.weighInDaily === "boolean" ? body.weighInDaily : existing?.weighInDaily
  // Asked once at onboarding; later saves that don't send it keep the answer.
  const trainingAge =
    body.trainingAge === "new" || body.trainingAge === "some" || body.trainingAge === "years"
      ? body.trainingAge
      : existing?.trainingAge
  const goalBwRaw = Number(body.goalBw)
  const goalBw =
    Number.isFinite(goalBwRaw) && goalBwRaw > 0 ? goalBwRaw : existing?.goalBw

  const profile: UserProfile = {
    email,
    name,
    bw,
    trainingMode,
    ...(liftValid ? { mainLift } : {}),
    ...(anchorValid ? { anchor } : {}),
    ...(targetValid ? { target } : {}),
    // Left absent while the user has never been asked, which is what fires the prompt.
    ...(weighInDaily !== undefined ? { weighInDaily } : {}),
    ...(goalBw !== undefined ? { goalBw } : {}),
    ...(trainingAge !== undefined ? { trainingAge } : {}),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }

  try {
    await writeProfile(email, profile)
    return NextResponse.json(profile)
  } catch {
    return NextResponse.json({ error: "KV write failed" }, { status: 503 })
  }
})
