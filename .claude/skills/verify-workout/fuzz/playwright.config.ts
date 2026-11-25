import { defineConfig } from "@playwright/test"
import path from "node:path"

// The fuzz harness's Playwright run. Start it through fuzz/fuzz.mjs, which writes the run
// config (FUZZ_RUN_CONFIG) and aggregates the report. One worker, no video and no
// automatic traces: the monkeys open their own contexts (fuzz/monkey.ts) and keep a trace
// only for a violation, so a run fits in ~1.5 GB. Matches *.fuzz.ts only, so neither
// `pnpm test` nor `pnpm test:e2e` nor verify.mjs picks these up.
const out = path.resolve(process.env.FUZZ_OUT ?? "verify-evidence/fuzz-adhoc")

export default defineConfig({
  testDir: ".",
  testMatch: "*.fuzz.ts",
  outputDir: path.join(out, "playwright-output"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  reporter: [["list"], ["json", { outputFile: path.join(out, "fuzz-results.json") }]],
  use: {
    serviceWorkers: "block",
    video: "off",
    trace: "off",
    screenshot: "off",
  },
})
