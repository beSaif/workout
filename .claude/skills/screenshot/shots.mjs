// Screenshots of the app without Google sign-in or Vercel KV: a signed Auth.js
// session cookie gets past the proxy, and Playwright answers every /api/* call
// from the scenario's mocks (anything unmocked gets []).
//
//   node .claude/skills/screenshot/shots.mjs <scenario.json> <out-dir>
//
// Needs the dev server on BASE_URL (default http://localhost:3100) started with
// the same AUTH_SECRET as below. See SKILL.md.
import { readFileSync, mkdirSync, existsSync } from "fs"
import { execSync } from "child_process"
import { createRequire } from "module"
import { encode } from "next-auth/jwt"

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync("npm root -g").toString().trim()}/playwright`)

const [scenarioPath, outDir] = process.argv.slice(2)
if (!scenarioPath || !outDir) {
  console.error("usage: node shots.mjs <scenario.json> <out-dir>")
  process.exit(1)
}

const BASE = process.env.BASE_URL ?? "http://localhost:3100"
const SECRET = process.env.AUTH_SECRET ?? "screenshot-secret-0123456789abcdef"
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"))
const viewer = scenario.viewer ?? { name: "Saif", email: "saif@example.com" }
mkdirSync(outDir, { recursive: true })

const token = await encode({
  token: { name: viewer.name, email: viewer.email, sub: "1" },
  secret: SECRET,
  salt: "authjs.session-token",
})

// The sandbox keeps a symlink to whichever Chromium build it ships, so the path
// carries no version to go stale. Anywhere else, Playwright finds its own browser.
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium"
const executablePath =
  process.env.CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined)
const browser = await chromium.launch(executablePath ? { executablePath } : {})

/** "role:button:Train under Omar" → getByRole; anything else is a Playwright selector. */
function locate(page, target) {
  if (target.startsWith("role:")) {
    const [, role, ...name] = target.split(":")
    return page.getByRole(role, { name: name.join(":") }).first()
  }
  return page.locator(target).first()
}

for (const shot of scenario.shots) {
  const ctx = await browser.newContext({
    viewport: shot.viewport ?? scenario.viewport ?? { width: 393, height: 852 },
    deviceScaleFactor: 2,
  })
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: new URL(BASE).hostname, path: "/" }])
  const mocks = { ...scenario.mocks, ...shot.mocks }
  const page = await ctx.newPage()
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith("/api/auth")) return route.continue()
    const body = path in mocks ? mocks[path] : []
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  })

  await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle", timeout: 120000 })
  if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 60000 })
  await page.waitForTimeout(800)

  for (const step of shot.steps ?? []) {
    if (step.click) await locate(page, step.click).click()
    if (step.scroll) await page.mouse.wheel(0, step.scroll)
    if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout: 30000 })
    await page.waitForTimeout(step.wait ?? 400)
  }

  const file = `${outDir}/${shot.name}.png`
  await page.screenshot({ path: file, fullPage: !!shot.fullPage })
  console.log(file)
  await ctx.close()
}

await browser.close()
