import { NextResponse } from "next/server"
import { readProfile, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendsKey, friendRequestsInKey, friendRequestsOutKey, friendRequestTimesKey } from "@/lib/userKeys"

export const POST = withUser(async ({ email, user, request }) => {
  const me = email.trim().toLowerCase()

  let targetEmail: unknown
  try {
    targetEmail = (await request.json())?.targetEmail
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (!targetEmail || typeof targetEmail !== "string") {
    return NextResponse.json({ error: "targetEmail required" }, { status: 400 })
  }
  const target = targetEmail.trim().toLowerCase()

  if (target === me) {
    return NextResponse.json({ error: "cannot add yourself" }, { status: 400 })
  }

  try {
    const [targetProfile, alreadyFriend, alreadyPending, theyAsked] = await Promise.all([
      readProfile(target),
      store.sismember(friendsKey(me), target),
      store.sismember(friendRequestsOutKey(me), target),
      store.sismember(friendRequestsInKey(me), target),
    ])

    if (!targetProfile) {
      return NextResponse.json({ error: "user not found" }, { status: 404 })
    }
    if (alreadyFriend) {
      return NextResponse.json({ error: "already friends" }, { status: 409 })
    }
    if (alreadyPending) {
      return NextResponse.json({ error: "request already sent" }, { status: 409 })
    }

    const myProfile = await readProfile(me)
    const senderName = myProfile?.name ?? user.name ?? me

    // They already asked me: asking back is a yes, so accept rather than leave two
    // requests crossing in the post.
    if (theyAsked) {
      await Promise.all([
        store.sadd(friendsKey(me), target),
        store.sadd(friendsKey(target), me),
        store.srem(friendRequestsInKey(me), target),
        store.srem(friendRequestsOutKey(target), me),
        store.hdel(friendRequestTimesKey(me), target),
      ])
      import("@/lib/pushNotify").then(({ sendPushToUser }) =>
        sendPushToUser(target, {
          title: "Friend request accepted",
          body: `${senderName} accepted your gymbro request`,
          tag: "friend-accepted",
          url: "/gymbros",
        })
      ).catch(() => {})
      return NextResponse.json({ ok: true, accepted: true })
    }

    await Promise.all([
      store.sadd(friendRequestsInKey(target), me),
      store.sadd(friendRequestsOutKey(me), target),
      store.hset(friendRequestTimesKey(target), { [me]: new Date().toISOString() }),
    ])
    import("@/lib/pushNotify").then(({ sendPushToUser }) =>
      sendPushToUser(target, {
        title: "New friend request",
        body: `${senderName} wants to be your gymbro`,
        tag: "friend-request",
        url: "/gymbros",
      })
    ).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
