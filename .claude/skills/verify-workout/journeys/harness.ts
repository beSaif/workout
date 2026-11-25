import fs from "node:fs"
import path from "node:path"
import type { Page } from "@playwright/test"
import { test as smoke, expect, E2E_USER, FakeApi, onboardedProfile } from "../../../../e2e/fixtures"

/**
 * The verify-workout journey harness: the smoke fixtures from e2e/fixtures.ts (forged
 * Auth.js cookie, in-memory FakeApi answering every same-origin /api/** call except
 * /api/auth/**, apiGuard failing a journey that leaks one) plus evidence capture.
 *
 * Every journey is ONE test tagged with its feature id (`{ tag: "@<id>" }`), matching a
 * file in ../features/<id>.md. `verify.mjs run --feature <id>` selects it by that tag.
 */

type Evidence = {
  /** This feature's evidence directory: <out>/<feature-id>/. */
  dir: string
  /**
   * Screenshot the page into the evidence dir as NN-<kind>-<label>.png. Take one `action`
   * shot right before (or during) the user action and one `result` shot of the state it
   * produced; summary.md lists them under the feature.
   */
  shot: (page: Page, kind: "action" | "result", label: string) => Promise<string>
  /** Write a JSON side-effect record (request bodies, localStorage) into the evidence dir. */
  json: (name: string, data: unknown) => string
}

type Fixtures = {
  evidence: Evidence
  /** Cross-origin requests the page tried to make; all are aborted (never sent). */
  externalRequests: string[]
}

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export const test = smoke.extend<Fixtures>({
  // Browser contexts carry the bypass header and ask Vercel for its bypass cookie.
  context: async ({ context }, provide) => {
    if (bypass) {
      await context.setExtraHTTPHeaders({
        "x-vercel-protection-bypass": bypass,
        "x-vercel-set-bypass-cookie": "true",
      })
    }
    await provide(context)
  },

  externalRequests: [
    async ({ context, baseURL }, provide) => {
      const origin = new URL(baseURL!).origin
      const seen: string[] = []
      // Nothing leaves the app's origin: no Google OAuth, no third-party fetches, no
      // real messages. The journey asserts on what the UI tried to send instead.
      await context.route(
        (url) => url.origin !== origin && (url.protocol === "http:" || url.protocol === "https:"),
        async (route) => {
          seen.push(`${route.request().method()} ${route.request().url()}`)
          await route.abort("blockedbyclient")
        },
      )
      await provide(seen)
    },
    { auto: true },
  ],

  evidence: [
    async ({ api, page }, provide, testInfo) => {
      const feature = (testInfo.tags[0] ?? "@untagged").replace(/^@/, "")
      const root = path.resolve(process.env.VERIFY_OUT ?? "verify-evidence/adhoc")
      const dir = path.join(root, feature)
      fs.mkdirSync(dir, { recursive: true })
      let n = 0
      const evidence: Evidence = {
        dir,
        shot: async (p, kind, label) => {
          n += 1
          const file = path.join(dir, `${String(n).padStart(2, "0")}-${kind}-${label.replace(/[^\w-]+/g, "-")}.png`)
          await p.screenshot({ path: file })
          await testInfo.attach(`${kind}: ${label}`, { path: file, contentType: "image/png" })
          return file
        },
        json: (name, data) => {
          const file = path.join(dir, `${name}.json`)
          fs.writeFileSync(file, JSON.stringify(data, null, 2))
          return file
        },
      }
      await provide(evidence)
      // Side effects, whatever the outcome: every /api call the fake answered, and the
      // device copy the app left in localStorage.
      evidence.json("api-calls", api.calls)
      try {
        if (!page.isClosed()) {
          const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
          evidence.json("local-storage", storage)
        }
      } catch {
        // Page navigated away mid-teardown or never loaded: no storage snapshot.
      }
    },
    { auto: true },
  ],
})

/**
 * Give the in-browser FakeApi a per-journey answer for one method + path it does not
 * model (it answers every write with `{ ok: true }`). The request is still answered by
 * the fake, recorded in `api.calls` and counted by apiGuard; a page-level route that
 * fulfils by itself would not be, and apiGuard would fail the journey as a leak.
 */
export function answer(api: FakeApi, method: string, path: string, json: unknown, status = 200): void {
  const original = api.respond.bind(api)
  api.respond = (m, p, body) => {
    if (m !== method || p !== path) return original(m, p, body)
    api.calls.push({ method: m, path: p, body })
    return { status, json }
  }
}

export { expect, E2E_USER, FakeApi, onboardedProfile }
