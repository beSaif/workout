import { test, expect } from "./fixtures"
import type { Route } from "@playwright/test"

/**
 * Regression: a background response answered after sign-out must not revive the session.
 *
 * Auth.js's proxy re-issues the session cookie on the responses it passes through. On
 * /profile the router prefetches linked pages (`?_rsc=`) while the user is signed in; if
 * one of those responses lands after "Yes, delete everything" has signed the user out,
 * the cookie it carries used to sign them straight back in (a deleted account landing on
 * /onboarding instead of /welcome). On a deployed preview that depended on latency.
 *
 * Made deterministic here: every prefetch response is fetched from the server at once
 * (while signed in, so before the fix it carries a session cookie) but delivered to the
 * browser only after the sign-out response, and before the /welcome navigation that
 * follows it, which is exactly the losing order.
 */
test("a prefetch answered after sign-out does not sign the deleted account back in", async ({ page, context, signIn, baseURL, browserName, pageErrors }) => {
  // Server behaviour, one engine is enough; Chromium applies Set-Cookie from fulfilled responses.
  test.skip(browserName !== "chromium", "server-side race; driven in Chromium")
  const origin = new URL(baseURL!).origin
  await signIn()

  const held: { route: Route; response: Awaited<ReturnType<Route["fetch"]>> }[] = []
  let signedOut = false
  const deliverHeld = async () => {
    for (const h of held.splice(0)) await h.route.fulfill({ response: h.response }).catch(() => {})
  }

  // Background RSC requests (prefetches) while signed in: the server answers now, the
  // browser gets the answer only after sign-out.
  await context.route(
    (url) => url.origin === origin && url.searchParams.has("_rsc"),
    async (route) => {
      if (signedOut) return route.fallback()
      // Playwright intercepts before Chromium's network stack adds Sec-Fetch-*, so replay
      // the request as the browser sends it on the wire: an RSC prefetch is a fetch().
      const headers = { ...route.request().headers(), "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }
      held.push({ route, response: await route.fetch({ headers }) })
    },
  )
  // Sign-out: let it through, then mark that it has been answered.
  await context.route(`${origin}/api/auth/signout`, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response })
    signedOut = true
  })
  // The /welcome page load that sign-out starts: deliver the held prefetches first.
  await context.route(
    (url) => url.origin === origin && url.pathname === "/welcome",
    async (route) => {
      if (signedOut && route.request().isNavigationRequest()) await deliverHeld()
      await route.fallback()
    },
  )

  await page.goto("/profile")
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
  // The page has prefetched at least one linked route while signed in.
  await expect.poll(() => held.length).toBeGreaterThan(0)

  await page.getByRole("button", { name: "Delete account & data" }).click()
  await page.getByRole("dialog").filter({ hasText: "Delete everything?" }).getByRole("button", { name: "Yes, delete everything" }).click()
  await expect(page).toHaveURL(/\/welcome/)
  await expect(page.getByRole("heading", { level: 1, name: "best workout tracker." })).toBeVisible()

  // The late prefetch answers did not put a session cookie back...
  const session = (await context.cookies()).filter((c) => /authjs\.session-token/.test(c.name))
  expect(session, "session cookie after sign-out").toEqual([])
  // ...so Home still sends the signed-out visitor to /welcome.
  await page.goto("/")
  await expect(page).toHaveURL(/\/welcome/)
  expect(pageErrors).toEqual([])
})
