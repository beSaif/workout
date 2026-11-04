import { kv } from "@vercel/kv"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { Session, TrainingBlock, UserProfile, MainLift, TrainingMode } from "@/lib/types"
import { stopTrainingUnder } from "@/lib/coach"
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
  LEGACY_SESSIONS_KEY,
  LEGACY_EXERCISES_KEY,
} from "@/lib/userKeys"

const ALLOWED_LIFTS: MainLift[] = ["bench", "deadlift", "squat"]
const ALLOWED_MODES: TrainingMode[] = ["lift-focused", "balanced"]

interface LegacySessionsData {
  sessions: Session[]
  blocks: TrainingBlock[]
}

async function tryLegacyMigration(email: string): Promise<UserProfile | null> {
  if (!isLegacyOwner(email)) return null

  const [legacySessionsRaw, legacyExercises] = await Promise.all([
    kv.get(LEGACY_SESSIONS_KEY),
    kv.get(LEGACY_EXERCISES_KEY),
  ])

  if (!legacySessionsRaw && !legacyExercises) return null

  const legacy: LegacySessionsData = Array.isArray(legacySessionsRaw)
    ? { sessions: legacySessionsRaw as Session[], blocks: [] }
    : ((legacySessionsRaw as LegacySessionsData) ?? { sessions: [], blocks: [] })

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
    kv.set(profileKey(email), profile),
    kv.set(sessionsKey(email), legacy),
  ]
  if (legacyExercises) {
    writes.push(kv.set(exercisesKey(email), legacyExercises))
  }
  await Promise.all(writes)

  return profile
}

export async function GET() {
  const session = await auth()
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const existing = await kv.get<UserProfile>(profileKey(email))
    if (existing) return NextResponse.json(existing)

    const migrated = await tryLegacyMigration(email)
    if (migrated) return NextResponse.json(migrated)

    return NextResponse.json(null)
  } catch {
    return NextResponse.json(null, { status: 503 })
  }
}

export async function DELETE() {
  const session = await auth()
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    // Unlink coaching before the split goes: each athlete keeps the routine they were
    // training as their own, which needs this account's days and groups still there.
    const athletes = await kv.smembers(athletesKey(email))
    for (const athlete of athletes) await stopTrainingUnder(athlete)
    await stopTrainingUnder(email)

    // Take this account out of everyone else's sets, or their gymbro counts stay
    // inflated and a re-registration with the same email gets the old friends back.
    const me = email.trim().toLowerCase()
    const [friends, requestsIn, requestsOut] = await Promise.all([
      kv.smembers(friendsKey(me)),
      kv.smembers(friendRequestsInKey(me)),
      kv.smembers(friendRequestsOutKey(me)),
    ])
    await Promise.all([
      ...friends.map((f) => kv.srem(friendsKey(f), me)),
      ...requestsIn.map((r) => kv.srem(friendRequestsOutKey(r), me)),
      ...requestsOut.flatMap((t) => [
        kv.srem(friendRequestsInKey(t), me),
        kv.hdel(friendRequestTimesKey(t), me),
      ]),
    ])

    await Promise.all([
      kv.del(profileKey(email)),
      kv.del(sessionsKey(email)),
      kv.del(exercisesKey(email)),
      kv.del(trainingDaysKey(email)),
      kv.del(weightsKey(email)),
      kv.del(athletesKey(email)),
      kv.del(friendsKey(email)),
      kv.del(friendRequestsInKey(email)),
      kv.del(friendRequestsOutKey(email)),
      kv.del(friendRequestTimesKey(email)),
      kv.del(messageInboxKey(email)),
      kv.del(presenceKey(email)),
      // The push subscription is the cron's roster; leaving it would keep reminding
      // a deleted account.
      kv.del(pushSubKey(email)),
      kv.del(reminderStateKey(email)),
    ])
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "KV delete failed" }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const session = await auth()
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

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

  const existing = await kv.get<UserProfile>(profileKey(email))

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
    await kv.set(profileKey(email), profile)
    return NextResponse.json(profile)
  } catch {
    return NextResponse.json({ error: "KV write failed" }, { status: 503 })
  }
}
