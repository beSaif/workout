import { test, expect } from "./harness"
import { completeOpenLogger, loggerDialog } from "./flows"
import { LEA, OMAR, friendProfile, friendsList, message, presence } from "./social"

test("receive, dismiss, reply to and send gymbro messages, including the post-session hype", { tag: "@messages" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  api.seed("/api/friends", friendsList(OMAR))
  api.seed("/api/presence", [presence(OMAR, false)])
  api.seed("/api/messages", [message(OMAR, "gym's open btw. has been. all week.")])
  api.seed("/api/friends/profile", friendProfile(OMAR))

  const sends = () => api.calls.filter((c) => c.method === "POST" && c.path === "/api/messages/send").map((c) => c.body)

  // Receive on Home: the sender's face on the gymbros timeline carries an unread badge.
  await page.goto("/")
  const face = page.getByRole("button", { name: /^Omar Example, .*1 new message$/ })
  await expect(face).toBeVisible()
  await evidence.shot(page, "action", "home-unread-badge")
  await face.click()
  const popup = page.getByRole("dialog").filter({ hasText: "1 message" }).filter({ hasText: OMAR.name })
  await expect(popup.getByText("gym's open btw. has been. all week.")).toBeVisible()
  // Opening marks that sender's messages read on the server.
  await expect.poll(() => api.calls.find((c) => c.method === "DELETE" && c.path === "/api/messages")?.body).toEqual({ fromEmail: OMAR.email })

  // Reply from the popup with a custom line.
  await popup.getByRole("button", { name: "Reply 💬" }).click()
  await popup.getByPlaceholder("or type your own...").fill("verify-workout: on my way")
  await popup.getByRole("button", { name: "send", exact: true }).click()
  await expect(popup.getByText("sent", { exact: true })).toBeVisible()
  expect(sends()).toEqual([{ toEmail: OMAR.email, text: "verify-workout: on my way" }])
  await evidence.shot(page, "result", "reply-sent")
  await expect(popup).toBeHidden()
  await expect(page.getByRole("link", { name: /^Omar Example, / })).toBeVisible()

  // Receive on /gymbros: the inbox panel, dismissed for good with "Dismiss messages".
  api.seed("/api/messages", [message(LEA, "one set. just do one set.", 2)])
  await page.goto("/gymbros")
  await expect(page.getByText("🔥 1 message")).toBeVisible()
  await expect(page.getByText("one set. just do one set.")).toBeVisible()
  await evidence.shot(page, "action", "gymbros-inbox")
  await page.getByRole("button", { name: "Dismiss messages" }).click()
  await expect(page.getByText("🔥 1 message")).toBeHidden()
  const deletes = api.calls.filter((c) => c.method === "DELETE" && c.path === "/api/messages")
  expect(deletes).toHaveLength(2)
  expect(deletes[1].body).toBeNull()
  await page.reload()
  await expect(page.getByRole("heading", { level: 1, name: "Gymbros" })).toBeVisible()
  await expect(page.getByText("🔥 1 message")).toHaveCount(0)
  await evidence.shot(page, "result", "gymbros-inbox-dismissed")

  // Send from a friend's profile: Message → a one-tap roast.
  await page.goto(`/friends/${encodeURIComponent(OMAR.email)}`)
  await page.getByRole("button", { name: "Message" }).click()
  const composer = page.getByRole("dialog").filter({ hasText: "roasting" })
  await expect(composer).toBeVisible()
  await evidence.shot(page, "action", "profile-composer")
  await composer.getByRole("button", { name: "go move something heavy" }).click()
  await expect(composer.getByText("sent", { exact: true })).toBeVisible()
  expect(sends().at(-1)).toEqual({ toEmail: OMAR.email, text: "go move something heavy" })

  // Post-session hype: confirming a session with a gymbro opens the hype panel.
  await page.goto("/")
  await page.getByRole("button", { name: "Log Session", exact: true }).click()
  await completeOpenLogger(page, loggerDialog(page), "verify-workout: messages")
  const hype = page.getByRole("dialog").filter({ hasText: "your pr is older than this app" })
  await expect(hype).toBeVisible()
  await evidence.shot(page, "action", "hype-panel")
  await hype.getByRole("button", { name: "your pr is older than this app" }).click()
  await expect.poll(() => sends().at(-1)).toEqual({ toEmail: OMAR.email, text: "your pr is older than this app" })
  await expect(page.getByText("sent", { exact: true })).toBeVisible()
  await evidence.shot(page, "result", "hype-sent")
  expect(sends()).toHaveLength(3)

  expect(pageErrors).toEqual([])
})
