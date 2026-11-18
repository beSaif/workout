import { NextResponse } from "next/server"
import { UserProfile, FriendRequest } from "@/lib/types"
import { readProfiles, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendRequestTimesKey, friendRequestsInKey } from "@/lib/userKeys"

export const GET = withUser(async ({ email }) => {
  const me = email.trim().toLowerCase()

  try {
    const requesterEmails = await store.smembers(friendRequestsInKey(me))
    if (requesterEmails.length === 0) {
      return NextResponse.json({ requests: [], count: 0 })
    }

    const [profiles, times] = await Promise.all([
      readProfiles(requesterEmails),
      store.hgetall<Record<string, string>>(friendRequestTimesKey(me)),
    ])
    // Requests sent before the time was recorded fall back to the requester's signup.
    const requests: FriendRequest[] = profiles
      .filter((p): p is UserProfile => p !== null && typeof p === "object")
      .map((p) => ({
        email: p.email,
        name: p.name,
        sentAt: times?.[p.email.trim().toLowerCase()] ?? p.createdAt,
      }))

    return NextResponse.json({ requests, count: requests.length })
  } catch {
    return NextResponse.json({ requests: [], count: 0 }, { status: 503 })
  }
})
