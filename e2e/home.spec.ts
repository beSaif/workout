import { test, expect } from "./fixtures"

test("signed in: the app loads to the home screen without page errors", async ({ page, signIn, api, pageErrors }) => {
  await signIn()
  await page.goto("/")

  // Home, not bounced to /welcome (cookie rejected) or /onboarding (no profile).
  await expect(page.getByRole("button", { name: "Open profile" })).toContainText("hello, E2E")
  await expect(page).toHaveURL(/\/$/)

  // The main lift's progress card and the up-next session with its two actions.
  await expect(page.getByRole("meter", { name: /e1RM against the 100kg goal/ })).toBeVisible()
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Skip Bench" })).toBeVisible()

  // The page loaded its data through the (fake) API, not only from the device.
  const gets = api.calls.filter((c) => c.method === "GET").map((c) => c.path)
  expect(gets).toEqual(expect.arrayContaining(["/api/profile", "/api/sessions"]))

  expect(pageErrors).toEqual([])
})
