import { test, expect, onboardedProfile } from "./harness"

type Weigh = { date: string; kg: number; loggedAt?: string }

/** The browser's local "YYYY-MM-DD" for `days` ago (the server and browser share a zone here). */
function dayKey(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

test("bodyweight: opt in, weigh in from Home, chart ranges, goal and delete on /weight", { tag: "@weight" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  // A profile that predates check-ins (weighInDaily never answered) and two old weigh-ins.
  const profile: Record<string, unknown> = { ...onboardedProfile() }
  delete profile.weighInDaily
  api.seed("/api/profile", profile)
  api.seed("/api/weights", [
    { date: dayKey(200), kg: 85, loggedAt: new Date(Date.now() - 200 * 864e5).toISOString() },
    { date: dayKey(60), kg: 83, loggedAt: new Date(Date.now() - 60 * 864e5).toISOString() },
  ])

  // Opt-in sheet on Home.
  await page.goto("/")
  const optIn = page.getByRole("dialog").filter({ hasText: "want to check in your weight weekly?" })
  await expect(optIn).toBeVisible()
  await evidence.shot(page, "action", "opt-in-sheet")
  await optIn.getByRole("button", { name: "yeah, ask me weekly" }).click()
  await expect.poll(() => (api.lastPost("/api/profile") as { weighInDaily?: boolean } | undefined)?.weighInDaily).toBe(true)

  // Saying yes leads straight into the first weigh-in, seeded from the last reading.
  const sheet = page.getByRole("dialog").filter({ hasText: "what did you weigh in at?" })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/last one: 83\.0kg/)).toBeVisible()
  await evidence.shot(page, "action", "check-in-sheet")
  await sheet.getByRole("button", { name: "log it" }).click()
  await expect(sheet).toBeHidden()
  await expect
    .poll(() => (api.lastPost("/api/weights") as Weigh[] | undefined)?.find((w) => w.date === dayKey(0))?.kg)
    .toBe(83)

  // The header chip now shows the reading and opens the log.
  const chip = page.getByRole("link", { name: "Bodyweight 83.0 kilograms, open weight log" })
  await expect(chip).toBeVisible()
  await evidence.shot(page, "result", "home-weight-chip")
  await chip.click()
  await expect(page).toHaveURL(/\/weight$/)
  await expect(page.getByRole("heading", { level: 1, name: "Weight" })).toBeVisible()

  // Ranges: 30d holds only today's reading; 90d and all draw a trend.
  await expect(page.getByText("one reading — log another to see a trend")).toBeVisible()
  await page.getByRole("button", { name: "90d" }).click()
  await expect(page.getByText("one reading — log another to see a trend")).toBeHidden()
  await page.getByRole("button", { name: "all" }).click()
  await expect(page.getByText("one reading — log another to see a trend")).toBeHidden()
  await evidence.shot(page, "result", "weight-all-range")
  await page.getByRole("button", { name: "30d" }).click()
  await expect(page.getByText("one reading — log another to see a trend")).toBeVisible()

  // Goal weight.
  const goal = page.getByRole("spinbutton")
  await goal.fill("78")
  await evidence.shot(page, "action", "set-goal")
  await page.getByRole("button", { name: "set goal" }).click()
  await expect.poll(() => (api.lastPost("/api/profile") as { goalBw?: number } | undefined)?.goalBw).toBe(78)
  await expect(page.getByRole("button", { name: "set goal" })).toBeDisabled()

  // Delete the oldest weigh-in (rows are newest first), confirming in the sheet.
  const deletes = page.getByRole("button", { name: /^Delete weigh-in from / })
  await expect(deletes).toHaveCount(3)
  await deletes.last().click()
  const confirm = page.getByRole("alertdialog").filter({ hasText: /Delete the weigh-in from/ })
  await expect(confirm).toBeVisible()
  await evidence.shot(page, "action", "confirm-delete")
  await confirm.getByRole("button", { name: "Delete" }).click()
  await expect(deletes).toHaveCount(2)
  await expect
    .poll(() => (api.lastPost("/api/weights") as Weigh[] | undefined)?.map((w) => w.date))
    .toEqual([dayKey(60), dayKey(0)])

  // Device copy matches.
  const local = await page.evaluate(() => localStorage.getItem("lift-tracker-weights"))
  expect((JSON.parse(local ?? "[]") as Weigh[]).map((w) => w.date)).toEqual([dayKey(60), dayKey(0)])
  await evidence.shot(page, "result", "weight-after-delete")

  expect(pageErrors).toEqual([])
})
