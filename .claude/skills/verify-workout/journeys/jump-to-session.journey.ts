import { test, expect } from "./harness"

type SavedPayload = {
  sessions?: { id: number; confirmed: boolean; sets: { kg: number; reps: number; isWarmup?: boolean }[] }[]
  blocks?: { id: number; phase: string; status: string; skippedSlots?: unknown[] }[]
}

const skippedSlots = (p: unknown) =>
  ((p as SavedPayload | undefined)?.blocks ?? []).reduce((n, b) => n + (b.skippedSlots?.length ?? 0), 0)

test("Jump moves the up-next card to a later session in the block, and Undo puts it back", { tag: "@jump-to-session" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  await expect(page.getByText(/^Session 1$/)).toBeVisible()
  await expect(page.getByText("70kg", { exact: true })).toBeVisible()

  // The block view previews later sessions; Session 4 is the next heavy day.
  const target = page.getByRole("button", { name: /^Session 4 Heavy Single .*Jump$/ })
  await expect(target).toContainText("72.5kg")
  await target.click()
  const sheet = page.getByRole("alertdialog", { name: /^Jump to / })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText("3 sessions in between are skipped and won't count as trained.")
  await expect(sheet).toContainText("That's +2.5kg on today's 70kg.")
  const label = ((await sheet.getByRole("heading").first().textContent()) ?? "").replace(/^Jump to |\?$/g, "")
  await evidence.shot(page, "action", "confirm-jump-to-session-4")
  await sheet.getByRole("button", { name: "Jump", exact: true }).click()
  await expect(sheet).toBeHidden()

  // Up next is now Session 4 at 72.5kg, with an undo banner; nothing was logged.
  await expect(page.getByText(/^Session 4$/)).toBeVisible()
  await expect(page.getByText("72.5kg", { exact: true })).toBeVisible()
  await expect(page.getByText(`Jumped to ${label}`)).toBeVisible()
  await expect(page.getByRole("button", { name: /^Session 4 .*Jump$/ })).toHaveCount(0)
  await expect.poll(() => skippedSlots(api.lastPost("/api/sessions"))).toBe(3)
  const saved = api.lastPost("/api/sessions") as SavedPayload
  expect((saved.sessions ?? []).filter((s) => s.confirmed)).toHaveLength(0)
  const upcoming = (saved.sessions ?? []).find((s) => !s.confirmed)
  expect(upcoming?.sets.find((s) => !s.isWarmup)?.kg).toBe(72.5)
  evidence.json("saved-after-jump", saved)
  const localBlocks = await page.evaluate(() => JSON.parse(localStorage.getItem("lift-tracker-blocks") ?? "[]"))
  expect(skippedSlots({ blocks: localBlocks })).toBe(3)
  await evidence.shot(page, "result", "up-next-session-4")

  // Undo returns the program to Session 1.
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByText(/^Session 1$/)).toBeVisible()
  await expect(page.getByText("70kg", { exact: true })).toBeVisible()
  await expect.poll(() => skippedSlots(api.lastPost("/api/sessions"))).toBe(0)
  await evidence.shot(page, "result", "after-undo-session-1")

  expect(pageErrors).toEqual([])
})
