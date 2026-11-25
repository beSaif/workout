import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

type DaySession = {
  sets: { isWarmup?: boolean }[]
  selectedTrainingDayId?: string
  selectedMuscleGroups?: string[]
  extraWorkouts?: { muscle: string; exercises: { name: string; sets: unknown[] }[] }[]
}

test("switch the up-next training day, add an extra muscle, log it", { tag: "@training-day-extras" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()

  // The up-next card opens on the coach's pick: Day A.
  await expect(page.getByText("Training Day", { exact: true })).toBeVisible()
  await expect(page.getByText("Back + Triceps", { exact: true })).toBeVisible()
  await expect(page.getByText("Coach pick", { exact: true })).toBeVisible()

  // Switch day → Day B.
  await page.getByRole("button", { name: "Switch day" }).click()
  const dayB = page.getByRole("button", { name: /^Day B Chest \+ Biceps/ })
  await expect(dayB).toBeVisible()
  await evidence.shot(page, "action", "switch-day-picker")
  await dayB.click()
  await expect(page.getByText("Chest + Biceps", { exact: true })).toBeVisible()
  // Day B is not the coach's pick, so the badge goes.
  await expect(page.getByText("Coach pick", { exact: true })).toHaveCount(0)

  // + Extras → Shoulders for this session only.
  await page.getByRole("button", { name: "+ Extras" }).click()
  await expect(page.getByText("Add for this session only")).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Chest" })).toHaveCount(0)
  await page.getByRole("checkbox", { name: "Shoulders" }).check()
  await evidence.shot(page, "action", "extras-shoulders")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByRole("button", { name: "1 extra" })).toBeVisible()
  await expect(page.getByText("Chest + Biceps + Shoulders")).toBeVisible()
  await evidence.shot(page, "result", "up-next-day-b-plus-shoulders")

  // Log it: bench still opens the session, then the day's and the extra muscle's work.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  const logger = loggerDialog(page)
  await expect(logger).toBeVisible()
  await expect(logger.getByText(/Bench Press/).first()).toBeVisible()
  await completeOpenLogger(page, logger, "verify-workout: training-day-extras")

  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [first] = confirmedSessions(api.lastPost("/api/sessions"))
  const saved = first as typeof first & DaySession
  expect(saved.sets.filter((s) => !s.isWarmup).length).toBeGreaterThan(0)
  expect(saved.selectedTrainingDayId).toBe("day-b")
  expect(saved.selectedMuscleGroups).toEqual(["chest", "biceps", "shoulders"])
  expect(saved.extraWorkouts?.map((w) => w.muscle)).toEqual(["chest", "biceps", "shoulders"])
  evidence.json("saved-session", saved)

  // Home: the logged session names Day B; the next up-next is back on the rotation.
  await expect(page.getByText("Logged this block")).toBeVisible()
  await expect(page.getByText(/^Session 1\b/)).toBeVisible()
  await evidence.shot(page, "result", "home-after-logging-day-b")

  expect(pageErrors).toEqual([])
})
