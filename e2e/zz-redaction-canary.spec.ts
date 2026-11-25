// THROWAWAY canary for t_b0f1c455 (DO NOT MERGE): fails on purpose so the uploaded
// report holds a trace, a request call log with headers and the forged session cookie.
import { test } from "./fixtures"

test("redaction canary: deliberately failing", async ({ page, signIn, browserName }) => {
  test.skip(browserName !== "chromium", "chromium only")
  await signIn()
  await page.goto("/")
  await page.request.get("/redaction-canary-404", { failOnStatusCode: true })
})
