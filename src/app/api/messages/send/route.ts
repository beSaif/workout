import { NextResponse } from "next/server"
import { GymbroMessage } from "@/lib/types"
import { readProfile, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { friendsKey, messageInboxKey } from "@/lib/userKeys"
import { sendPushToUser } from "@/lib/pushNotify"

export const POST = withUser(async ({ email, user, request }) => {
  const me = email.trim().toLowerCase()

  let body: { toEmail?: unknown; text?: unknown } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const { toEmail, text } = (body ?? {}) as { toEmail: string; text: string }

  if (!toEmail || typeof toEmail !== "string" || !text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "toEmail and text required" }, { status: 400 })
  }
  if (text.trim().length > 300) {
    return NextResponse.json({ error: "message too long" }, { status: 400 })
  }

  try {
    const myProfile = await readProfile(me)
    const fromName = myProfile?.name ?? user.name ?? "Someone"

    let recipients: string[]
    if (toEmail === "all") {
      recipients = await store.smembers(friendsKey(me))
    } else {
      const friend = toEmail.trim().toLowerCase()
      const isFriend = await store.sismember(friendsKey(me), friend)
      if (!isFriend) {
        return NextResponse.json({ error: "not a friend" }, { status: 403 })
      }
      recipients = [friend]
    }

    if (recipients.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 })
    }

    const message: GymbroMessage = {
      id: crypto.randomUUID(),
      fromEmail: me,
      fromName,
      text: text.trim(),
      sentAt: new Date().toISOString(),
    }
    const json = JSON.stringify(message)

    await Promise.all(
      recipients.map(async (recipient) => {
        const key = messageInboxKey(recipient)
        await store.rpush(key, json)
        await store.expire(key, 60 * 60 * 24 * 7)
        await sendPushToUser(recipient, {
          title: `🔥 ${fromName}`,
          body: text.trim(),
          tag: "gymbro-message",
          url: "/",
        })
      })
    )

    return NextResponse.json({ ok: true, sent: recipients.length })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
