import { NextResponse } from "next/server"
import { UserProfile } from "@/lib/types"
import { readProfiles, readValidSessionsDocs, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendsKey } from "@/lib/userKeys"

export const GET = withUser(async ({ email }) => {
  const me = email.trim().toLowerCase()

  try {
    const friendEmails = await store.smembers(friendsKey(me))
    if (friendEmails.length === 0) return NextResponse.json([])

    // Read-only: a friend's malformed sessions document counts as no sessions.
    const [profiles, sessionDocs] = await Promise.all([
      readProfiles(friendEmails),
      readValidSessionsDocs(friendEmails),
    ])

    const lastActiveDates: Record<string, string> = {}
    friendEmails.forEach((friend, i) => {
      const confirmed = sessionDocs[i].sessions
        .filter((s) => s.confirmed && s.date)
        .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
      if (confirmed[0]) lastActiveDates[friend] = confirmed[0].date!
    })

    const valid = profiles
      .filter((p): p is UserProfile => p !== null && typeof p === "object")
      .sort((a, b) => a.name.localeCompare(b.name))
      // Keyed by the lowercased set member; the profile keeps the email as typed.
      .map((p) => ({ ...p, lastSessionDate: lastActiveDates[p.email.trim().toLowerCase()] ?? null }))

    return NextResponse.json(valid)
  } catch {
    return NextResponse.json([], { status: 503 })
  }
})

export const DELETE = withUser(async ({ email, request }) => {
  const me = email.trim().toLowerCase()

  let friendEmail: unknown
  try {
    friendEmail = (await request.json())?.friendEmail
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (!friendEmail || typeof friendEmail !== "string") {
    return NextResponse.json({ error: "friendEmail required" }, { status: 400 })
  }
  const friend = friendEmail.trim().toLowerCase()

  try {
    await Promise.all([
      store.srem(friendsKey(me), friend),
      store.srem(friendsKey(friend), me),
    ])
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
