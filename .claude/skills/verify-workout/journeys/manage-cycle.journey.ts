import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

type Block = { id: number; phase: string; status: string; anchorWeight: number; sessionIds: number[]; sessionsPerWeek?: number; cycleLength?: string }
type Saved = { sessions: { id: number; confirmed: boolean; blockId?: number; sets: { kg: number; isWarmup: boolean }[] }[]; blocks: Block[] }

test("manage the cycle: change the peak, then restart the cycle", { tag: "@manage-cycle" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")
  const saved = () => api.lastPost("/api/sessions") as Saved | undefined
  const upNextTop = () => saved()?.sessions.find((s) => !s.confirmed)?.sets.find((x) => !x.isWarmup)?.kg

  // The onboarded profile peaks the first cycle at its 80kg 1RM; Session 1's single is 70kg.
  const pill = page.getByRole("button", { name: "This cycle peaks at 80kg · Manage" })
  await expect(pill).toBeVisible()
  await expect.poll(upNextTop).toBe(70)

  // Open Manage: nothing logged yet, so only Change peak is offered (no Restart).
  await pill.click()
  const manage = page.getByRole("dialog", { name: "This cycle" })
  await expect(manage).toBeVisible()
  await expect(manage.getByRole("button", { name: /Change peak Peaks at 80kg/ })).toBeVisible()
  await expect(manage.getByRole("button", { name: /Restart cycle/ })).toHaveCount(0)
  await evidence.shot(page, "action", "manage-sheet")

  // Change peak → 100kg.
  await manage.getByRole("button", { name: /Change peak/ }).click()
  const peakDialog = page.getByRole("dialog").filter({ hasText: "Set this cycle's peak" })
  await expect(peakDialog).toBeVisible()
  await peakDialog.getByRole("spinbutton").fill("100")
  await evidence.shot(page, "action", "set-peak-100")
  await peakDialog.getByRole("button", { name: "Update peak" }).click()
  await expect(peakDialog).toBeHidden()

  // Result: the pill and the prescribed loads follow the new peak (87.5% single), and the
  // saved active block carries it.
  await expect(page.getByRole("button", { name: "This cycle peaks at 100kg · Manage" })).toBeVisible()
  await expect.poll(upNextTop).toBe(87.5)
  await expect(page.getByText("87.5kg").first()).toBeVisible()
  expect(saved()!.blocks.find((b) => b.status === "active")!.anchorWeight).toBe(100)
  await evidence.shot(page, "result", "peak-100-loads")

  // Log Session 1, which makes the cycle restartable.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: manage-cycle")
  await expect.poll(() => confirmedSessions(saved()).length).toBe(1)
  const loggedId = confirmedSessions(saved())[0].id

  // Manage → Restart cycle: ease the peak 2.5kg, bench 4 days a week, Short cycle.
  await page.getByRole("button", { name: "This cycle peaks at 100kg · Manage" }).click()
  await page.getByRole("dialog", { name: "This cycle" }).getByRole("button", { name: /Restart cycle/ }).click()
  const restart = page.getByRole("dialog").filter({ hasText: "Back to Volume session 1" })
  await expect(restart).toBeVisible()
  await expect(restart.getByText("The session you logged this cycle stay in history, but stop moving the plan.")).toBeVisible()
  await restart.getByRole("button", { name: "2.5kg less" }).click()
  await restart.getByRole("button", { name: "4", exact: true }).click()
  await restart.getByRole("button", { name: /^Short/ }).click()
  await evidence.shot(page, "action", "restart-sheet")
  await restart.getByRole("button", { name: "Restart cycle · peak 97.5kg" }).click()
  await expect(restart).toBeHidden()

  // Result: one Volume block from session 1 at 97.5kg, 4 a week, short; the logged
  // session is still confirmed but no longer linked to the cycle.
  await expect(page.getByRole("button", { name: "This cycle peaks at 97.5kg · Manage" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Volume 0\// })).toBeVisible()
  await expect.poll(() => saved()!.blocks.find((b) => b.status === "active")?.anchorWeight).toBe(97.5)
  const active = saved()!.blocks.find((b) => b.status === "active")!
  expect(active).toMatchObject({ phase: "accumulation", sessionIds: [], sessionsPerWeek: 4, cycleLength: "short" })
  const logged = saved()!.sessions.find((s) => s.id === loggedId)!
  expect(logged.confirmed).toBe(true)
  expect(logged.blockId).toBeUndefined()
  evidence.json("blocks-after-restart", saved()!.blocks)
  await evidence.shot(page, "result", "restarted-cycle")

  expect(pageErrors).toEqual([])
})
