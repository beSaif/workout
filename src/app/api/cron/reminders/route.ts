import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { sendPushToUser } from "@/lib/pushNotify"
import { ReminderState, decideReminder } from "@/lib/reminders"
import { readProfile, readValidSessionsDoc, store } from "@/lib/server/db"
import { WeightEntry } from "@/lib/types"
import { emailFromPushSubKey, pushSubKey, reminderStateKey, weightsKey } from "@/lib/userKeys"

/**
 * The daily reminder job, run by the Vercel cron declared in `vercel.json`.
 *
 * Everything it needs already lives in KV — weigh-ins, sessions, the push subscription —
 * so the reminders keep working with the app closed and the phone in a drawer. The rules
 * themselves are in `@/lib/reminders`; this file only fetches, sends and records.
 */

// A dozen KV round-trips per user, and the platform default is too tight to grow into.
export const maxDuration = 60

interface UserOutcome {
  email: string
  kind: string | null
  title?: string
  sent: boolean
}

async function processUser(email: string, send: boolean): Promise<UserOutcome> {
  // Read-only, so a malformed sessions document counts as no sessions.
  const [profile, weightsRaw, sessionsDoc, stateRaw] = await Promise.all([
    readProfile(email),
    store.get<WeightEntry[]>(weightsKey(email)),
    readValidSessionsDoc(email),
    store.get<ReminderState>(reminderStateKey(email)),
  ])

  const state = stateRaw ?? {}
  const decision = decideReminder({
    profile,
    weights: Array.isArray(weightsRaw) ? weightsRaw : [],
    sessions: sessionsDoc.sessions,
    state,
  })

  if (!decision) return { email, kind: null, sent: false }
  if (!send) {
    return { email, kind: decision.kind, title: decision.push.title, sent: false }
  }

  await sendPushToUser(email, decision.push)
  // Recorded after the send so a failed push is retried tomorrow rather than swallowed.
  await store.set(reminderStateKey(email), { ...state, ...decision.stateUpdate })

  return { email, kind: decision.kind, title: decision.push.title, sent: true }
}

/**
 * Only users with a stored push subscription can be reached, so that set — not the
 * profile list — is the roster. A subscription is deleted on a 410, which takes the
 * user out of the job automatically.
 */
async function runForEveryone(send: boolean): Promise<UserOutcome[]> {
  const keys = await store.keys(pushSubKey("*"))
  const emails = keys.map(emailFromPushSubKey).filter((e): e is string => e !== null)

  // This is a friends-sized app; if the roster ever outgrows one batch, chunk it here.
  const results = await Promise.allSettled(emails.map((e) => processUser(e, send)))
  return results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : []
  )
}

function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  // No secret configured means no way to tell cron from the open internet. Say no.
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

/**
 * Vercel cron calls this with the `CRON_SECRET` bearer token and it sends for real.
 * A signed-in user may instead call `?preview=1` to see what today would send them,
 * which is the only way to check the copy without waiting for 06:00 UTC. Preview never
 * sends and never writes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)

  if (isCron(request)) {
    const dryRun = url.searchParams.get("dryRun") === "1"
    try {
      const outcomes = await runForEveryone(!dryRun)
      return NextResponse.json({
        ok: true,
        dryRun,
        considered: outcomes.length,
        sent: outcomes.filter((o) => o.sent).length,
        outcomes: outcomes.filter((o) => o.kind !== null),
      })
    } catch {
      return NextResponse.json({ error: "reminder job failed" }, { status: 503 })
    }
  }

  if (url.searchParams.get("preview") === "1") {
    const session = await auth()
    const email = session?.user?.email
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    try {
      return NextResponse.json(await processUser(email, false))
    } catch {
      return NextResponse.json({ error: "preview failed" }, { status: 503 })
    }
  }

  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}
