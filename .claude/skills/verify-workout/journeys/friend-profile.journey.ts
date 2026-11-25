import { test, expect } from "./harness"
import { OMAR, OMAR_ROUTINE, answer, friendProfile, friendsList, presence, summary } from "./social"

test("open a gymbro's profile, hype a record, read their routine, train under them", { tag: "@friend-profile" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  api.seed("/api/friends", friendsList(OMAR))
  api.seed("/api/friends/profile", friendProfile(OMAR))
  api.seed("/api/presence", [presence(OMAR, true)])
  answer(api, "PUT", "/api/coach", { coach: summary(OMAR), config: OMAR_ROUTINE.muscleGroups, trainingDays: OMAR_ROUTINE.trainingDays })

  // Entry: the gymbros list links each friend to /friends/<email>.
  await page.goto("/gymbros")
  await page.getByRole("link", { name: /Omar Example/ }).click()
  await expect(page).toHaveURL(`/friends/${encodeURIComponent(OMAR.email)}`)
  await expect(page.getByRole("heading", { level: 1, name: OMAR.name })).toBeVisible()
  expect(api.calls.some((c) => c.method === "GET" && c.path === "/api/friends/profile")).toBe(true)

  // Their card: presence, counts, last session and records.
  await expect(page.getByLabel("In session")).toBeVisible()
  await expect(page.getByText("In session", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("12", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Session 12 · Chest")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Stats", selected: true })).toBeVisible()
  await expect(page.getByText("tap a record to hype it")).toBeVisible()
  await evidence.shot(page, "action", "friend-card")

  // Hype a record: it is sent as an ordinary gymbro message, once.
  const record = page.getByRole("button", { name: /^Bench Press 1 rep/ })
  await record.click()
  await expect(record).toBeDisabled()
  await expect.poll(() => api.lastPost("/api/messages/send")).toEqual({ toEmail: OMAR.email, text: "🔥 Bench Press 95kg × 1 — nasty" })
  await evidence.shot(page, "result", "record-hyped")

  // Routine tab: their public split.
  await page.getByRole("tab", { name: "Routine" }).click()
  await page.getByRole("button", { name: /^Push Day 1 exercise/ }).click()
  await expect(page.getByText("Incline Press")).toBeVisible()
  await evidence.shot(page, "result", "routine-tab")

  // Train under them: a warning sheet, then the switch.
  await page.getByRole("button", { name: "Train under Omar" }).click()
  const sheet = page.getByRole("dialog").filter({ hasText: "Your routine will be replaced" })
  await expect(sheet).toBeVisible()
  await evidence.shot(page, "action", "train-under-warning")
  await sheet.getByRole("button", { name: "Train under Omar" }).click()
  await expect(page.getByRole("button", { name: "Training under ✓" })).toBeVisible()
  const put = api.calls.find((c) => c.method === "PUT" && c.path === "/api/coach")
  expect(put?.body).toEqual({ email: OMAR.email })
  await expect(page.getByText("You train under Omar, so this is your routine too.", { exact: false })).toBeVisible()
  const days = await page.evaluate(() => JSON.parse(localStorage.getItem("lift-tracker-training-days") ?? "[]"))
  expect(days.map((d: { name: string }) => d.name)).toEqual(["Push Day"])
  await evidence.shot(page, "result", "training-under-omar")

  expect(pageErrors).toEqual([])
})
