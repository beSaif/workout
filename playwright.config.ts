import { defineConfig, devices } from "@playwright/test"

// Smoke tests run against a deployed URL (a Vercel preview in CI), never a local
// server: see e2e/ and the "Smoke tests" section of the README.
const baseURL = process.env.BASE_URL
if (!baseURL) {
  throw new Error(
    "BASE_URL is not set. Point it at a deployment, e.g.\n" +
      "  BASE_URL=https://<preview>.vercel.app E2E_AUTH_SECRET=... pnpm test:e2e",
  )
}

// Vercel Deployment Protection: send the automation bypass on every request, and ask
// Vercel to set its bypass cookie so requests the page makes on its own carry it too.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const extraHTTPHeaders: Record<string, string> = bypass
  ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
  : {}

export default defineConfig({
  testDir: "e2e",
  // Each test gets its own browser context and in-memory API fake, so they are
  // independent; the preview is shared, which keeps parallelism modest.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    extraHTTPHeaders,
    trace: "on-first-retry",
    // Service workers would sit between the page and the /api fake (see
    // e2e/fixtures.ts); only the PWA spec turns them back on.
    serviceWorkers: "block",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 15"] } },
  ],
})
