import { NextResponse } from "next/server"
import { ReminderState } from "@/lib/reminders"
import { store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { pushSubKey, reminderStateKey } from "@/lib/userKeys"

export const POST = withUser(async ({ email, request }) => {
  try {
    const body = await request.json()
    // The app sends `{ subscription, tz }`; the service worker's `pushsubscriptionchange`
    // handler re-registers with a bare subscription, so both shapes are accepted.
    const sub = body?.subscription ?? body
    const tz = typeof body?.tz === "string" ? body.tz : null

    if (!sub?.endpoint) {
      return NextResponse.json({ error: "invalid subscription" }, { status: 400 })
    }
    await store.set(pushSubKey(email), sub)

    // The daily job runs in UTC and has to ask "did they weigh in today" in the user's
    // own calendar day. This is the one moment we know the answer: the device that can
    // receive the reminder is right here telling us where it is.
    if (tz) {
      const state = (await store.get<ReminderState>(reminderStateKey(email))) ?? {}
      if (state.tz !== tz) {
        await store.set(reminderStateKey(email), { ...state, tz })
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
