import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

test("open a logged session's detail page from its Home card", { tag: "@session-detail" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")

  // Precondition: one session logged through the real logger.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: session-detail")
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [saved] = confirmedSessions(api.lastPost("/api/sessions"))
  const working = saved.sets.filter((s) => !s.isWarmup)

  // Expand the logged card and choose Details.
  await page.getByRole("button", { name: /^Session 1 ·/ }).click()
  const details = page.getByRole("link", { name: "Details" })
  await expect(details).toHaveAttribute("href", `/session/${saved.id}`)
  await evidence.shot(page, "action", "card-expanded-details")
  await details.click()
  await expect(page).toHaveURL(new RegExp(`/session/${saved.id}$`))

  // The page shows what was saved: header, working weight and set count, the note.
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: /^Session 01 · / })).toBeVisible()
  await expect(main.getByText("Bench Press", { exact: true })).toBeVisible()
  await expect(main.getByText("e1RM", { exact: true }).first()).toBeVisible()
  await expect(main.getByText(`${working[0].kg}kg`, { exact: true }).first()).toBeVisible()
  await expect(main.getByText("verify-workout: session-detail")).toBeVisible()
  await evidence.shot(page, "result", "session-detail")

  // A second, server-side view: drop the device copy and reload; the page refills
  // from GET /api/sessions (the fake's stored POST), not from memory.
  await page.evaluate(() => {
    localStorage.removeItem("lift-tracker-sessions")
    localStorage.removeItem("lift-tracker-blocks")
  })
  const getsBefore = api.calls.filter((c) => c.method === "GET" && c.path === "/api/sessions").length
  await page.reload()
  await expect(main.getByRole("heading", { level: 1, name: /^Session 01 · / })).toBeVisible()
  await expect(main.getByText("verify-workout: session-detail")).toBeVisible()
  expect(api.calls.filter((c) => c.method === "GET" && c.path === "/api/sessions").length).toBeGreaterThan(getsBefore)
  await evidence.shot(page, "result", "session-detail-from-api")

  // Unknown id: the page says so instead of crashing.
  await page.goto("/session/999")
  await expect(page.getByText("Session not found.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/")

  expect(pageErrors).toEqual([])
})
