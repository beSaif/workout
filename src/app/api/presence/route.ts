import { NextResponse } from "next/server"
import { UserProfile, UserPresence } from "@/lib/types"
import { readProfiles, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendsKey, presenceKey } from "@/lib/userKeys"

export const GET = withUser(async ({ email }) => {
  const me = email.trim().toLowerCase()

  try {
    // Only the viewer and their gymbros: whether a stranger is mid-session is not
    // anyone else's business.
    const friends = await store.smembers(friendsKey(me))
    const emails = [me, ...friends.filter((e) => e !== me)]

    const profiles = await readProfiles(emails)
    const validProfiles = profiles.filter((p): p is UserProfile => p !== null && typeof p === "object")

    const pKeys = validProfiles.map((p) => presenceKey(p.email))
    const rawPresences = pKeys.length > 0 ? await store.mget(...pKeys) : []

    const result: UserPresence[] = validProfiles.map((profile, i) => {
      const rec = rawPresences[i] as { inSession?: boolean; startedAt?: string | null } | null
      return {
        email: profile.email,
        name: profile.name,
        inSession: rec?.inSession ?? false,
        startedAt: rec?.startedAt ?? null,
      }
    })

    return NextResponse.json(result)
  } catch {
    return NextResponse.json([], { status: 503 })
  }
})

export const POST = withUser(async ({ email, request }) => {
  try {
    const body = await request.json()
    const inSession = Boolean(body?.inSession)
    const record = {
      inSession,
      startedAt: inSession ? new Date().toISOString() : null,
    }
    // 3-hour TTL clears stale presence if app crashes mid-session
    await store.set(presenceKey(email), record, { ex: 10800 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "KV write failed" }, { status: 503 })
  }
})
