import { test, expect } from "./harness"

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

function session(id: number, type: string, blockId: number, kg: number, reps: number, date: string, note: string) {
  const e1rm = Math.round(kg * (36 / (37 - reps)) * 10) / 10
  const sets = [1, 2, 3].map((n) => ({ id: `S${n}`, kg, reps, rpe: 7, e1rm, note: "", isWarmup: false }))
  return { id, date, type, bw: 80, sets, confirmed: true, coachNote: note, blockId, selectedTrainingDayId: "day-a" }
}

function block(id: number, phase: string, status: string, sessionIds: number[], start: string, end: string | null) {
  return { id, phase, status, sessionIds, anchorWeight: 80, length: phase === "deload" ? 1 : 3, startDate: start, endDate: end, schemeVersion: 3, cycleLength: "standard" }
}

test("history archives a finished cycle and points to Home for the current one", { tag: "@history" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  // A finished cycle (Volume → Deload, one session each) and one session into cycle 2.
  api.seed("/api/sessions", {
    sessions: [
      session(1, "Volume", 1, 60, 8, daysAgo(30), "cycle 1 volume"),
      session(2, "Intensity", 2, 67.5, 5, daysAgo(26), "cycle 1 intensity"),
      session(3, "Peak", 3, 75, 2, daysAgo(22), "cycle 1 peak"),
      session(4, "Deload", 4, 50, 5, daysAgo(18), "cycle 1 deload"),
      session(5, "Volume", 5, 60, 8, daysAgo(1), "cycle 2 volume"),
    ],
    blocks: [
      block(1, "accumulation", "completed", [1], daysAgo(30), daysAgo(27)),
      block(2, "transmutation", "completed", [2], daysAgo(26), daysAgo(23)),
      block(3, "realization", "completed", [3], daysAgo(22), daysAgo(19)),
      block(4, "deload", "completed", [4], daysAgo(18), daysAgo(18)),
      block(5, "accumulation", "active", [5], daysAgo(1), null),
    ],
  })

  // Reach History the way a user does: Home → menu → History.
  await page.goto("/")
  await page.getByRole("button", { name: "Open menu" }).click()
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "History" }).click()
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible()

  // The finished cycle's four sessions are archived, newest first; cycle 2's is on Home.
  await expect(page.getByText("4 archived sessions")).toBeVisible()
  const cards = page.getByRole("main").getByRole("button", { name: /^Session \d+ ·/ })
  await expect(cards).toHaveCount(4)
  await expect(cards.first()).toHaveAccessibleName(/^Session 0?4 ·/)
  await expect(cards.last()).toHaveAccessibleName(/^Session 0?1 ·/)
  await expect(page.getByRole("link", { name: /1 session from your current cycle is on Home/ })).toBeVisible()
  await evidence.shot(page, "result", "history-archive")

  // Open an archived session: expand its card and choose Details.
  await page.getByRole("button", { name: /^Session 0?3 ·/ }).click()
  await evidence.shot(page, "action", "archived-card-expanded")
  await page.getByRole("link", { name: "Details" }).click()
  await expect(page).toHaveURL(/\/session\/3$/)
  await expect(page.getByRole("heading", { level: 1, name: /^Session 03 · / })).toBeVisible()
  await expect(page.getByText("cycle 1 peak")).toBeVisible()
  await evidence.shot(page, "result", "archived-session-detail")

  // Back in History, the current-cycle link goes Home, where session 5 is logged this block
  // (Home numbers sessions within the block, so it shows as Session 1 there).
  await page.goto("/history")
  await page.getByRole("link", { name: /1 session from your current cycle is on Home/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("Logged this block")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Session 1 · .*60kg/ })).toBeVisible()
  await evidence.shot(page, "result", "home-current-cycle")

  // The archive came from the API (GET /api/sessions), and viewing it wrote nothing back
  // that drops the archived sessions.
  expect(api.calls.some((c) => c.method === "GET" && c.path === "/api/sessions")).toBe(true)
  const posted = api.lastPost("/api/sessions") as { sessions: { id: number; confirmed: boolean }[] } | undefined
  if (posted) expect(posted.sessions.filter((s) => s.confirmed).map((s) => s.id).sort()).toEqual([1, 2, 3, 4, 5])

  expect(pageErrors).toEqual([])
})
