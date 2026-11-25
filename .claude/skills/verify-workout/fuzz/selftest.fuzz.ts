import fs from "node:fs"
import { expect, test } from "@playwright/test"
import { installFuzzGuard } from "./guard"
import { openProbe, runMonkey, type RunConfig } from "./monkey"

// `fuzz.mjs selftest`: the fuzz harness's safety wall, end to end, against the LOCAL
// server from verify.mjs launch (whose KV URL is unroutable). Each test is one guarantee
// SKILL.md's "Fuzz" section makes.

const cfgFile = process.env.FUZZ_RUN_CONFIG
if (!cfgFile) throw new Error("FUZZ_RUN_CONFIG is not set: run through `fuzz.mjs selftest`")
const cfg: RunConfig = JSON.parse(fs.readFileSync(cfgFile, "utf8"))

test.beforeAll(() => {
  const host = new URL(cfg.baseUrl).hostname
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`selftest only runs against a local server, not ${host}`)
})

test("a signed-in monkey leaves no /api data request unanswered by the fake", { tag: "@fuzz-selftest" }, async ({ browser }) => {
  test.setTimeout(5 * 60_000)
  for (const t of [
    { id: "selftest-home", feature: "home-dashboard", route: "/", signedIn: true },
    { id: "selftest-profile", feature: "profile-settings", route: "/profile", signedIn: true },
  ]) {
    const r = await runMonkey(browser, { ...cfg, maxActions: cfg.maxActions }, t, 90_000)
    expect(r.actions, `${t.id} drove the app`).toBeGreaterThan(0)
    expect(r.dataRequests.seen, `${t.id} made /api data requests`).toBeGreaterThan(0)
    expect(r.apiLeaks, "data-API requests that reached the network (the real KV backend)").toEqual([])
    expect(r.dataRequests.answered, "every /api data request was answered by FakeApi").toBe(r.dataRequests.seen)
  }
})

test("contexts are fresh and non-persistent, with service workers blocked", { tag: "@fuzz-selftest" }, async ({ browser }) => {
  const a = await openProbe(browser, cfg, { signedIn: true })
  await a.page.goto("/")
  await a.page.evaluate(() => localStorage.setItem("fuzz-selftest-marker", "1"))
  await a.page.reload()
  expect(await a.page.evaluate(() => navigator.serviceWorker?.controller ?? null), "no service worker controls the page").toBeNull()
  await a.context.close()
  const b = await openProbe(browser, cfg, { signedIn: false })
  expect(await b.context.cookies(), "a signed-out context starts without cookies").toEqual([])
  await b.page.goto("/welcome")
  expect(await b.page.evaluate(() => localStorage.getItem("fuzz-selftest-marker")), "storage does not survive into the next context").toBeNull()
  expect((await b.context.cookies()).map((c) => c.name), "no session carried over").not.toContainEqual(expect.stringMatching(/session-token/))
  await b.context.close()
})

test("cross-origin requests, server actions and other same-origin writes are aborted and recorded", { tag: "@fuzz-selftest" }, async ({ browser }) => {
  const p = await openProbe(browser, cfg, { signedIn: false })
  await p.page.goto("/welcome")
  // "i've done this before" is a server action (Auth.js Google sign-in).
  await p.page.getByRole("button", { name: "i've done this before" }).click()
  await expect.poll(() => p.blocked.map((b) => b.kind)).toContain("server-action")
  expect(new URL(p.page.url()).hostname, "never reached Google").not.toBe("accounts.google.com")

  await p.page.goto("/welcome")
  const outcome = await p.page.evaluate(async () => {
    const tryFetch = (url: string, init?: RequestInit) => fetch(url, init).then((r) => `status ${r.status}`, () => "failed")
    return {
      external: await tryFetch("https://example.com/"),
      formPost: await tryFetch("/welcome", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" }),
      jsonPut: await tryFetch("/welcome", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" }),
      dataPost: await tryFetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessions: [], blocks: [] }) }),
    }
  })
  expect(outcome.external).toBe("failed")
  expect(outcome.formPost).toBe("failed")
  expect(outcome.jsonPut).toBe("failed")
  // Data writes are answered by the fake, never sent.
  expect(outcome.dataPost).toBe("status 200")
  expect(p.api.lastPost("/api/sessions")).toEqual({ sessions: [], blocks: [] })
  expect(p.blocked.map((b) => b.kind)).toEqual(expect.arrayContaining(["external", "form-post", "other-write"]))
  await p.context.close()
})

test("on production, Auth.js POSTs other than sign-out are aborted", { tag: "@fuzz-selftest" }, async ({ browser }) => {
  // The production rules, exercised against the local server: classify as if production.
  const context = await browser.newContext({ baseURL: cfg.baseUrl, serviceWorkers: "block" })
  const blocked = await installFuzzGuard(context, new URL(cfg.baseUrl).origin, { production: true })
  const page = await context.newPage()
  await page.goto("/welcome")
  const result = await page.evaluate(async () => {
    const csrf = await fetch("/api/auth/csrf").then((r) => r.json())
    const post = (url: string) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrfToken: csrf.csrfToken }) }).then(
        (r) => `status ${r.status}`,
        () => "failed",
      )
    return { signin: await post("/api/auth/signin/google"), callback: await post("/api/auth/callback/google"), signout: await post("/api/auth/signout") }
  })
  expect(result.signin).toBe("failed")
  expect(result.callback).toBe("failed")
  expect(result.signout).toMatch(/^status /)
  expect(blocked.filter((b) => b.kind === "auth-write").length).toBe(2)
  await context.close()
})
