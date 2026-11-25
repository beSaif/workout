import { expect, type Page } from "@playwright/test"

/** Brzycki, as in src/lib/e1rm.ts: weight × 36 / (37 − reps), to 0.1 kg. */
export function brzycki(kg: number, reps: number): number {
  return Math.round(kg * (36 / (37 - reps)) * 10) / 10
}

/**
 * Log the up-next session from the home screen through the real logger: open it, mark
 * every prescribed set done (skipping the rest timer between sets), add a note and
 * confirm. Returns once the logger has closed.
 */
export async function logUpNextSession(page: Page, note: string): Promise<void> {
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  // The nav drawer is a dialog too (hidden off-screen), so pick the logger by its title.
  const logger = page.getByRole("dialog").filter({ hasText: /Log Session \d+/ })
  await expect(logger).toBeVisible()

  const confirm = logger.getByRole("button", { name: "Confirm Session" })
  const done = logger.getByRole("button", { name: "Done", exact: true })
  const skipRest = logger.getByRole("button", { name: "Skip rest" })

  // A session is a few dozen sets at most; the cap only stops a broken logger from
  // spinning until the test timeout.
  for (let i = 0; i < 100 && !(await confirm.isVisible()); i++) {
    if (await skipRest.isVisible()) await skipRest.click()
    if (await done.isVisible()) await done.click()
    // The Done that finishes an exercise pops for a beat before the next one shows.
    else await page.waitForTimeout(150)
  }

  await expect(logger.getByText("Session complete")).toBeVisible()
  await logger.getByPlaceholder("How did it feel?").fill(note)
  await confirm.click()
  await expect(logger).toBeHidden()
}

type SavedSet = { kg: number; reps: number; isWarmup?: boolean }
type SavedSession = { id: number; confirmed: boolean; coachNote?: string; sets: SavedSet[] }

/** The confirmed sessions in a { sessions, blocks } payload, as POSTed to /api/sessions. */
export function confirmedSessions(payload: unknown): SavedSession[] {
  const sessions = (payload as { sessions?: SavedSession[] } | undefined)?.sessions ?? []
  return sessions.filter((s) => s.confirmed)
}

/**
 * What the home progress card should show for these sessions, worked out independently
 * of the app: the best Brzycki e1RM over working (non-warm-up) sets, and the "best lift"
 * — the heaviest working weight, with the most reps done at it.
 */
export function expectedProgress(sessions: SavedSession[]): { e1rm: number; bestLift: { kg: number; reps: number } } {
  const working = sessions.flatMap((s) => s.sets.filter((x) => !x.isWarmup && x.kg > 0 && x.reps > 0))
  if (working.length === 0) throw new Error("no working sets were saved")
  const e1rm = Math.max(...working.map((x) => brzycki(x.kg, x.reps)))
  const topKg = Math.max(...working.map((x) => x.kg))
  const reps = Math.max(...working.filter((x) => x.kg === topKg).map((x) => x.reps))
  return { e1rm, bestLift: { kg: topKg, reps } }
}
