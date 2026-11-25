import { test, expect } from "./fixtures"

type ManifestIcon = { src: string; sizes?: string; type?: string; purpose?: string }

test.describe("PWA", () => {
  test("the manifest is valid and its icons load", async ({ request, baseURL }) => {
    const res = await request.get("/manifest.webmanifest")
    expect(res.status()).toBe(200)
    const manifest = JSON.parse(await res.text())

    expect(manifest.name).toBeTruthy()
    expect(manifest.start_url).toBeTruthy()
    expect(manifest.display).toBe("standalone")
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy()

    const manifestUrl = new URL("/manifest.webmanifest", baseURL)
    for (const icon of manifest.icons as ManifestIcon[]) {
      const iconRes = await request.get(new URL(icon.src, manifestUrl).toString())
      expect(iconRes.status(), `${icon.src} status`).toBe(200)
      expect(iconRes.headers()["content-type"], `${icon.src} content-type`).toMatch(/^image\/png\b/)
    }
  })

  test("/sw.js is served as JavaScript", async ({ request }) => {
    const res = await request.get("/sw.js")
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toMatch(/javascript/)
  })

  test.describe("registration", () => {
    test.use({ serviceWorkers: "allow" })

    // Runs on WebKit too: Playwright's WebKit runs service workers (checked with
    // Playwright 1.63), so no project needs to skip this.
    test("the service worker registers and activates", async ({ page }) => {
      // /welcome needs no session and makes no data-API calls; the root layout's
      // SwRegistrar registers the worker on every page.
      await page.goto("/welcome")
      const scope = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready
        return reg.scope
      })
      expect(new URL(scope).pathname).toBe("/")
      const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
      expect(new URL(scriptURL!).pathname).toBe("/sw.js")
    })
  })
})
