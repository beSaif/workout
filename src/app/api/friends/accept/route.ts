import { NextResponse } from "next/server"
import { readProfile, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendsKey, friendRequestsInKey, friendRequestsOutKey, friendRequestTimesKey } from "@/lib/userKeys"

export const POST = withUser(async ({ email, user, request }) => {
  const me = email.trim().toLowerCase()

  let requesterEmail: unknown
  try {
    requesterEmail = (await request.json())?.requesterEmail
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (!requesterEmail || typeof requesterEmail !== "string") {
    return NextResponse.json({ error: "requesterEmail required" }, { status: 400 })
  }
  const requester = requesterEmail.trim().toLowerCase()

  try {
    const requestExists = await store.sismember(friendRequestsInKey(me), requester)
    if (!requestExists) {
      return NextResponse.json({ error: "no such request" }, { status: 404 })
    }

    await Promise.all([
      store.sadd(friendsKey(me), requester),
      store.sadd(friendsKey(requester), me),
      store.srem(friendRequestsInKey(me), requester),
      store.srem(friendRequestsOutKey(requester), me),
      store.hdel(friendRequestTimesKey(me), requester),
    ])

    const myProfile = await readProfile(me)
    const acceptorName = myProfile?.name ?? user.name ?? me
    import("@/lib/pushNotify").then(({ sendPushToUser }) =>
      sendPushToUser(requester, {
        title: "Friend request accepted",
        body: `${acceptorName} accepted your gymbro request`,
        tag: "friend-accepted",
        url: "/gymbros",
      })
    ).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
