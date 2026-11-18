import { NextResponse } from "next/server"
import { readProfile, store } from "@/lib/server/db"
import { withUser } from "@/lib/server/withUser"
import { MAIN_LIFT_LABEL } from "@/lib/types"
import { isLiftFocused } from "@/lib/trainingMode"
import { planUsesKey } from "@/lib/userKeys"
import { countAthletes, getCoach, loadRoutineOf } from "@/lib/coach"
import { completeJson, plannerConfigured } from "@/lib/planner"
import { PLAN_NOTE_MAX, PlanContext, buildDotMessages, buildRepairMessages, parsePlanAnswers } from "@/lib/planPrompt"
import { exportPlan, parsePlan, readPlanText } from "@/lib/routinePlan"

/** A reasoning model can take a while on a whole routine; the host call itself gives up at 40s. */
export const maxDuration = 60

/**
 * Plans per user per day, tweaks included. The free tier's token budget is shared by
 * every user of the app, so one person re-rolling all evening must not use it up.
 */
const DAILY_LIMIT = 5

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function usesToday(email: string): Promise<number> {
  return (await store.get<number>(planUsesKey(email, today()))) ?? 0
}

/**
 * GET /api/plan → what the plan page needs before it shows anything: whether Dot can
 * plan at all, how many plans are left today, and the two states that change what
 * applying a plan means (following a coach; being one).
 */
export const GET = withUser(async ({ email }) => {
  try {
    const [coach, athleteCount, used] = await Promise.all([getCoach(email), countAthletes(email), usesToday(email)])
    return NextResponse.json({
      available: plannerConfigured(),
      remaining: Math.max(0, DAILY_LIMIT - used),
      limit: DAILY_LIMIT,
      following: coach !== null,
      athleteCount,
    })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})

/**
 * POST /api/plan { answers, tweak?: { plan, request } } → { plan, warnings, remaining }
 *
 * Plans from the user's stored routine and their answers to Dot's questions; with a
 * tweak, revises the plan it proposed last time. Nothing is saved: the plan comes
 * back for the page to preview, and applying it goes through the ordinary saves.
 * A reply the app can't read gets one repair attempt, which is not counted.
 */
export const POST = withUser(async ({ email, request }) => {
  if (!plannerConfigured()) return NextResponse.json({ error: "unavailable" }, { status: 503 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const answers = parsePlanAnswers(body?.answers)
  if (!answers) return NextResponse.json({ error: "answer every question" }, { status: 400 })

  let tweak: { plan: ReturnType<typeof exportPlan>; request: string } | undefined
  if (body.tweak !== undefined) {
    const t = body.tweak as Record<string, unknown> | null
    const parsed = parsePlan(t?.plan)
    const ask = typeof t?.request === "string" ? t.request.trim() : ""
    if (!parsed.ok || !ask || ask.length > PLAN_NOTE_MAX) {
      return NextResponse.json({ error: "invalid tweak" }, { status: 400 })
    }
    tweak = { plan: parsed.plan, request: ask }
  }

  const usesKey = planUsesKey(email, today())
  try {
    if (await getCoach(email)) return NextResponse.json({ error: "following" }, { status: 409 })
    const used = await store.incr(usesKey)
    if (used === 1) await store.expire(usesKey, 60 * 60 * 48)
    if (used > DAILY_LIMIT) return NextResponse.json({ error: "limit", remaining: 0 }, { status: 429 })

    const [routine, profile] = await Promise.all([loadRoutineOf(email), readProfile(email)])
    const ctx: PlanContext = {}
    if (isLiftFocused(profile) && profile?.mainLift) ctx.mainLift = MAIN_LIFT_LABEL[profile.mainLift]

    const messages = buildDotMessages(answers, exportPlan(routine.muscleGroups, routine.trainingDays), ctx, tweak)
    let reply = await completeJson(messages)
    let result = reply.ok ? readPlanText(reply.text) : null
    if (reply.ok && result && !result.ok) {
      reply = await completeJson(buildRepairMessages(messages, reply.text, result.errors))
      result = reply.ok ? readPlanText(reply.text) : null
    }

    if (!result?.ok) {
      // Nothing usable came back, so it doesn't count against the user's day.
      await store.decr(usesKey)
      const busy = !reply.ok && reply.reason === "busy"
      return NextResponse.json({ error: busy ? "busy" : "bad-plan" }, { status: busy ? 503 : 502 })
    }
    return NextResponse.json({
      plan: result.plan,
      warnings: result.warnings,
      remaining: Math.max(0, DAILY_LIMIT - used),
    })
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 503 })
  }
})
