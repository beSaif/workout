import type { Page } from "@playwright/test"
import { test, expect, type FakeApi } from "./harness"
import { LEA, OMAR, friendsList, summary } from "./social"
import type { FriendRequest, UserProfile } from "../../../../src/lib/types"

const RAY: UserProfile = { ...LEA, email: "ray@example.invalid", name: "Ray Rejected" }

/**
 * A small stateful "server" for the friend graph: before each request falls through to
 * the context-level FakeApi (which answers and records it), the fake is re-seeded with
 * what KV would hold after the writes so far. Accept/reject/remove therefore show up
 * on the UI's own re-fetch, exactly as against the real routes.
 */
async function friendGraph(page: Page, api: FakeApi, friends: UserProfile[], requests: FriendRequest[]) {
  const seed = () => {
    api.seed("/api/friends", friendsList(...friends))
    api.seed("/api/friends/requests", { requests, count: requests.length })
  }
  seed()
  const body = (raw: string | null) => (raw ? (JSON.parse(raw) as Record<string, string>) : {})
  await page.route("**/api/friends/accept", async (route) => {
    const email = body(route.request().postData()).requesterEmail
    const req = requests.find((r) => r.email === email)
    if (req) {
      requests = requests.filter((r) => r !== req)
      friends = [...friends, [OMAR, LEA, RAY].find((p) => p.email === email)!]
    }
    seed()
    await route.fallback()
  })
  await page.route("**/api/friends/reject", async (route) => {
    const email = body(route.request().postData()).requesterEmail
    requests = requests.filter((r) => r.email !== email)
    seed()
    await route.fallback()
  })
  await page.route("**/api/friends", async (route) => {
    if (route.request().method() === "DELETE") {
      const email = body(route.request().postData()).friendEmail
      friends = friends.filter((f) => f.email !== email)
    } else seed()
    // The fake's DELETE drops the stored list; GETs re-seed it first so they read the rest.
    await route.fallback()
  })
  await page.route("**/api/friends/requests", async (route) => {
    seed()
    await route.fallback()
  })
}

test("find, add, accept, reject and remove gymbros", { tag: "@gymbros" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  await signIn()
  const sentAt = new Date(Date.now() - 3_600_000).toISOString()
  await friendGraph(page, api, [LEA], [
    { email: OMAR.email, name: OMAR.name, sentAt },
    { email: RAY.email, name: RAY.name, sentAt },
  ])
  api.seed("/api/users/search", [summary(OMAR)])

  // Entry: Home's gymbros timeline "+ add".
  await page.goto("/")
  await page.getByRole("link", { name: "Add a gymbro" }).click()
  await expect(page).toHaveURL(/\/gymbros$/)
  await expect(page.getByRole("heading", { level: 1, name: "Gymbros" })).toBeVisible()
  await expect(page.getByText("1 gymbro", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /Lea Placeholder/ })).toBeVisible()

  // Search by name: results come from /api/users/search and link to the profile.
  const field = page.getByRole("textbox", { name: "Search by name or add by email" })
  const search = page.waitForRequest((r) => r.url().includes("/api/users/search?q=omar"))
  await field.fill("omar")
  await search
  const hit = page.getByRole("link", { name: /Omar Example/ })
  await expect(hit).toHaveAttribute("href", `/friends/${encodeURIComponent(OMAR.email)}`)
  await evidence.shot(page, "action", "search-by-name")

  // Add by email: the field turns into an invitation with an Add button.
  await field.fill("newbie@example.invalid")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText("Request sent")).toBeVisible()
  expect(api.lastPost("/api/friends/request")).toEqual({ targetEmail: "newbie@example.invalid" })
  await evidence.shot(page, "result", "request-sent")

  // Incoming requests: accept Omar, reject Ray.
  await page.getByRole("button", { name: "Friend requests" }).click()
  await expect(page.getByText("Pending requests")).toBeVisible()
  const omarRow = page.getByRole("listitem").filter({ hasText: OMAR.email })
  const rayRow = page.getByRole("listitem").filter({ hasText: RAY.email })
  await evidence.shot(page, "action", "pending-requests")
  await omarRow.getByRole("button", { name: "Accept" }).click()
  await expect(page.getByText("2 gymbros", { exact: true })).toBeVisible()
  expect(api.lastPost("/api/friends/accept")).toEqual({ requesterEmail: OMAR.email })
  await rayRow.getByRole("button", { name: "Reject" }).click()
  await expect(page.getByText("No pending requests")).toBeVisible()
  expect(api.lastPost("/api/friends/reject")).toEqual({ requesterEmail: RAY.email })
  await expect(page.getByRole("link", { name: /Omar Example/ })).toBeVisible()
  await evidence.shot(page, "result", "accepted-omar-rejected-ray")

  // Remove a gymbro through its confirmation sheet.
  await page.getByRole("button", { name: `Remove ${LEA.name}` }).click()
  const sheet = page.getByRole("dialog").filter({ hasText: `Remove ${LEA.name}?` })
  await expect(sheet).toBeVisible()
  await evidence.shot(page, "action", "remove-confirm")
  await sheet.getByRole("button", { name: "Remove gymbro" }).click()
  await expect(page.getByText("1 gymbro", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /Lea Placeholder/ })).toHaveCount(0)
  const del = api.calls.filter((c) => c.method === "DELETE" && c.path === "/api/friends")
  expect(del.map((c) => c.body)).toEqual([{ friendEmail: LEA.email }])
  await evidence.shot(page, "result", "lea-removed")

  expect(pageErrors).toEqual([])
})
