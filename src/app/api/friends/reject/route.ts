import { NextResponse } from "next/server"
import { store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendRequestsInKey, friendRequestsOutKey, friendRequestTimesKey } from "@/lib/userKeys"

export const POST = withUser(async ({ email, request }) => {
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
    await Promise.all([
      store.srem(friendRequestsInKey(me), requester),
      store.srem(friendRequestsOutKey(requester), me),
      store.hdel(friendRequestTimesKey(me), requester),
    ])
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
