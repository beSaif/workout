import type { Page } from "@playwright/test"
import { test, expect, onboardedProfile } from "./harness"

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Open the drawer from Home and wait for it to slide fully in. */
async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click()
  const menu = page.getByRole("dialog", { name: "Menu" })
  await expect(menu).toBeInViewport({ ratio: 1 })
  return menu
}

test("menu: every link navigates, Dot and Haptics switches persist, sign out ends the session", { tag: "@nav-drawer" }, async ({ page, context, signIn, api, evidence, pageErrors }) => {
  await signIn()
  // Daily check-ins on (so the Weight entry is offered), already weighed in today (no sheet).
  api.seed("/api/profile", { ...onboardedProfile(), weighInDaily: true })
  api.seed("/api/weights", [{ date: today(), kg: 80, loggedAt: new Date().toISOString() }])
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Open profile" })).toContainText("hello, E2E")

  // Dot, the mascot, is on Home by default (a decorative, aria-hidden layer).
  const dot = page.locator("[data-dot]")
  await expect(dot).toHaveCount(1)

  const menu = await openMenu(page)
  for (const name of ["Home", "Exercise Selection", "History", "Weight", "Gymbros", "Profile"]) {
    await expect(menu.getByRole("link", { name, exact: true })).toBeVisible()
  }
  await expect(menu.getByRole("switch", { name: "Show Dot" })).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("switch", { name: "Haptics" })).toHaveAttribute("aria-checked", "true")
  await evidence.shot(page, "action", "menu-open")
  // Escape closes it again.
  await page.keyboard.press("Escape")
  await expect(menu).not.toBeInViewport()

  // Each link lands on its page; every page leads back to Home.
  const routes: [string, RegExp, string][] = [
    ["Exercise Selection", /\/exercises$/, "Routine"],
    ["History", /\/history$/, "History"],
    ["Weight", /\/weight$/, "Weight"],
    ["Gymbros", /\/gymbros$/, "Gymbros"],
    ["Profile", /\/profile$/, "Profile"],
  ]
  for (const [link, url, heading] of routes) {
    const m = await openMenu(page)
    await m.getByRole("link", { name: link, exact: true }).click()
    await expect(page).toHaveURL(url)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
    await page.getByRole("link", { name: "Back to home" }).click()
    await expect(page).toHaveURL(/\/$/)
  }
  const m = await openMenu(page)
  await m.getByRole("link", { name: "Home", exact: true }).click()
  await expect(m).not.toBeInViewport()
  await expect(page).toHaveURL(/\/$/)

  // Switch Dot and Haptics off: Dot leaves at once and both choices survive a reload.
  const menu2 = await openMenu(page)
  await menu2.getByRole("switch", { name: "Show Dot" }).click()
  await menu2.getByRole("switch", { name: "Haptics" }).click()
  await expect(menu2.getByRole("switch", { name: "Show Dot" })).toHaveAttribute("aria-checked", "false")
  await expect(menu2.getByRole("switch", { name: "Haptics" })).toHaveAttribute("aria-checked", "false")
  await expect(dot).toHaveCount(0)
  await evidence.shot(page, "result", "switches-off")
  expect(await page.evaluate(() => [localStorage.getItem("lift-tracker-dot"), localStorage.getItem("lift-tracker-haptics")])).toEqual(["off", "off"])

  await page.reload()
  await expect(page.getByRole("button", { name: "Open profile" })).toBeVisible()
  await expect(dot).toHaveCount(0)
  const menu3 = await openMenu(page)
  await expect(menu3.getByRole("switch", { name: "Show Dot" })).toHaveAttribute("aria-checked", "false")
  await expect(menu3.getByRole("switch", { name: "Haptics" })).toHaveAttribute("aria-checked", "false")

  // Dot back on.
  await menu3.getByRole("switch", { name: "Show Dot" }).click()
  await expect(menu3.getByRole("switch", { name: "Show Dot" })).toHaveAttribute("aria-checked", "true")
  await expect(dot).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem("lift-tracker-dot"))).toBeNull()

  // Sign out: local data wiped, cookie gone, back on /welcome, and Home is closed again.
  await evidence.shot(page, "action", "sign-out")
  await menu3.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/welcome/)
  await expect(page.getByRole("heading", { level: 1, name: "best workout tracker." })).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies.filter((c) => c.name.endsWith("authjs.session-token"))).toEqual([])
  expect(await page.evaluate(() => localStorage.getItem("lift-tracker-weights"))).toBeNull()
  await page.goto("/")
  await expect(page).toHaveURL(/\/welcome/)
  await evidence.shot(page, "result", "signed-out-welcome")

  expect(pageErrors).toEqual([])
})
