import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

type SavedExercise = { name?: string; exerciseName?: string; exerciseId?: string; muscleGroup?: string }

test("switch to Balanced, log a training-day session and see it on Home", { tag: "@balanced-mode" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/exercises")

  // Switch Training Focus: saves the profile straight away.
  const balanced = page.getByRole("button", { name: "Balanced", exact: true })
  await expect(page.getByRole("button", { name: "Lift-focused", exact: true })).toHaveAttribute("aria-pressed", "true")
  await balanced.click()
  await expect(balanced).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => (api.lastPost("/api/profile") as { trainingMode?: string } | undefined)?.trainingMode).toBe("balanced")
  await evidence.shot(page, "action", "training-focus-balanced")

  // Home is now the Balanced home: no main-lift card, an up-next training day, muscle balance.
  await page.getByRole("link", { name: "Back to home" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("meter", { name: /e1RM against/ })).toHaveCount(0)
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Day A" })).toBeVisible()
  await expect(page.getByText("Back + Triceps")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Muscle balance not tracked yet/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Skip Bench" })).toHaveCount(0)
  await evidence.shot(page, "result", "balanced-home-up-next-day-a")

  // Log the up-next day through the logger: it opens on the day's first exercise, no bench.
  await page.getByRole("button", { name: "Start session" }).click()
  const logger = loggerDialog(page)
  await expect(logger).toBeVisible()
  await expect(logger.getByRole("button", { name: "Lat Pulldown · set 1" })).toBeVisible()
  await expect(logger.getByText(/Bench/)).toHaveCount(0)
  await evidence.shot(page, "action", "logger-day-a")
  await completeOpenLogger(page, logger, "verify-workout: balanced-mode")

  // Side effect: one confirmed session of Day A's exercises reached the (fake) API.
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [saved] = confirmedSessions(api.lastPost("/api/sessions")) as unknown as (ReturnType<typeof confirmedSessions>[number] & {
    exercises?: SavedExercise[]
    trainingDayId?: string
  })[]
  expect(saved.coachNote).toBe("verify-workout: balanced-mode")
  expect(JSON.stringify(saved)).toContain("Lat Pulldown")
  expect(JSON.stringify(saved)).not.toMatch(/bench/i)
  evidence.json("saved-session", saved)

  // Resulting state: Day B is up next, the muscle balance is tracking, the session is listed.
  await expect(page.getByRole("heading", { level: 2, name: "Day B" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Muscle balance not tracked yet/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Show session actions" }).first()).toBeVisible()
  await evidence.shot(page, "result", "home-after-balanced-session")

  expect(pageErrors).toEqual([])
})
