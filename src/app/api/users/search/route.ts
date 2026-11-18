import { NextResponse } from "next/server"
import { UserProfile } from "@/lib/types"
import { store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { toPersonSummary } from "@/lib/coach"
import { PersonSummary } from "@/lib/routines"

const MAX_RESULTS = 20

/**
 * GET /api/users/search?q= → people whose name matches every word of the query, or
 * whose email is exactly the query. Answers with summaries, never full profiles.
 */
export const GET = withUser(async ({ email: myEmail, request }) => {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase()
  if (q.length < 2) return NextResponse.json([])
  const terms = q.split(/\s+/)
  const me = myEmail.trim().toLowerCase()

  try {
    const keys = await store.keys("user:*:profile")
    if (keys.length === 0) return NextResponse.json([])
    const profiles = await store.mget<(UserProfile | null)[]>(...keys)

    const results: PersonSummary[] = []
    for (const p of profiles) {
      if (!p || typeof p !== "object" || !p.email || !p.name) continue
      const email = p.email.trim().toLowerCase()
      if (email === me) continue
      const name = p.name.toLowerCase()
      if (email === q || terms.every((t) => name.includes(t))) results.push(toPersonSummary(p))
    }
    results.sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json(results.slice(0, MAX_RESULTS))
  } catch {
    return NextResponse.json([], { status: 503 })
  }
})
