import { NextResponse } from "next/server"
import { store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { athletesKey, friendsKey } from "@/lib/userKeys"
import { loadPeople } from "@/lib/coach"

/**
 * GET /api/users/people?email=&kind=gymbros|athletes → the people behind a profile's
 * counts. Private: the counts show on anyone's profile, but only the owner can see
 * who is behind them.
 */
export const GET = withUser(async ({ email: myEmail, request }) => {
  const params = request.nextUrl.searchParams
  const email = (params.get("email") ?? myEmail).trim().toLowerCase()
  if (email !== myEmail.trim().toLowerCase()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const kind = params.get("kind")
  if (kind !== "gymbros" && kind !== "athletes") {
    return NextResponse.json({ error: "kind must be gymbros or athletes" }, { status: 400 })
  }

  try {
    const emails = await store.smembers(kind === "gymbros" ? friendsKey(email) : athletesKey(email))
    const people = await loadPeople(emails)
    people.sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json(people)
  } catch {
    return NextResponse.json([], { status: 503 })
  }
})
