import { test, expect } from "./fixtures"
import { confirmedSessions, logUpNextSession } from "./flows"

test("logging the up-next session through the UI saves it", async ({ page, signIn, api, pageErrors }) => {
  await signIn()
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()

  const note = `e2e smoke ${test.info().project.name}`
  await logUpNextSession(page, note)

  // Saved: the sync POSTed a confirmed session with its sets and the note…
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [saved] = confirmedSessions(api.lastPost("/api/sessions"))
  expect(saved.coachNote).toBe(note)
  expect(saved.sets.filter((s) => !s.isWarmup).length).toBeGreaterThan(0)

  // …and Home lists it under this block, with the next session now up.
  await expect(page.getByText("Logged this block")).toBeVisible()
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  // The logged card is labelled "Session 1 · <date>"; the up-next card is Session 2 now.
  await expect(page.getByText(/^Session 1\b/)).toBeVisible()

  // The device copy matches, so it survives a reload offline too.
  const local = await page.evaluate(() => localStorage.getItem("lift-tracker-sessions"))
  expect(confirmedSessions({ sessions: JSON.parse(local ?? "[]") })).toHaveLength(1)

  expect(pageErrors).toEqual([])
})
