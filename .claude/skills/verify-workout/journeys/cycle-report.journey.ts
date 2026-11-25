import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

type Block = { id: number; phase: string; status: string; anchorWeight: number; sessionIds: number[]; sessionsPerWeek?: number; cycleLength?: string; setUp?: boolean }
type Saved = { sessions: { id: number; confirmed: boolean }[]; blocks: Block[] }

test("finish a cycle, read its report and start the next cycle from it", { tag: "@cycle-report" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")
  const saved = () => api.lastPost("/api/sessions") as Saved | undefined

  // Jump straight to the cycle's deload from the program timeline (a user who wants the
  // cycle over), confirming the jump.
  await page.getByRole("button", { name: "Deload 1 session" }).click()
  await page.getByRole("button", { name: /^Session 1 .*Jump$/ }).click()
  const jump = page.getByRole("alertdialog", { name: /^Jump to Deload/ })
  await expect(jump).toBeVisible()
  await jump.getByRole("button", { name: "Jump" }).click()
  await expect(jump).toBeHidden()
  await expect(page.getByText(/^Jumped to Deload/)).toBeVisible()

  // Log the deload session: the last session of the cycle.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await evidence.shot(page, "action", "log-deload-session")
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: deload")
  await expect.poll(() => confirmedSessions(saved()).length).toBe(1)

  // The cycle report opens by itself.
  const report = page.getByRole("dialog").filter({ hasText: "Cycle 1 complete" })
  await expect(report).toBeVisible()
  await expect(report.getByText("By phase")).toBeVisible()
  await expect(report.getByText("Set up cycle 2")).toBeVisible()
  await evidence.shot(page, "result", "cycle-report")

  // Set up cycle 2: peak one step over the suggestion ("Push"), 4 days a week, Long.
  await report.getByRole("button", { name: /Push$/ }).click()
  const pushKg = Number((await report.getByRole("button", { name: /Push$/ }).innerText()).match(/([\d.]+)kg/)![1])
  await report.getByRole("button", { name: "4", exact: true }).click()
  await report.getByRole("button", { name: /^Long/ }).click()
  await evidence.shot(page, "action", "setup-cycle-2")
  await report.getByRole("button", { name: `Start cycle 2 · peak ${pushKg}kg` }).click()
  await expect(report).toBeHidden()

  // Result: the new Volume block is set up with those answers, and Home shows its peak.
  await expect.poll(() => saved()?.blocks.find((b) => b.status === "active")?.setUp).toBe(true)
  const active = saved()!.blocks.find((b) => b.status === "active")!
  expect(active).toMatchObject({ phase: "accumulation", anchorWeight: pushKg, sessionsPerWeek: 4, cycleLength: "long", sessionIds: [] })
  expect(saved()!.blocks.some((b) => b.phase === "deload" && b.status === "completed")).toBe(true)
  await expect(page.getByRole("button", { name: `This cycle peaks at ${pushKg}kg · Manage` })).toBeVisible()
  evidence.json("blocks-after-start", saved()!.blocks)
  await evidence.shot(page, "result", "cycle-2-home")

  // Until cycle 2's first session is logged, the peak pill reopens this setup report.
  await page.getByRole("button", { name: `This cycle peaks at ${pushKg}kg · Manage` }).click()
  const reopened = page.getByRole("dialog").filter({ hasText: "Set up cycle 2" })
  await expect(reopened).toBeVisible()
  await reopened.getByRole("button", { name: "Later" }).click()
  await expect(reopened).toBeHidden()

  // Once cycle 2 has a session, Manage offers the finished cycle's report, read-only.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: cycle 2 session 1")
  await expect.poll(() => confirmedSessions(saved()).length).toBe(2)
  await page.getByRole("button", { name: `This cycle peaks at ${pushKg}kg · Manage` }).click()
  await page.getByRole("dialog", { name: "This cycle" }).getByRole("button", { name: /Cycle 1 report/ }).click()
  const past = page.getByRole("dialog").filter({ hasText: "Cycle 1 complete" })
  await expect(past).toBeVisible()
  await expect(past.getByText("Set up cycle 2")).toHaveCount(0)
  await evidence.shot(page, "result", "past-report-read-only")

  expect(pageErrors).toEqual([])
})
