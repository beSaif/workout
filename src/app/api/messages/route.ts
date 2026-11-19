import { NextResponse } from "next/server"
import { GymbroMessage } from "@/lib/types"
import { store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { messageInboxKey } from "@/lib/userKeys"

export const GET = withUser(async ({ email }) => {
  const me = email.trim().toLowerCase()

  let raw: unknown[]
  try {
    raw = await store.lrange(messageInboxKey(me), 0, -1)
  } catch {
    return NextResponse.json([], { status: 503 })
  }
  const messages: GymbroMessage[] = raw
    .map((item) => {
      try {
        return typeof item === "string" ? JSON.parse(item) : item
      } catch {
        return null
      }
    })
    .filter((m): m is GymbroMessage => m !== null)
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())

  return NextResponse.json(messages)
})

export const DELETE = withUser(async ({ email, request }) => {
  const me = email.trim().toLowerCase()
  const key = messageInboxKey(me)

  let fromEmail: string | null = null
  try {
    const body = await request.json()
    if (body?.fromEmail && typeof body.fromEmail === "string") {
      fromEmail = body.fromEmail.trim().toLowerCase()
    }
  } catch {
    // no body — delete all
  }

  try {
    if (!fromEmail) {
      await store.del(key)
      return NextResponse.json({ ok: true })
    }

    // Selective delete: keep messages not from this sender
    const raw = await store.lrange(key, 0, -1)
    const remaining = raw
      .map((item) => {
        try { return typeof item === "string" ? JSON.parse(item) : item } catch { return null }
      })
      .filter((m): m is GymbroMessage => m !== null && m.fromEmail !== fromEmail)

    await store.del(key)
    if (remaining.length > 0) {
      await store.rpush(key, ...remaining.map((m) => JSON.stringify(m)))
      await store.expire(key, 60 * 60 * 24 * 7)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
