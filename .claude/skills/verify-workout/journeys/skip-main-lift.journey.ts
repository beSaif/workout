import { test, expect } from "./harness"
import { completeOpenLogger, loggerDialog } from "./flows"

type SavedSession = {
  id: number
  confirmed: boolean
  type: string
  skippedMainLift?: boolean
  blockId?: number
  sets: { kg: number; reps: number; isWarmup?: boolean }[]
}

function sessionsIn(payload: unknown): SavedSession[] {
  return (payload as { sessions?: SavedSession[] } | undefined)?.sessions ?? []
}

test("Skip Bench logs accessories only and carries the prescribed load to the next session", { tag: "@skip-main-lift" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")

  // The up-next card opens with Bench: Session 1, 70kg single then back-offs.
  const upNext = page.getByText("Up next", { exact: true })
  await expect(upNext).toBeVisible()
  await expect(page.getByText(/^Session 1$/)).toBeVisible()
  await expect(page.getByText("70kg", { exact: true })).toBeVisible()
  await expect(page.getByText("then 57.5kg × 6 × 4")).toBeVisible()

  // Skip Bench → a confirm sheet names what stays on deck.
  await page.getByRole("button", { name: "Skip Bench" }).click()
  const sheet = page.getByRole("alertdialog", { name: "Skip Bench today?" })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText("stays on deck and opens your next session")
  await evidence.shot(page, "action", "confirm-skip-bench")
  await sheet.getByRole("button", { name: "Skip Bench" }).click()
  await expect(sheet).toBeHidden()

  // The card is now accessories only, with an undo.
  await expect(page.getByText("Bench skipped today")).toBeVisible()
  await expect(page.getByText("Accessories", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Undo skip" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Skip Bench" })).toHaveCount(0)
  await expect
    .poll(() => sessionsIn(api.lastPost("/api/sessions")).find((s) => !s.confirmed)?.skippedMainLift)
    .toBe(true)
  await evidence.shot(page, "result", "card-bench-skipped")

  // Log the accessories-only session through the logger: no Bench in it.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  const logger = loggerDialog(page)
  await expect(logger).toBeVisible()
  await expect(logger.getByText(/Bench Press/)).toHaveCount(0)
  await evidence.shot(page, "action", "logger-accessories-only")
  await completeOpenLogger(page, logger, "verify-workout: skip-main-lift")

  // Saved: one confirmed session marked skipped, outside the block, with no main-lift sets.
  await expect.poll(() => sessionsIn(api.lastPost("/api/sessions")).filter((s) => s.confirmed).length).toBe(1)
  const [saved] = sessionsIn(api.lastPost("/api/sessions")).filter((s) => s.confirmed)
  expect(saved.skippedMainLift).toBe(true)
  expect(saved.type).toBe("Free")
  expect(saved.blockId).toBeUndefined()
  expect(saved.sets).toEqual([])
  evidence.json("saved-session", saved)

  // The load carried over: the new up-next is still Volume Session 1 at the same 70kg.
  await expect(upNext).toBeVisible()
  await expect(page.getByText(/^Session 1$/)).toBeVisible()
  await expect(page.getByText("70kg", { exact: true })).toBeVisible()
  await expect(page.getByText("then 57.5kg × 6 × 4")).toBeVisible()
  await expect(page.getByRole("button", { name: "Skip Bench" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Volume 0\// })).toBeVisible()
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("lift-tracker-sessions") ?? "[]") as SavedSession[])
  expect(local.filter((s) => s.confirmed && s.skippedMainLift)).toHaveLength(1)
  await evidence.shot(page, "result", "load-carried-to-next-session")

  expect(pageErrors).toEqual([])
})
