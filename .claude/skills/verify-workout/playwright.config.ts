import { defineConfig, devices } from "@playwright/test"
import path from "node:path"

// Verification journeys for the verify-workout skill. Run them through
// `node .claude/skills/verify-workout/verify.mjs run`, which sets the variables below,
// launches/doctors the target and writes the evidence summary. They are deliberately
// outside e2e/ and match *.journey.ts, so neither `pnpm test` (Vitest, src/**/*.test.ts)
// nor `pnpm test:e2e` (playwright.config.ts at the root, testDir e2e) picks them up.
const baseURL = process.env.BASE_URL
if (!baseURL) throw new Error("BASE_URL is not set: run journeys through verify.mjs, not playwright directly")

const out = path.resolve(process.env.VERIFY_OUT ?? "verify-evidence/adhoc")

// Vercel Deployment Protection. Plain `request` calls get only the bypass header: with
// x-vercel-set-bypass-cookie too, Vercel answers 307 to set its cookie. Browser contexts
// get both (see journeys/harness.ts), so requests the page makes on its own carry it.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const extraHTTPHeaders: Record<string, string> = bypass ? { "x-vercel-protection-bypass": bypass } : {}

export default defineConfig({
  testDir: "journeys",
  testMatch: "*.journey.ts",
  outputDir: path.join(out, "playwright-output"),
  fullyParallel: true,
  workers: process.env.VERIFY_WORKERS ? Number(process.env.VERIFY_WORKERS) : 3,
  // Evidence must be honest: no retries, a failure is a failure.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: path.join(out, "results.json") }]],
  use: {
    baseURL,
    extraHTTPHeaders,
    // Every journey is recorded; screenshots of the action and the result are taken
    // explicitly by the journeys (harness.ts `evidence.shot`).
    // Off when the fuzz harness runs the journeys (VERIFY_FUZZ_GUARD=1): it keeps the run
    // within its memory budget, and fuzz evidence is screenshots, traces and step logs.
    video: process.env.VERIFY_FUZZ_GUARD === "1" ? "off" : { mode: "on", size: { width: 393, height: 852 } },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Service workers would sit between the page and the /api fake.
    serviceWorkers: "block",
  },
  projects: [
    {
      // Desktop Chrome engine at phone width: the app is a phone-first PWA (max-w 393px).
      name: "chromium-phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 393, height: 852 } },
    },
  ],
})
