import { test, expect } from "./harness"
import { confirmedSessions, expectedProgress, logUpNextSession } from "../../../../e2e/flows"

test("Home (Main Lift mode): progress card, program timeline, peak pill, up-next and logged cards, profile shortcut", { tag: "@home-dashboard" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")

  // Header greeting, empty progress card, phase timeline and the up-next card.
  await expect(page.getByRole("button", { name: "Open profile" })).toContainText("hello, E2E")
  const meter = page.getByRole("meter", { name: "e1RM against the 100kg goal" })
  await expect(meter).toHaveAttribute("aria-valuenow", "0")
  await expect(page.getByText("Log a session to see where you stand.")).toBeVisible()
  const volume = page.getByRole("button", { name: "Volume 0/9" })
  await expect(volume).toBeVisible()
  await expect(page.getByRole("button", { name: "Intensity 6 sessions" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Peak 3 sessions" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Deload 1 session" })).toBeVisible()
  await expect(page.getByRole("button", { name: "This cycle peaks at 80kg · Manage" })).toBeVisible()
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Session \d+ .*Jump$/ })).toHaveCount(8)
  await evidence.shot(page, "result", "home-fresh-block")

  // Tapping an upcoming phase previews its sessions; "Back to Volume" returns.
  await page.getByRole("button", { name: "Peak 3 sessions" }).click()
  const back = page.getByRole("button", { name: /Back to Volume/ })
  await expect(back).toBeVisible()
  await expect(page.getByRole("button", { name: /^Session \d+ .*Jump$/ })).toHaveCount(3)
  await expect(page.getByText("Peak single")).toBeVisible()
  await expect(page.getByText("Up next", { exact: true })).toHaveCount(0)
  await evidence.shot(page, "action", "preview-peak-phase")
  await back.click()
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  await expect(back).toBeHidden()

  // The peak pill opens the cycle's options (driven in full by manage-cycle).
  await page.getByRole("button", { name: "This cycle peaks at 80kg · Manage" }).click()
  const manage = page.getByRole("dialog").filter({ hasText: "This cycle" }).filter({ hasText: "Change peak" })
  await expect(manage).toBeVisible()
  await evidence.shot(page, "action", "peak-pill-manage-open")
  await page.keyboard.press("Escape")
  await expect(manage).toBeHidden()

  // Log the up-next session: the progress card and "Logged this block" fill in.
  await logUpNextSession(page, "verify-workout: home-dashboard")
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const expected = expectedProgress(confirmedSessions(api.lastPost("/api/sessions")))
  await expect(meter).toHaveAttribute("aria-valuenow", String(expected.e1rm))
  await expect(page.getByText(`${expected.bestLift.kg} × ${expected.bestLift.reps}`, { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Volume 1/9" })).toBeVisible()
  await expect(page.getByText("Logged this block")).toBeVisible()
  await expect(page.getByText(/^Session 2$/)).toBeVisible()
  evidence.json("expected-progress", expected)
  await evidence.shot(page, "result", "home-after-logging")

  // A short tap on the greeting opens the profile.
  await page.getByRole("button", { name: "Open profile" }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
  await evidence.shot(page, "result", "profile-from-greeting")

  expect(pageErrors).toEqual([])
})
