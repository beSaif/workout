import { test, expect } from "./fixtures"
import { confirmedSessions, expectedProgress, logUpNextSession } from "./flows"

test("history and progress show a session logged through the UI", async ({ page, signIn, api, pageErrors }) => {
  await signIn()
  await page.goto("/")
  await logUpNextSession(page, "e2e smoke: history")
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const expected = expectedProgress(confirmedSessions(api.lastPost("/api/sessions")))

  // Drop the device copy and reload: what shows now came back from the (fake) API,
  // i.e. it was really saved, not just held in memory.
  await page.evaluate(() => {
    localStorage.removeItem("lift-tracker-sessions")
    localStorage.removeItem("lift-tracker-blocks")
  })
  await page.reload()

  // Progress (the main-lift card on Home): e1RM by Brzycki, best lift, session count.
  const meter = page.getByRole("meter", { name: /e1RM against the 100kg goal/ })
  await expect(meter).toHaveAttribute("aria-valuenow", String(expected.e1rm))
  await expect(page.getByText(`${expected.bestLift.kg} × ${expected.bestLift.reps}`, { exact: true })).toBeVisible()
  await expect(page.getByText("best lift", { exact: true })).toBeVisible()
  await expect(page.getByText("Logged this block")).toBeVisible()

  // History: the session belongs to the cycle in progress, so History points to Home
  // for it rather than archiving it.
  await page.goto("/history")
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible()
  await expect(page.getByRole("link", { name: /1 session from your current cycle is on Home/ })).toBeVisible()
  await expect(page.getByText("0 archived sessions")).toBeVisible()

  expect(pageErrors).toEqual([])
})
