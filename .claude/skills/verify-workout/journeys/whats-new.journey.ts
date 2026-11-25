import { test, expect } from "./harness"

test("what's new: unseen releases show once on Home and Got it records them as seen", { tag: "@whats-new" }, async ({ page, context, signIn, api, evidence, pageErrors }) => {
  await signIn()
  // signIn() marks every release seen on each page load; for the first load only, put
  // this device back at version 13 so releases 14 and 15 are unseen.
  await context.addInitScript(() => {
    if (sessionStorage.getItem("verify-whats-new-seeded")) return
    sessionStorage.setItem("verify-whats-new-seeded", "1")
    localStorage.setItem("lift-tracker-whats-new-seen", "13")
  })
  await page.goto("/")

  const modal = page.getByRole("dialog").filter({ hasText: "What's new" })
  await expect(modal).toBeVisible()
  // Every release newer than the device's marker, in one sheet.
  await expect(modal.getByText("Restart a cycle", { exact: true })).toBeVisible()
  await expect(modal.getByText("Heavy, light, medium", { exact: true })).toBeVisible()
  await evidence.shot(page, "action", "whats-new-modal")

  await modal.getByRole("button", { name: "Got it" }).click()
  await expect(modal).toBeHidden()
  const seen = await page.evaluate(() => localStorage.getItem("lift-tracker-whats-new-seen"))
  expect(Number(seen)).toBeGreaterThanOrEqual(15)
  // Nothing about it is synced: the marker is per device.
  expect(api.calls.filter((c) => c.method !== "GET" && c.path !== "/api/sessions" && c.path !== "/api/presence")).toEqual([])

  // Away and back in-app (no full reload): the sheet does not return.
  await page.getByRole("button", { name: "Open menu" }).click()
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "History", exact: true }).click()
  await expect(page).toHaveURL(/\/history$/)
  await page.getByRole("link", { name: "Back to home" }).click()
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  await expect(modal).toBeHidden()
  await evidence.shot(page, "result", "home-after-dismiss")

  expect(pageErrors).toEqual([])
})
