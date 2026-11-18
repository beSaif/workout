import { NextResponse } from "next/server"
import { readSessionsDoc, writeSessionsDoc } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { parseSessionsPayload } from "@/lib/validate"

export const GET = withUser(async ({ email }) => {
  try {
    const doc = await readSessionsDoc(email)
    // null means "never synced" — the client falls back to localStorage for migration
    // and uploads it over ours. So a stored document goes back as stored even when it
    // fails validation: answering null for it would get the user's data overwritten.
    if (!doc) return NextResponse.json(null)
    return NextResponse.json(doc.stored)
  } catch {
    return NextResponse.json(null, { status: 503 })
  }
})

export const POST = withUser(async ({ email, request }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const payload = parseSessionsPayload(body)
  if (!payload) return NextResponse.json({ error: "expected { sessions, blocks }" }, { status: 400 })

  try {
    await writeSessionsDoc(email, payload)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "KV write failed" }, { status: 503 })
  }
})
