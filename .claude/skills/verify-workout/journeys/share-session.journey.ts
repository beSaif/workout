import path from "node:path"
import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

test("share a logged session as an image card", { tag: "@share-session" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  // Stand-in for the OS share sheet: record what the app hands it, share nothing.
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: { name: string; type: string; size: number; title?: string }[] }
    w.__shared = []
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true })
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[]; title?: string }) => {
        for (const f of data.files ?? []) w.__shared.push({ name: f.name, type: f.type, size: f.size, title: data.title })
      },
    })
  })
  await page.goto("/")

  // Precondition: one session logged through the real logger.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: share-session")
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [saved] = confirmedSessions(api.lastPost("/api/sessions")) as unknown as { date: string }[]
  const fileName = `bench-${saved.date.slice(0, 10)}.png`

  // Expand the logged card and choose Share.
  await page.getByRole("button", { name: /^Session 1 ·/ }).click()
  await page.getByRole("button", { name: "Share", exact: true }).click()
  const sheet = page.getByRole("dialog").filter({ hasText: "share your lift" })
  await expect(sheet).toBeVisible()

  // The card is built into a 1080px-wide PNG preview.
  const preview = sheet.getByRole("img", { name: "Workout share card" })
  await expect(preview).toBeVisible({ timeout: 30_000 })
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1080)
  // Let the preview's fade-in finish so the screenshot shows the card, not a dimmed frame.
  await expect.poll(() => preview.evaluate((img) => img.getAnimations().filter((a) => a.playState === "running").length)).toBe(0)
  await evidence.shot(page, "result", "share-preview")

  // share → the (stubbed) OS share sheet receives the PNG file.
  await sheet.getByRole("button", { name: "share", exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
    .toEqual([expect.objectContaining({ name: fileName, type: "image/png", title: "best workout tracker" })])

  // save → a PNG download of the same name, kept as evidence.
  const download = page.waitForEvent("download")
  await sheet.getByRole("button", { name: "save", exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe(fileName)
  await file.saveAs(path.join(evidence.dir, "share-card-download.png"))
  await expect(sheet.getByText("saved")).toBeVisible()
  await evidence.shot(page, "action", "saved-toast")

  // close → back to Home, nothing sent to the API by sharing.
  const postsBefore = api.calls.filter((c) => c.method !== "GET").length
  await sheet.getByRole("button", { name: "close", exact: true }).click()
  await expect(sheet).toBeHidden()
  expect(api.calls.filter((c) => c.method !== "GET").length).toBe(postsBefore)
  await evidence.shot(page, "result", "closed")

  expect(pageErrors).toEqual([])
})
