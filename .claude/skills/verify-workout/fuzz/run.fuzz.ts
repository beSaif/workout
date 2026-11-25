import fs from "node:fs"
import path from "node:path"
import { test } from "@playwright/test"
import { openProbe, runMonkey, type Finding, type MonkeyResult, type RunConfig } from "./monkey"
import { findingSignature, routePattern } from "./lib/signature.mjs"

// The fuzz run's tests, one per phase step. fuzz.mjs writes the run config (target,
// seed, budget, which monkeys) and reads back what each test writes into <out>/parts/.
// Findings never fail a test: a failed test means the harness broke.

const cfgFile = process.env.FUZZ_RUN_CONFIG
if (!cfgFile) throw new Error("FUZZ_RUN_CONFIG is not set: run the fuzz harness through fuzz/fuzz.mjs")
const cfg: RunConfig = JSON.parse(fs.readFileSync(cfgFile, "utf8"))
const parts = path.join(cfg.out, "parts")

function writePart(name: string, data: unknown) {
  fs.mkdirSync(parts, { recursive: true })
  fs.writeFileSync(path.join(parts, `${name}.json`), JSON.stringify(data, null, 2))
}

test("signed-out surface: protected routes redirect, public assets serve", { tag: "@fuzz-signed-out" }, async ({ browser }) => {
  test.setTimeout(10 * 60_000)
  const p = await openProbe(browser, cfg, { signedIn: false })
  const findings: Finding[] = []
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const dir = path.join(cfg.out, "signed-out")
  fs.mkdirSync(dir, { recursive: true })

  const finding = async (kind: string, route: string, message: string, steps: string[], recheck: () => Promise<boolean>) => {
    const signature = findingSignature({ kind, route, message })
    const screenshot = path.join(dir, `finding-${signature}.png`)
    await p.page.screenshot({ path: screenshot }).catch(() => {})
    findings.push({
      signature,
      kind,
      feature: "signed-out",
      route: routePattern(route),
      message,
      reproducible: await recheck().catch(() => false),
      steps: ["fresh browser context at 393×852, signed out", ...steps, `observe: ${kind}: ${message}`],
      screenshot: path.relative(cfg.out, screenshot),
    })
  }

  try {
    // Every documented protected route sends a signed-out visitor to /welcome.
    const landsOn = async (route: string) => {
      await p.page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 })
      return new URL(p.page.url()).pathname
    }
    for (const route of cfg.protectedRoutes) {
      const landed = await landsOn(route).catch((e) => `error: ${String(e.message).split("\n")[0]}`)
      const ok = landed === "/welcome"
      checks.push({ name: `redirect ${route}`, ok, detail: `landed on ${landed}` })
      if (!ok) await finding("auth-redirect", route, `signed-out visit to ${route} landed on ${landed}, not /welcome`, [`open ${route}`], async () => (await landsOn(route)) !== "/welcome")
    }

    // Public pages answer 200 without a session (the monkeys then drive them).
    for (const route of ["/welcome", "/onboarding"]) {
      const res = await p.page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null)
      const landed = new URL(p.page.url()).pathname
      const ok = res?.status() === 200 && landed === route
      checks.push({ name: `public ${route}`, ok, detail: `${res?.status() ?? "no response"} at ${landed}` })
      if (!ok) await finding("public-page", route, `signed-out GET ${route} → ${res?.status() ?? "no response"} at ${landed}`, [`open ${route}`], async () => true)
    }

    // The PWA's public assets: manifest, its icons, the service worker script.
    const get = (url: string) => p.context.request.get(url, { maxRedirects: 0, failOnStatusCode: false })
    const asset = async (url: string, want: RegExp) => {
      const res = await get(url)
      const type = res.headers()["content-type"] ?? ""
      const ok = res.status() === 200 && want.test(type)
      checks.push({ name: `asset ${url}`, ok, detail: `${res.status()} ${type}` })
      if (!ok) {
        await finding("public-asset", url, `GET ${url} → ${res.status()} ${type || "(no content-type)"}, expected 200 ${want.source}`, [`GET ${url} (no cookie)`], async () => {
          const again = await get(url)
          return !(again.status() === 200 && want.test(again.headers()["content-type"] ?? ""))
        })
      }
      return ok ? res : null
    }
    const manifestRes = await asset("/manifest.webmanifest", /json/)
    const manifest = manifestRes ? ((await manifestRes.json().catch(() => null)) as { icons?: { src: string }[] } | null) : null
    for (const src of [...new Set((manifest?.icons ?? []).map((i) => i.src))]) await asset(src, /^image\//)
    await asset("/sw.js", /javascript/)
  } finally {
    writePart("signed-out", { checks, findings, blocked: p.blocked, apiLeaks: p.leaked, dataRequests: { seen: p.data.seen, answered: p.data.answered.size } })
    await p.context.close().catch(() => {})
  }
})

cfg.monkeys.forEach((t, i) => {
  test(`monkey ${t.id}`, { tag: "@fuzz-monkey" }, async ({ browser }) => {
    // The remaining time is shared evenly by the monkeys still to run.
    const budget = Math.floor((cfg.deadline - Date.now()) / (cfg.monkeys.length - i))
    test.setTimeout(Math.max(budget, 0) + 5 * 60_000)
    let result: MonkeyResult
    if (budget < 5_000) {
      result = { id: t.id, feature: t.feature, signedIn: t.signedIn, status: "skipped", skippedReason: "time budget exhausted", actions: 0, findings: [], blocked: [], dataRequests: { seen: 0, answered: 0 }, apiLeaks: [] }
    } else {
      result = await runMonkey(browser, cfg, t, budget)
    }
    writePart(`monkey-${t.id.replace(/[^\w-]+/g, "_")}`, result)
  })
})
