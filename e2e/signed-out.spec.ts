import { test, expect } from "./fixtures"

test("signed out: / redirects to /welcome, which renders", async ({ page, pageErrors }) => {
  await page.goto("/")
  // proxy.ts sends signed-out visitors to the sign-in page, keeping where they were going.
  await expect(page).toHaveURL(/\/welcome(\?callbackUrl=.*)?$/)

  await expect(page.getByRole("heading", { level: 1, name: "best workout tracker." })).toBeVisible()
  await expect(page.getByRole("link", { name: "get started" })).toHaveAttribute("href", "/onboarding")
  await expect(page.getByRole("button", { name: "i've done this before" })).toBeVisible()
  expect(pageErrors).toEqual([])
})
