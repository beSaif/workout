import { test, expect } from "./harness"

type ManifestIcon = { src: string; sizes?: string; type?: string; purpose?: string }

// This journey needs the real service worker (every other journey blocks it), and a
// phone user agent: on a desktop one the guide only says "open this on your phone".
test.use({
  serviceWorkers: "allow",
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
})

test("PWA: manifest and icons, service worker, and the add-to-home-screen guide", { tag: "@pwa-install" }, async ({ page, context, request, baseURL, signIn, evidence, pageErrors }) => {
  // Manifest: installable shape, and every icon it names loads as a PNG.
  const res = await request.get("/manifest.webmanifest")
  expect(res.status()).toBe(200)
  const manifest = JSON.parse(await res.text())
  expect(manifest.name).toBeTruthy()
  expect(manifest.start_url).toBeTruthy()
  expect(manifest.display).toBe("standalone")
  expect(manifest.icons.length).toBeGreaterThan(0)
  const manifestUrl = new URL("/manifest.webmanifest", baseURL)
  const icons: Record<string, number | string> = {}
  for (const icon of manifest.icons as ManifestIcon[]) {
    const iconRes = await request.get(new URL(icon.src, manifestUrl).toString())
    expect(iconRes.status(), `${icon.src} status`).toBe(200)
    expect(iconRes.headers()["content-type"], `${icon.src} content-type`).toMatch(/^image\/png\b/)
    icons[icon.src] = iconRes.headers()["content-type"]
  }
  const sw = await request.get("/sw.js")
  expect(sw.status()).toBe(200)
  expect(sw.headers()["content-type"]).toMatch(/javascript/)
  evidence.json("manifest", { manifest, icons, swContentType: sw.headers()["content-type"] })

  // Signed out, /welcome registers the worker at scope "/".
  await page.goto("/welcome")
  await expect(page.getByRole("heading", { level: 1, name: "best workout tracker." })).toBeVisible()
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready
    return { scope: r.scope, script: r.active?.scriptURL ?? null }
  })
  expect(new URL(reg.scope).pathname).toBe("/")
  expect(new URL(reg.script!).pathname).toBe("/sw.js")
  evidence.json("service-worker", reg)
  await evidence.shot(page, "result", "welcome-sw-registered")

  // Signed in on a device that never dismissed the guide (signIn() dismisses it on every
  // load; undo that for the first load only).
  await signIn()
  await context.addInitScript(() => {
    if (sessionStorage.getItem("verify-install-guide-seeded")) return
    sessionStorage.setItem("verify-install-guide-seeded", "1")
    localStorage.removeItem("installGuideDismissed")
  })
  await page.goto("/")
  const guide = page.getByRole("dialog").filter({ hasText: "add this to your home screen" })
  await expect(guide).toBeVisible()
  // Android without a captured install prompt: the written Chrome steps.
  await expect(guide.getByText(/open in Chrome\s*if you're not already/)).toBeVisible()
  await evidence.shot(page, "action", "install-guide")
  await guide.getByRole("button", { name: "maybe later" }).click()
  await expect(guide).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem("installGuideDismissed"))).toBe("1")

  // In-app away and back: the guide stays dismissed.
  await page.getByRole("button", { name: "Open menu" }).click()
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "History", exact: true }).click()
  await expect(page).toHaveURL(/\/history$/)
  await page.getByRole("link", { name: "Back to home" }).click()
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  await expect(guide).toBeHidden()
  await evidence.shot(page, "result", "home-guide-dismissed")

  expect(pageErrors).toEqual([])
})
