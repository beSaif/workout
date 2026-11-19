import { NextResponse } from "next/server"
import { store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { exercisesKey } from "@/lib/userKeys"
import { getCoach, syncAthleteSplit } from "@/lib/coach"
import { isMuscleGroupConfigArray } from "@/lib/validate"

/**
 * GET answers with the split this user trains. For someone training under a coach
 * that is the coach's routine, synced into their own key on the way out — which is
 * the whole live link: the client's ordinary load picks up the coach's edits.
 */
export const GET = withUser(async ({ email }) => {
  try {
    if (await getCoach(email)) {
      const { config } = await syncAthleteSplit(email)
      return NextResponse.json(config)
    }
    const data = await store.get(exercisesKey(email))
    if (!data) return NextResponse.json(null)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(null, { status: 503 })
  }
})

/**
 * While training under a coach the split is theirs, so a save keeps only what is
 * the athlete's own — their cardio library — and the coach's groups win. The
 * exercise screens are read-only in that state; this is the backstop.
 */
export const POST = withUser(async ({ email, request }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (!isMuscleGroupConfigArray(body)) {
    return NextResponse.json({ error: "expected an array of muscle groups" }, { status: 400 })
  }

  try {
    if (await getCoach(email)) {
      const { config } = await syncAthleteSplit(email, body)
      return NextResponse.json({ ok: true, following: true, config })
    }
    await store.set(exercisesKey(email), body)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "KV write failed" }, { status: 503 })
  }
})
