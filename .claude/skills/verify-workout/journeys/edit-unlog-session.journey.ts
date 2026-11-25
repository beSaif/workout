import { test, expect } from "./harness"
import { confirmedSessions } from "../../../../e2e/flows"
import { completeOpenLogger, loggerDialog } from "./flows"

test("edit a logged session, then unlog it, from its Home card", { tag: "@edit-unlog-session" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await page.goto("/")

  // Precondition: one session logged through the real logger.
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "before edit")
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(1)
  const [original] = confirmedSessions(api.lastPost("/api/sessions"))

  // Edit: expand the card, choose Edit, delete the last bench set, change the note, save.
  const card = page.getByRole("button", { name: /^Session 1 ·/ })
  await card.click()
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Edit Session 01" }) })
  await expect(editor).toBeVisible()
  // Main-lift set cards come first, each with its own Delete; take the last bench set's.
  const deletes = editor.getByRole("button", { name: "Delete", exact: true })
  await deletes.nth(original.sets.length - 1).click()
  await editor.getByPlaceholder("How did it feel?").fill("after edit")
  await evidence.shot(page, "action", "edit-session-open")
  const postsBefore = api.calls.filter((c) => c.method === "POST" && c.path === "/api/sessions").length
  await editor.getByRole("button", { name: "Save Changes" }).click()
  await expect(editor).toBeHidden()

  // Side effect: the saved session has the new note and one set fewer.
  await expect.poll(() => api.calls.filter((c) => c.method === "POST" && c.path === "/api/sessions").length).toBeGreaterThan(postsBefore)
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions"))[0]?.coachNote).toBe("after edit")
  const [edited] = confirmedSessions(api.lastPost("/api/sessions"))
  expect(edited.id).toBe(original.id)
  expect(edited.sets.length).toBe(original.sets.length - 1)
  evidence.json("edited-session", edited)
  await evidence.shot(page, "result", "home-after-edit")

  // Unlog: expand the card again, choose Unlog and confirm in the alert dialog.
  if (!(await page.getByRole("button", { name: "Unlog", exact: true }).isVisible())) await card.click()
  await page.getByRole("button", { name: "Unlog", exact: true }).click()
  const confirm = page.getByRole("alertdialog", { name: "Unlog Session 01?" })
  await expect(confirm).toBeVisible()
  await evidence.shot(page, "action", "unlog-confirm")
  await confirm.getByRole("button", { name: "Unlog" }).click()
  await expect(confirm).toBeHidden()

  // Side effect: no confirmed sessions left on the API or the device; Home is back to
  // Session 1 up next with nothing logged this block.
  await expect.poll(() => confirmedSessions(api.lastPost("/api/sessions")).length).toBe(0)
  const local = await page.evaluate(() => localStorage.getItem("lift-tracker-sessions"))
  expect(confirmedSessions({ sessions: JSON.parse(local ?? "[]") })).toHaveLength(0)
  await expect(page.getByText("Logged this block")).toBeHidden()
  await expect(page.getByText("Up next", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Session 1 ·/ })).toBeHidden()
  await evidence.shot(page, "result", "home-after-unlog")

  expect(pageErrors).toEqual([])
})
