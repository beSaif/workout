import { test, expect, E2E_USER } from "./harness"

test("edit profile settings, see them persist, then delete the account", { tag: "@profile-settings" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()

  // Entry: Home menu → Profile.
  await page.goto("/")
  await page.getByRole("button", { name: "Open menu" }).click()
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Profile" }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()

  // The inputs have no <label for>; their accessible names are their placeholders.
  const name = page.getByPlaceholder("Saif")
  const bw = page.getByPlaceholder("60")
  const target = page.getByPlaceholder("140")
  const checkIn = page.getByRole("switch", { name: "Weekly weight check-in" })
  await expect(name).toHaveValue(E2E_USER.name)
  await expect(bw).toHaveValue("80")
  await expect(target).toHaveValue("100")
  await expect(checkIn).toHaveAttribute("aria-checked", "false")
  await expect(page.getByText(E2E_USER.email)).toBeVisible()
  await expect(page.getByRole("link", { name: "Lift-focused · change" })).toHaveAttribute("href", "/exercises")

  // Edit: the Save bar appears only once something changed.
  const save = page.getByRole("button", { name: "Save changes" })
  await expect(save).toHaveCount(0)
  await name.fill("Verify Lifter")
  await bw.fill("82.5")
  await target.fill("110")
  await checkIn.click()
  await expect(checkIn).toHaveAttribute("aria-checked", "true")
  await evidence.shot(page, "action", "edited-form")
  await save.click()
  await expect(page.getByRole("button", { name: "Saved ✓" })).toBeVisible()
  expect(api.lastPost("/api/profile")).toMatchObject({
    name: "Verify Lifter",
    bw: 82.5,
    target: 110,
    weighInDaily: true,
    trainingMode: "lift-focused",
    mainLift: "bench",
  })

  // Persisted: drop the device copy and reload, the values come back from the (fake) API.
  await page.evaluate(() => localStorage.removeItem("lift-tracker-profile"))
  await page.reload()
  await expect(page.getByPlaceholder("Saif")).toHaveValue("Verify Lifter")
  await expect(page.getByPlaceholder("140")).toHaveValue("110")
  await expect(page.getByRole("switch", { name: "Weekly weight check-in" })).toHaveAttribute("aria-checked", "true")
  // Check-ins on: bodyweight now lives in the weight log, linked from here.
  await expect(page.getByRole("link", { name: "View weight trend →" })).toHaveAttribute("href", "/weight")
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("lift-tracker-profile") ?? "null"))
  expect(local).toMatchObject({ name: "Verify Lifter", target: 110, weighInDaily: true })
  await evidence.shot(page, "result", "persisted-after-reload")

  // Training focus link goes to the routine page, where the mode is changed.
  await page.getByRole("link", { name: "Lift-focused · change" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Routine" })).toBeVisible()
  await page.goto("/profile")

  // Delete account: confirm sheet, a DELETE answered by the fake, local data wiped, signed out.
  await page.getByRole("button", { name: "Delete account & data" }).click()
  const sheet = page.getByRole("dialog").filter({ hasText: "Delete everything?" })
  await expect(sheet).toBeVisible()
  await evidence.shot(page, "action", "delete-confirm")
  await sheet.getByRole("button", { name: "Yes, delete everything" }).click()
  await expect(page).toHaveURL(/\/welcome/)
  await expect(page.getByRole("heading", { level: 1, name: "best workout tracker." })).toBeVisible()
  expect(api.calls.filter((c) => c.method === "DELETE" && c.path === "/api/profile")).toHaveLength(1)
  const left = await page.evaluate(() => ({
    profile: localStorage.getItem("lift-tracker-profile"),
    sessions: localStorage.getItem("lift-tracker-sessions"),
  }))
  expect(left).toEqual({ profile: null, sessions: null })
  // Signed out for real: Home bounces back to /welcome.
  await page.goto("/")
  await expect(page).toHaveURL(/\/welcome/)
  await evidence.shot(page, "result", "signed-out-welcome")

  expect(pageErrors).toEqual([])
})
