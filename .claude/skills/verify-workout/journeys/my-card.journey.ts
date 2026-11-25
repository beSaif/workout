import path from "node:path"
import { test, expect, E2E_USER } from "./harness"
import { LEA, OMAR, myCardProfile, summary } from "./social"

test("see your own gymbro card, its people, routine and the shareable image", { tag: "@my-card" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  api.seed("/api/friends/profile", myCardProfile())
  api.seed("/api/users/people", [summary(LEA), summary(OMAR)])

  // Entry 1: Home's gymbros timeline starts with your own face.
  await page.goto("/")
  await page.getByRole("link", { name: /^Your card, / }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole("heading", { level: 1, name: E2E_USER.name })).toBeVisible()

  // Entry 2: Profile → My card.
  await page.goto("/profile")
  await page.getByRole("link", { name: /^My card/ }).click()
  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByRole("heading", { level: 1, name: E2E_USER.name })).toBeVisible()
  await expect(page.getByText("this is what your gymbros see")).toBeVisible()
  // No hype on your own records, no Message or Train under on your own card.
  await expect(page.getByRole("button", { name: /^Bench Press 3 reps/ })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Message" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Edit routine" })).toHaveAttribute("href", "/exercises")
  // The card was read from the viewer's own profile endpoint (no ?email=).
  await evidence.shot(page, "action", "my-card")

  // Counts are private to the owner: tapping gymbros lists who they are.
  const people = page.waitForRequest((r) => r.url().includes("/api/users/people?") && r.url().includes("kind=gymbros"))
  await page.getByRole("button", { name: /2\s*gymbros/ }).click()
  await people
  await expect(page.getByRole("link", { name: /Lea Placeholder/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Omar Example/ })).toBeVisible()
  await evidence.shot(page, "result", "gymbros-sheet")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("link", { name: /Lea Placeholder/ })).toHaveCount(0)

  // Routine tab.
  await page.getByRole("tab", { name: "Routine" }).click()
  await expect(page.getByText("Anyone can see your routine and train under you.")).toBeVisible()

  // Share card: the image is built in the browser and saved as a PNG download.
  await page.getByRole("button", { name: "Share card" }).click()
  await expect(page.getByRole("img", { name: "Your gymbro card" })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(600) // the preview fades up
  await evidence.shot(page, "action", "share-card-preview")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "save", exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("gymbro-card-e2e-smoke.png")
  await file.saveAs(path.join(evidence.dir, "gymbro-card-download.png"))
  await expect(page.getByText("saved", { exact: true })).toBeVisible()
  await evidence.shot(page, "result", "share-card-saved")

  const gets = api.calls.filter((c) => c.method === "GET").map((c) => c.path)
  expect(gets).toEqual(expect.arrayContaining(["/api/friends/profile", "/api/users/people"]))
  expect(pageErrors).toEqual([])
})
