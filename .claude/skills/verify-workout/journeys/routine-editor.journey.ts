import { test, expect } from "./harness"

type Day = { id: string; name: string; order: number; muscleGroupIds: string[] }
type Exercise = { id: string; name: string; order: number; defaultSets?: number }
type Group = { id: string; name: string; exercises: Exercise[]; retired?: boolean }

test("edit the routine: training days, muscle groups and exercises", { tag: "@routine-editor" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/exercises")
  await expect(page.getByRole("heading", { level: 1, name: "Routine" })).toBeVisible()

  // Add a training day.
  await page.getByRole("button", { name: "+ Add training day" }).click()
  await page.getByRole("textbox", { name: "New training day name" }).fill("Push Day")
  await evidence.shot(page, "action", "add-training-day")
  await page.getByRole("button", { name: "Add day", exact: true }).click()
  // The new day opens expanded: pick its muscles.
  await page.getByRole("button", { name: "Chest", exact: true }).click()
  await expect(page.getByRole("button", { name: "Chest", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => (api.lastPost("/api/training-days") as Day[] | undefined)?.find((d) => d.name === "Push Day")?.muscleGroupIds).toEqual(["chest"])

  // Rename it.
  await page.getByRole("button", { name: "Rename", exact: true }).click()
  await page.getByRole("textbox", { name: "Day name" }).fill("Push")
  await page.getByRole("textbox", { name: "Day name" }).press("Enter")
  await expect(page.getByRole("button", { name: /^Push Chest/ })).toBeVisible()
  await expect.poll(() => (api.lastPost("/api/training-days") as Day[] | undefined)?.map((d) => d.name)).toEqual(["Day A", "Day B", "Day C", "Push"])

  // Add a muscle group trained on Day A.
  await page.getByRole("button", { name: "+ Add muscle group" }).click()
  await page.getByRole("textbox", { name: "New muscle group name" }).fill("Abs")
  await page.getByRole("button", { name: "Day A", exact: true }).click()
  await evidence.shot(page, "action", "add-muscle-group")
  await page.getByRole("button", { name: "Add group", exact: true }).click()
  await expect(page.getByRole("link", { name: /^Abs No exercises · Day A/ })).toBeVisible()
  await expect.poll(() => (api.lastPost("/api/exercises") as Group[] | undefined)?.some((g) => g.name === "Abs")).toBe(true)
  const absId = (api.lastPost("/api/exercises") as Group[]).find((g) => g.name === "Abs")!.id
  expect((api.lastPost("/api/training-days") as Day[]).find((d) => d.id === "day-a")!.muscleGroupIds).toContain(absId)
  await evidence.shot(page, "result", "routine-with-push-and-abs")

  // Exercises inside a group: Back.
  await page.getByRole("link", { name: /^Back 3 exercises/ }).click()
  await expect(page).toHaveURL(/\/exercises\/back$/)
  await expect(page.getByRole("heading", { level: 1, name: "Back" })).toBeVisible()

  await page.getByRole("button", { name: "+ Add exercise" }).click()
  await page.getByRole("textbox", { name: "New exercise name" }).fill("Seal Row")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText("4 exercises")).toBeVisible()

  // Set counts: one more set for Seal Row (a new, non-first exercise starts at 2 → 3).
  await page.getByRole("button", { name: "More sets for Seal Row" }).click()
  const back = () => (api.lastPost("/api/exercises") as Group[] | undefined)?.find((g) => g.id === "back")
  await expect.poll(() => back()?.exercises.find((e) => e.name === "Seal Row")?.defaultSets).toBe(3)

  // Edit mode: rename, reorder, delete.
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  const names = page.getByRole("textbox", { name: "Exercise name" })
  await names.nth(3).fill("Chest-Supported Row")
  await names.nth(3).press("Enter")
  await page.getByRole("button", { name: "Move Chest-Supported Row up" }).click()
  await page.getByRole("button", { name: "Delete Cross Rear Delt Fly" }).click()
  await evidence.shot(page, "action", "remove-exercise-confirm")
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click()
  await page.getByRole("button", { name: "Done", exact: true }).click()

  const sorted = () => [...(back()?.exercises ?? [])].sort((a, b) => a.order - b.order).map((e) => e.name)
  await expect.poll(sorted).toEqual(["Lat Pulldown", "Single Cable Seated Pulldown", "Chest-Supported Row"])

  // Reload: the routine comes back from the (fake) API, not just from memory.
  await page.evaluate(() => {
    localStorage.removeItem("lift-tracker-exercises")
    localStorage.removeItem("lift-tracker-training-days")
  })
  await page.reload()
  await expect(page.getByText("3 exercises")).toBeVisible()
  await expect(page.getByText("Chest-Supported Row")).toBeVisible()
  await expect(page.getByText("Cross Rear Delt Fly")).toHaveCount(0)
  await evidence.shot(page, "result", "back-group-after-reload")

  await page.goto("/exercises")
  await expect(page.getByRole("button", { name: /^Push Chest/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /^Abs No exercises · Day A/ })).toBeVisible()
  await evidence.shot(page, "result", "routine-after-reload")
  evidence.json("saved-routine", { exercises: api.lastPost("/api/exercises"), trainingDays: api.lastPost("/api/training-days") })

  expect(pageErrors).toEqual([])
})
