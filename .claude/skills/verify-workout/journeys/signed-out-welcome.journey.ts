import { test, expect } from "./harness"

test("signed out: Home redirects to the welcome page, which offers onboarding and Google sign-in", { tag: "@signed-out-welcome" }, async ({ page, api, evidence, externalRequests, pageErrors }) => {
  // No signIn(): no session cookie. The proxy sends / to /welcome, keeping the destination.
  await page.goto("/")
  await expect(page).toHaveURL(/\/welcome(\?callbackUrl=.*)?$/)
  await expect(page.getByRole("heading", { level: 1, name: "best workout tracker." })).toBeVisible()
  const getStarted = page.getByRole("link", { name: "get started" })
  await expect(getStarted).toHaveAttribute("href", "/onboarding")
  const returning = page.getByRole("button", { name: "i've done this before" })
  await expect(returning).toBeVisible()
  await evidence.shot(page, "result", "welcome-after-redirect")

  // "i've done this before": a server action starts Auth.js's Google sign-in. The harness
  // aborts every cross-origin request, so the browser never reaches Google.
  await evidence.shot(page, "action", "tap-ive-done-this-before")
  const googleRequest = page.waitForRequest((r) => new URL(r.url()).hostname === "accounts.google.com")
  await returning.click()
  const req = await googleRequest
  const auth = new URL(req.url())
  expect(auth.pathname).toMatch(/^\/o\/oauth2\//)
  expect(auth.searchParams.get("redirect_uri") ?? "").toMatch(/\/api\/auth\/callback\/google$/)
  await expect.poll(() => externalRequests.some((r) => r.includes("accounts.google.com"))).toBe(true)
  evidence.json("google-signin-request", { url: req.url(), externalRequests })
  await evidence.shot(page, "result", "google-signin-blocked")

  // "get started" opens onboarding without any session.
  await page.goto("/welcome")
  await getStarted.click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByText("what do we call you?")).toBeVisible()
  await evidence.shot(page, "result", "onboarding-first-question")

  // Signed out, nothing was written anywhere.
  expect(api.calls.filter((c) => c.method !== "GET")).toEqual([])
  expect(pageErrors).toEqual([])
})
