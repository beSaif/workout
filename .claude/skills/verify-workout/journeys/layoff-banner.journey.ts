import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

type Saved = { sessions: { id: number; confirmed: boolean; blockId?: number }[]; blocks: { status: string; anchorWeight: number; sessionIds: number[] }[] }

test("time off: the layoff banner warns, keep going dismisses it, restart eases the block", { tag: "@layoff-banner" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  const saved = () => api.lastPost("/api/sessions") as Saved | undefined

  // Log a session three weeks ago (the browser clock says so), then come back today.
  const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000)
  await page.clock.setFixedTime(threeWeeksAgo)
  await page.goto("/")
  await expect(page.getByText(/since your last session/)).toHaveCount(0)
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: before the layoff")
  await expect.poll(() => confirmedSessions(saved()).length).toBe(1)

  // Ten days later: the nudge (no restart offered), dismissed with its × button.
  await page.clock.setFixedTime(new Date(threeWeeksAgo.getTime() + 10 * 24 * 60 * 60 * 1000))
  await page.reload()
  await expect(page.getByText("10 days since your last session")).toBeVisible()
  await expect(page.getByRole("button", { name: "Restart Accumulation" })).toHaveCount(0)
  await evidence.shot(page, "action", "nudge-banner")
  await page.getByRole("main").getByRole("button", { name: "Dismiss" }).click()
  await expect(page.getByText("10 days since your last session")).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem("lift-tracker-layoff-dismissed"))).toMatch(/:nudge$/)

  // Today, three weeks on: a new tier, so the banner is back despite that dismissal.
  await page.clock.setFixedTime(new Date())
  await page.reload()

  // Banner: three weeks off, with Restart Accumulation and Keep going.
  await expect(page.getByText("3 weeks since your last session")).toBeVisible()
  const restartBtn = page.getByRole("button", { name: "Restart Accumulation" })
  const keepGoing = page.getByRole("button", { name: "Keep going" })
  await expect(restartBtn).toBeVisible()
  await evidence.shot(page, "action", "layoff-banner")

  // Keep going: the banner goes and stays gone (dismissal stored on the device).
  await keepGoing.click()
  await expect(page.getByText("3 weeks since your last session")).toBeHidden()
  const dismissed = await page.evaluate(() => localStorage.getItem("lift-tracker-layoff-dismissed"))
  expect(dismissed).toMatch(/:restart$/)
  await page.reload()
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  await expect(page.getByText("3 weeks since your last session")).toBeHidden()
  await evidence.shot(page, "result", "dismissed-after-reload")

  // Restart: bring the banner back (clear that device flag), choose Restart and confirm.
  await page.evaluate(() => localStorage.removeItem("lift-tracker-layoff-dismissed"))
  await page.reload()
  await restartBtn.click()
  const confirm = page.getByRole("alertdialog", { name: "Restart Accumulation from session 1?" })
  await expect(confirm).toBeVisible()
  const eased = Number((await confirm.innerText()).match(/eases 5% to ([\d.]+)kg/)![1])
  expect(eased).toBeLessThan(80)
  await evidence.shot(page, "action", "restart-confirm")
  await confirm.getByRole("button", { name: "Restart block" }).click()
  await expect(confirm).toBeHidden()

  // Result: the active block restarts at the eased peak with nothing in it; the old
  // session stays logged but unlinked; the banner is gone.
  await expect.poll(() => saved()!.blocks.find((b) => b.status === "active")?.anchorWeight).toBe(eased)
  expect(saved()!.blocks.find((b) => b.status === "active")!.sessionIds).toEqual([])
  const old = confirmedSessions(saved())[0] as unknown as { blockId?: number }
  expect(old.blockId).toBeUndefined()
  await expect(page.getByText("3 weeks since your last session")).toBeHidden()
  await expect(page.getByRole("button", { name: `This cycle peaks at ${eased}kg · Manage` })).toBeVisible()
  evidence.json("blocks-after-restart", saved()!.blocks)
  await evidence.shot(page, "result", "restarted-block")

  expect(pageErrors).toEqual([])
})
