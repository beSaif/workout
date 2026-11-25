import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger } from "./flows"

test("log the up-next main-lift session through the logger", { tag: "@log-session" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()

  // Open the logger: the main lift (Bench) is the first exercise, non-negotiable.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  const logger = page.getByRole("dialog").filter({ hasText: /Log Session \d+/ })
  await expect(logger).toBeVisible()
  await expect(logger.getByText(/Bench/).first()).toBeVisible()
  await evidence.shot(page, "action", "logger-open-bench-first")
  // Opening the logger tells gymbros you're lifting.
  await expect.poll(() => api.calls.some((c) => c.method === "POST" && c.path === "/api/presence" && (c.body as { inSession?: boolean })?.inSession === true)).toBe(true)

  // Do the first set, then minimize: the mini player keeps the draft and brings it back.
  await logger.getByRole("button", { name: "Done", exact: true }).click()
  await logger.getByRole("button", { name: "Minimize" }).click()
  await expect(logger).toBeHidden()
  const miniPlayer = page.getByRole("button", { name: "Return to session" })
  await expect(miniPlayer).toBeVisible()
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("lift-tracker-draft") ?? "null"))
  expect(draft?.completedSets?.length).toBe(1)
  await evidence.shot(page, "result", "minimized-mini-player")
  await miniPlayer.click()
  await expect(logger).toBeVisible()

  // Mark every prescribed set done, skipping the rest timer, then add a note and confirm.
  const note = "verify-workout: log-session"
  await completeOpenLogger(page, logger, note)

  // Side effect: a confirmed session with working sets and the note reached the (fake) API.
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [saved] = confirmedSessions(api.lastPost("/api/sessions"))
  expect(saved.coachNote).toBe(note)
  expect(saved.sets.filter((s) => !s.isWarmup).length).toBeGreaterThan(0)
  evidence.json("saved-session", saved)

  // Resulting state: Home lists it under this block and Session 2 is up next.
  await expect(page.getByText("Logged this block")).toBeVisible()
  await expect(page.getByText(/^Session 1\b/)).toBeVisible()
  // Confirming ends the "lifting now" presence.
  await expect.poll(() => api.calls.some((c) => c.method === "POST" && c.path === "/api/presence" && (c.body as { inSession?: boolean })?.inSession === false)).toBe(true)
  const local = await page.evaluate(() => localStorage.getItem("lift-tracker-sessions"))
  expect(confirmedSessions({ sessions: JSON.parse(local ?? "[]") })).toHaveLength(1)
  await evidence.shot(page, "result", "home-logged-this-block")

  expect(pageErrors).toEqual([])
})
