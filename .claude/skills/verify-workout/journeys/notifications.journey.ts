import { test, expect } from "./harness"

// Subscribing waits on the real service worker, which every other journey blocks.
test.use({ serviceWorkers: "allow" })

type SubscribeBody = { subscription?: { endpoint?: string; keys?: Record<string, string> }; tz?: string }

test("notifications: the opt-in banner asks for permission and registers a push subscription", { tag: "@notifications" }, async ({ page, context, signIn, api, evidence, pageErrors }) => {
  await signIn()
  // The browser's push service (FCM for Chrome) is outside the app: stand in for it at
  // that boundary, so subscribing yields a fixed subscription and nothing leaves the VM.
  // What the app then POSTs to /api/push/subscribe is the side effect under test.
  await context.addInitScript(() => {
    // Headless Chromium answers every permission with "denied" and shows no prompt, so
    // the browser's permission prompt is stood in for too: "default" until the app asks,
    // then the user's "Allow" (kept for the tab's life, like a real grant).
    if (typeof Notification !== "undefined") {
      const KEY = "verify-notification-permission"
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => sessionStorage.getItem(KEY) ?? "default",
      })
      Notification.requestPermission = async () => {
        sessionStorage.setItem(KEY, "granted")
        return "granted"
      }
    }
    const fake = {
      endpoint: "https://push.example.invalid/verify-workout",
      expirationTime: null,
      toJSON() {
        return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: "verify-p256dh", auth: "verify-auth" } }
      },
    }
    if (typeof PushManager !== "undefined") {
      let subscribed = false
      PushManager.prototype.subscribe = async function () {
        subscribed = true
        return fake as unknown as PushSubscription
      }
      PushManager.prototype.getSubscription = async function () {
        return subscribed ? (fake as unknown as PushSubscription) : null
      }
    }
  })

  await page.goto("/")
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  const banner = page.getByText("Enable notifications for friend requests")
  // Only offered when the deployment has a public VAPID key and the browser hasn't
  // been asked yet (permission "default").
  await expect(banner, "banner missing: was the build made with NEXT_PUBLIC_VAPID_PUBLIC_KEY?").toBeVisible()
  await evidence.shot(page, "action", "notification-banner")

  // Dismiss hides it for this visit only.
  await page.getByRole("button", { name: "Dismiss" }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(banner).toBeVisible()

  // Enable: the user allows the browser prompt, the app subscribes and stores it.
  await page.getByRole("button", { name: "Enable", exact: true }).click()
  await expect(banner).toBeHidden()
  expect(await page.evaluate(() => Notification.permission)).toBe("granted")
  await expect.poll(() => (api.lastPost("/api/push/subscribe") as SubscribeBody | undefined)?.subscription?.endpoint).toBe(
    "https://push.example.invalid/verify-workout",
  )
  const body = api.lastPost("/api/push/subscribe") as SubscribeBody
  expect(body.tz).toBeTruthy()
  evidence.json("push-subscribe-body", body)

  // Permission granted: no banner on the next visit, and the subscription is refreshed.
  const before = api.calls.filter((c) => c.path === "/api/push/subscribe").length
  await page.reload()
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  await expect(banner).toBeHidden()
  await expect.poll(() => api.calls.filter((c) => c.path === "/api/push/subscribe").length).toBeGreaterThan(before)
  await evidence.shot(page, "result", "home-notifications-on")

  expect(pageErrors).toEqual([])
})
